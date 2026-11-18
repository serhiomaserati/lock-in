import AsyncStorage from '@react-native-async-storage/async-storage'
import { PublicKey } from '@solana/web3.js'
import { transact, useAuthorization, useMobileWallet } from '@wallet-ui/react-native-web3js'
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { isLockEnabled, LockInConfig, TEST_DAY_MS, TEST_LEAD_MS } from '@/constants/lockin'
import { forgetDeviceKey, loadDeviceKey } from '@/lib/chain/device-key'
import {
  linkDevice,
  openPledge,
  refundPledge,
  sendCheckIns,
  settlePledge,
  SignWith,
  freshBlockhash,
  latestBlockhashOrNull,
} from '@/lib/chain/lockin-chain'
import {
  ChainPledge,
  checkedDays,
  explainChainError,
  fetchConfig,
  fetchPledge,
  fetchPledgesByOwner,
} from '@/lib/chain/lockin-program'
import {
  isTestTiming,
  knownPrograms,
  loadTestTiming,
  newPledgeProgram,
  onTestTimingChange,
  setTestTiming as saveTestTiming,
} from '@/lib/chain/test-timing'
import { now as clockNow, onClockChange } from '@/lib/dev/clock'
import { SAMPLES_ENABLED } from '@/lib/dev/samples'
import { DayWindow, getStepsAccess, readDailySteps, StepsAccess } from '@/lib/proof/steps'
import { cancelAllReminders } from '@/lib/reminders/reminders'
import { useWalletPublicKey } from '@/lib/wallet/use-wallet-public-key'
import {
  DAY_MS,
  dayBounds,
  dayIndex,
  dayStart,
  formatSteps,
  hasCheckedInToday,
  isDemoPledge,
  Pledge,
  PledgeChain,
  pledgeStatus,
  pledgeWindow,
  ProofKind,
  proofKind,
  startsAtOf,
  stateEdges,
  testWindow,
} from './pledge'

const STORAGE_KEY = 'lockin.pledges.v1'

let idCounter = 0
function makeId(): string {
  return `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export interface CreatePledgeInput {
  owner: string
  goal: string
  amountSkr: number
  durationDays: number
  seekerBoost?: boolean
  proof?: ProofKind
  stepsPerDay?: number
}

export interface StepSyncResult {
  access: StepsAccess
  /** Apps that provided step data. Empty while ready = nothing on the phone is tracking steps. */
  sources: string[]
  error?: string
}

interface PledgeContextValue {
  pledges: Pledge[]
  loading: boolean
  /** Health Connect access seen by the last step sync (null until a step pledge was synced). */
  stepsAccess: StepsAccess | null
  /** When steps were last read successfully from Health Connect (null = not yet this session). */
  lastSyncAt: number | null
  /** Locks the deposit (on-chain when configured, otherwise demo) and saves the goal. */
  createPledge: (input: CreatePledgeInput) => Promise<Pledge>
  checkIn: (id: string) => Promise<void>
  /** Returns a completed goal's deposit (on-chain: settles the pledge). */
  claim: (id: string) => Promise<void>
  /** Pulls verified steps from Health Connect and checks in every day that hit the target. */
  syncSteps: (id?: string) => Promise<StepSyncResult>
  /** Sends pending check-ins and refreshes on-chain state (all pledges, or one). */
  syncChain: (id?: string) => Promise<void>
  /** Finds this wallet's goals on-chain (after a reinstall or on a new phone). */
  restoreFromChain: () => Promise<number>
  /** Makes this phone the one that records check-ins for a goal (wallet approval). */
  linkThisPhone: (id: string) => Promise<void>
  /** Safe mode only: takes an unsettled goal's deposit back to the wallet (wallet approval). */
  refund: (id: string) => Promise<void>
  /** Whether the program this goal lives on is in safe mode (last known). */
  inSafeMode: (p: Pledge) => boolean
  /** Re-reads the programs' safe-mode flags. */
  refreshSafeMode: () => Promise<void>
  /** Devnet testing: new goals go to the fast TEST program (days last minutes). */
  testTiming: boolean
  setTestTiming: (on: boolean) => Promise<void>
  /** Dev builds only: replace all pledges (seed demo states / clear). */
  devReplacePledges: (next: Pledge[]) => Promise<void>
  /** Deletes everything Lock-In keeps on this phone. Goals and deposits on Solana are untouched. */
  deleteLocalData: () => Promise<void>
  /** Changes whenever the dev clock moves, so screens re-derive time-based status. */
  clockTick: number
}

const PledgeContext = createContext<PledgeContextValue | null>(null)

const MAIN_PROGRAM = LockInConfig.programId.toBase58()

/** React Native's fetch has no timeout: a dropped connection can hang a request forever. */
const SYNC_STEP_TIMEOUT_MS = 45_000

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms)
    work.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Program a goal lives on. */
export function programOf(p: Pledge): PublicKey {
  return new PublicKey(p.chain?.program ?? MAIN_PROGRAM)
}

function chainInfo(c: ChainPledge, linked: boolean, program: PublicKey): PledgeChain {
  return {
    program: program.toBase58(),
    address: c.address.toBase58(),
    status: c.status,
    checked: checkedDays(c),
    deviceKey: c.deviceKey.toBase58(),
    linked,
    closeAt: c.closeAt * 1000,
    settledAt: c.settledAt ? c.settledAt * 1000 : undefined,
    syncedAt: Date.now(),
  }
}

/** A goal found on-chain with no local copy (reinstall, new phone): rebuilt from chain data. */
function pledgeFromChain(c: ChainPledge, linked: boolean, program: PublicKey): Pledge {
  const bounds = c.bounds.map((s) => s * 1000)
  return {
    id: c.address.toBase58(),
    owner: c.owner.toBase58(),
    // The goal's own wording never goes on-chain (it's public); step goals can be re-derived.
    goal: c.proof === 'steps' ? `Walk ${formatSteps(c.stepsPerDay)} steps a day` : 'Self check-in goal',
    amountSkr: Number(c.amount) / 10 ** LockInConfig.decimals,
    durationDays: c.days,
    createdAt: c.createdAt * 1000,
    startsAt: bounds[0],
    deadline: bounds[bounds.length - 1] - 1,
    tzName: c.tzName || undefined,
    bounds,
    checkIns: checkedDays(c).map((i) => bounds[i] + 1000),
    lockOnChain: true,
    proof: c.proof,
    stepsPerDay: c.proof === 'steps' ? c.stepsPerDay : undefined,
    claimedAt: c.status === 'returned' || c.status === 'refunded' ? c.settledAt * 1000 : undefined,
    chain: chainInfo(c, linked, program),
    testTiming: program.toBase58() !== MAIN_PROGRAM || undefined,
  }
}

/** Local copy updated with on-chain truth: days recorded on-chain count, status and payout come from chain. */
function mergeChain(local: Pledge, c: ChainPledge, linked: boolean): Pledge {
  const program = programOf(local)
  const bounds = dayBounds(local)
  const have = new Set(local.checkIns.map((t) => dayStart(local, t)))
  const extra = checkedDays(c)
    .map((i) => bounds[i])
    .filter((d) => d !== undefined && !have.has(d))
    .map((d) => d + 1000)
  const settled = c.status === 'returned' || c.status === 'refunded'
  return {
    ...local,
    checkIns: [...local.checkIns, ...extra],
    claimedAt: settled ? (local.claimedAt ?? c.settledAt * 1000) : local.claimedAt,
    chain: chainInfo(c, linked, program),
  }
}

export function PledgeProvider({ children }: PropsWithChildren) {
  const wallet = useMobileWallet()
  const { connection } = wallet
  // The wallet signs, Lock-In sends (see SignWith in lockin-chain.ts). No network calls inside the
  // wallet session: while the wallet is in front this app has no network on Android 15 ("Network
  // request failed"), so the blockhash is fetched - fresh - right before the wallet opens.
  // authorizeSession changes after every wallet round-trip (fresh auth token); a ref keeps the signer
  // stable so the context value isn't rebuilt and every screen re-rendered.
  const { authorizeSession } = useAuthorization({ chain: wallet.chain, identity: wallet.identity, store: wallet.store })
  const authorizeRef = useRef(authorizeSession)
  authorizeRef.current = authorizeSession
  const signWith = useCallback<SignWith>(
    async (build) => {
      const early = await freshBlockhash(connection)
      return await transact(async (session) => {
        await authorizeRef.current(session)
        // After the connection is approved, try for a newer blockhash so only the signing screen eats
        // into its life. Requests from behind the wallet can fail, so the early one stays as fallback.
        const late = await latestBlockhashOrNull(connection)
        const { blockhash, lastValidBlockHeight } = late ?? early
        if (__DEV__)
          console.log('Lock-In: blockhash fetched', late ? 'inside the wallet session' : 'before it (fallback)')
        const [signed] = await session.signTransactions({ transactions: [build(blockhash)] })
        return { signed, blockhash, lastValidBlockHeight }
      })
    },
    [connection],
  )
  const owner = useWalletPublicKey()
  const ownerKey = owner?.toBase58()
  const [pledges, setPledges] = useState<Pledge[]>([])
  const [loading, setLoading] = useState(true)
  const [stepsAccess, setStepsAccess] = useState<StepsAccess | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [clockTick, setClockTick] = useState(0)
  useEffect(() => onClockChange(() => setClockTick((t) => t + 1)), [])
  const [testTiming, setTestTimingState] = useState(false)
  useEffect(() => {
    loadTestTiming().then(setTestTimingState)
    return onTestTimingChange(() => setTestTimingState(isTestTiming()))
  }, [])
  // Programs (base58) whose config was last seen in safe mode.
  const [safePrograms, setSafePrograms] = useState<string[]>([])
  // Source of truth for writes, so async work (step sync) never overwrites newer state.
  const pledgesRef = useRef<Pledge[]>([])

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          pledgesRef.current = JSON.parse(raw) as Pledge[]
          setPledges(pledgesRef.current)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const update = useCallback(async (fn: (current: Pledge[]) => Pledge[]) => {
    const next = fn(pledgesRef.current)
    const json = JSON.stringify(next)
    // Syncs mostly confirm what we already have. Skipping those keeps the burst of work after a
    // resume or a wallet round-trip from re-rendering every screen (see NEXT_STEPS: Fabric crash).
    if (json === JSON.stringify(pledgesRef.current)) return
    pledgesRef.current = next
    setPledges(next)
    await AsyncStorage.setItem(STORAGE_KEY, json)
  }, [])

  const patch = useCallback(
    (id: string, fn: (p: Pledge) => Pledge) => update((current) => current.map((p) => (p.id === id ? fn(p) : p))),
    [update],
  )

  const setChainError = useCallback(
    (id: string, e: unknown) =>
      patch(id, (p) => (p.chain ? { ...p, chain: { ...p.chain, syncError: explainChainError(e) } } : p)),
    [patch],
  )

  // ---------------------------------------------------------------- chain sync

  /** Days checked on the phone but not yet on-chain, that the program will still accept. */
  const pendingDays = useCallback((p: Pledge, nowMs: number): number[] => {
    if (!p.chain || p.chain.status !== 'active' || nowMs >= p.chain.closeAt) return []
    const bounds = dayBounds(p)
    const onChain = new Set(p.chain.checked)
    const days = new Set<number>()
    for (const t of p.checkIns) {
      const i = dayIndex(p, dayStart(p, t))
      if (i >= 0 && i <= p.durationDays && bounds[i] <= nowMs && !onChain.has(i)) days.add(i)
    }
    return [...days].sort((a, b) => a - b)
  }, [])

  const syncOne = useCallback(
    async (p: Pledge) => {
      if (!p.chain || !ownerKey || p.owner !== ownerKey || isDemoPledge(p)) return
      const address = new PublicKey(p.chain.address)
      try {
        const device = await loadDeviceKey(ownerKey)
        const linked = !!device && device.publicKey.toBase58() === p.chain.deviceKey
        const pending = pendingDays(p, Date.now())
        if (pending.length > 0 && linked) await sendCheckIns(connection, device!, programOf(p), address, pending)
        const fresh = await fetchPledge(connection, address)
        if (!fresh) return // closed by the owner elsewhere; keep the local history
        await patch(p.id, (cur) => mergeChain(cur, fresh, linked))
      } catch (e) {
        await setChainError(p.id, e)
      }
    },
    [connection, ownerKey, patch, pendingDays, setChainError],
  )

  const refreshSafeMode = useCallback(async () => {
    const on: string[] = []
    for (const program of knownPrograms()) {
      const config = await fetchConfig(connection, program).catch(() => null)
      if (config?.safeMode) on.push(program.toBase58())
    }
    setSafePrograms((prev) => (prev.join() === on.join() ? prev : on))
  }, [connection])

  // One sync at a time; a request while one runs schedules exactly one more pass.
  const syncRun = useRef<Promise<void> | null>(null)
  const syncAgain = useRef(false)
  const syncChain = useCallback(
    async (id?: string) => {
      if (!isLockEnabled()) return
      if (syncRun.current) {
        syncAgain.current = true
        return syncRun.current
      }
      const run = async () => {
        // The first pass covers what was asked; a pass requested meanwhile covers every goal.
        let only = id
        do {
          syncAgain.current = false
          const targets = pledgesRef.current.filter(
            (p) => p.chain && p.chain.status === 'active' && (only === undefined || p.id === only),
          )
          only = undefined
          // A hung request must not block every later sync: each step gets a deadline.
          for (const p of targets) {
            await withTimeout(syncOne(p), SYNC_STEP_TIMEOUT_MS, 'Sync').catch((e) => setChainError(p.id, e))
          }
          if (targets.length > 0)
            await withTimeout(refreshSafeMode(), SYNC_STEP_TIMEOUT_MS, 'Safe-mode check').catch(() => {})
        } while (syncAgain.current)
      }
      syncRun.current = run().finally(() => {
        syncRun.current = null
      })
      return syncRun.current
    },
    [syncOne, refreshSafeMode, setChainError],
  )

  const restoreFromChain = useCallback(async () => {
    if (!isLockEnabled() || !owner || !ownerKey) return 0
    const found: { c: ChainPledge; program: PublicKey }[] = []
    for (const program of knownPrograms()) {
      for (const c of await fetchPledgesByOwner(connection, program, owner)) found.push({ c, program })
    }
    refreshSafeMode().catch(() => {})
    const device = await loadDeviceKey(ownerKey)
    const deviceKey = device?.publicKey.toBase58()
    let added = 0
    await update((current) => {
      const byAddress = new Map(current.filter((p) => p.chain).map((p) => [p.chain!.address, p]))
      const next = [...current]
      for (const { c, program } of found) {
        const linked = c.deviceKey.toBase58() === deviceKey
        const local = byAddress.get(c.address.toBase58())
        if (local) {
          const i = next.indexOf(local)
          next[i] = mergeChain(local, c, linked)
        } else {
          next.unshift(pledgeFromChain(c, linked, program))
          added++
        }
      }
      return next
    })
    return added
  }, [connection, owner, ownerKey, update, refreshSafeMode])

  // Pick up this wallet's on-chain goals whenever a wallet connects.
  useEffect(() => {
    if (!loading && ownerKey) restoreFromChain().catch((e) => console.warn('Lock-In: restore from chain failed', e))
  }, [loading, ownerKey, restoreFromChain])

  // ---------------------------------------------------------------- actions

  const createPledge = useCallback(
    async (input: CreatePledgeInput) => {
      const proof = input.proof ?? 'manual'
      const base = {
        owner: input.owner,
        goal: input.goal.trim(),
        amountSkr: input.amountSkr,
        durationDays: input.durationDays,
        checkIns: [],
        seekerBoost: input.seekerBoost ?? false,
        proof,
        stepsPerDay: proof === 'steps' ? input.stepsPerDay : undefined,
      }

      let pledge: Pledge
      if (isLockEnabled()) {
        if (!owner || owner.toBase58() !== input.owner) throw new Error('Connect your wallet first')
        // Real time, not the dev clock: the program checks the calendar against the chain's clock.
        const now = Date.now()
        const test = isTestTiming()
        const program = newPledgeProgram()
        const window = test
          ? testWindow(now, input.durationDays, TEST_DAY_MS, TEST_LEAD_MS)
          : pledgeWindow(now, input.durationDays)
        const { signature, pledge: c } = await openPledge(connection, signWith, {
          programId: program,
          owner,
          amountSkr: input.amountSkr,
          days: input.durationDays,
          proof,
          stepsPerDay: input.stepsPerDay ?? 0,
          boundsMs: window.bounds,
          tzName: window.tzName,
        })
        pledge = {
          ...base,
          ...window,
          id: c.address.toBase58(),
          createdAt: now,
          amountSkr: Number(c.amount) / 10 ** LockInConfig.decimals,
          lockTxSig: signature,
          lockOnChain: true,
          chain: chainInfo(c, true, program),
          testTiming: test || undefined,
        }
      } else {
        const now = clockNow()
        pledge = { ...base, ...pledgeWindow(now, input.durationDays), id: makeId(), createdAt: now, lockOnChain: false }
      }
      await update((current) => [pledge, ...current])
      return pledge
    },
    [connection, owner, signWith, update],
  )

  const checkIn = useCallback(
    async (id: string) => {
      const now = clockNow()
      // Only honor-system pledges take a manual tap; step pledges are checked in by syncSteps.
      await update((current) =>
        current.map((p) =>
          p.id === id && proofKind(p) === 'manual' && pledgeStatus(p, now) === 'active' && !hasCheckedInToday(p, now)
            ? { ...p, checkIns: [...p.checkIns, now] }
            : p,
        ),
      )
      await syncChain(id)
    },
    [update, syncChain],
  )

  const claim = useCallback(
    async (id: string) => {
      const p = pledgesRef.current.find((x) => x.id === id)
      if (!p || p.claimedAt) return
      if (!p.chain) {
        // Demo pledge: just record it.
        await patch(id, (cur) => ({ ...cur, claimedAt: clockNow() }))
        return
      }
      if (!ownerKey) throw new Error('Connect your wallet first')
      await syncChain(id)
      const fresh = await fetchPledge(connection, new PublicKey(p.chain.address))
      if (!fresh) throw new Error('This goal was not found on-chain.')
      if (fresh.status === 'active') {
        if (checkedDays(fresh).length < fresh.days) {
          throw new Error('Some of your days are not recorded on-chain yet. Check your connection and try again.')
        }
        await settlePledge(connection, signWith, await loadDeviceKey(ownerKey), programOf(p), fresh)
      }
      const settled = await fetchPledge(connection, new PublicKey(p.chain.address))
      if (settled) await patch(id, (cur) => mergeChain(cur, settled, cur.chain?.linked ?? false))
    },
    [connection, ownerKey, patch, signWith, syncChain],
  )

  const linkThisPhone = useCallback(
    async (id: string) => {
      const p = pledgesRef.current.find((x) => x.id === id)
      if (!p?.chain || !owner) return
      await linkDevice(connection, signWith, programOf(p), owner, new PublicKey(p.chain.address))
      const fresh = await fetchPledge(connection, new PublicKey(p.chain.address))
      if (fresh) await patch(id, (cur) => mergeChain(cur, fresh, true))
      await syncChain(id)
    },
    [connection, owner, patch, signWith, syncChain],
  )

  const refund = useCallback(
    async (id: string) => {
      const p = pledgesRef.current.find((x) => x.id === id)
      if (!p?.chain || !ownerKey) return
      const address = new PublicKey(p.chain.address)
      const fresh = await fetchPledge(connection, address)
      if (!fresh) throw new Error('This goal was not found on-chain.')
      if (fresh.status === 'active') await refundPledge(connection, signWith, programOf(p), fresh)
      const after = await fetchPledge(connection, address)
      if (after) await patch(id, (cur) => mergeChain(cur, after, cur.chain?.linked ?? false))
    },
    [connection, ownerKey, patch, signWith],
  )

  const inSafeMode = useCallback(
    (p: Pledge) => !!p.chain && safePrograms.includes(p.chain.program ?? MAIN_PROGRAM),
    [safePrograms],
  )

  const setTestTiming = useCallback(async (on: boolean) => {
    await saveTestTiming(on)
  }, [])

  const syncSteps = useCallback(
    async (id?: string): Promise<StepSyncResult> => {
      const now = clockNow()
      // Started, not yet completed, and still inside the deadline + verification grace.
      const targets = pledgesRef.current.filter((p) => {
        const status = pledgeStatus(p, now)
        return (
          (id === undefined || p.id === id) &&
          proofKind(p) === 'steps' &&
          !isDemoPledge(p) &&
          p.stepsPerDay &&
          (status === 'active' || status === 'verifying')
        )
      })
      // Nothing to sync: still report the real access, never assume it.
      if (targets.length === 0) return { access: await getStepsAccess(), sources: [] }

      const access = await getStepsAccess()
      setStepsAccess(access)
      if (access !== 'ready') return { access, sources: [] }

      const sources = new Set<string>()
      const synced = new Map<string, Pick<Pledge, 'checkIns' | 'stepsByDay' | 'stepsSyncedAt'>>()
      try {
        for (const p of targets) {
          // One window per challenge day, clipped to the challenge period and to now.
          const windows: DayWindow[] = []
          const start = startsAtOf(p)
          const bounds = dayBounds(p)
          const dayEnd = new Map<number, number>()
          for (let i = 0; i < bounds.length - 1; i++) {
            const from = Math.max(bounds[i], start)
            const to = Math.min(bounds[i + 1] - 1, now, p.deadline)
            dayEnd.set(bounds[i], bounds[i + 1])
            if (to > from) windows.push({ day: bounds[i], from, to })
          }
          const daily = await readDailySteps(windows)
          daily.sources.forEach((s) => sources.add(s))

          const stepsByDay = { ...p.stepsByDay }
          const checkedDays = new Set(p.checkIns.map((c) => dayStart(p, c)))
          const checkIns = [...p.checkIns]
          for (const [day, steps] of daily.byDay) {
            // A verified day stays verified: never lower its recorded count afterwards
            // (e.g. records deleted after the check-in).
            const key = String(day)
            stepsByDay[key] = checkedDays.has(day) ? Math.max(stepsByDay[key] ?? 0, steps) : steps
            if (steps >= p.stepsPerDay! && !checkedDays.has(day)) {
              checkIns.push(Math.min(now, (dayEnd.get(day) ?? day + DAY_MS) - 1))
              checkedDays.add(day)
            }
          }
          synced.set(p.id, { checkIns, stepsByDay, stepsSyncedAt: clockNow() })
        }
      } catch (e) {
        return { access, sources: [...sources], error: e instanceof Error ? e.message : 'Could not read steps' }
      }

      await update((current) => current.map((p) => (synced.has(p.id) ? { ...p, ...synced.get(p.id) } : p)))
      setLastSyncAt(clockNow())
      // Verified days go on-chain right away (device key, no wallet prompt).
      syncChain(id).catch(() => {})
      return { access, sources: [...sources] }
    },
    [update, syncChain],
  )

  // Steps keep coming in while the app is in the background - re-sync whenever it returns.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setClockTick((t) => t + 1) // statuses are derived from the clock: re-derive after time in the background
        syncSteps()
        syncChain().catch(() => {})
      }
    })
    return () => sub.remove()
  }, [syncSteps, syncChain])

  // Re-render when a goal's state can change (a day starts or ends, a window closes), at least once a minute.
  useEffect(() => {
    const now = clockNow()
    const next = Math.min(now + 60_000, ...pledges.flatMap(stateEdges).filter((t) => t > now))
    const timer = setTimeout(() => setClockTick((t) => t + 1), next - now + 500)
    return () => clearTimeout(timer)
  }, [pledges, clockTick])

  const deleteLocalData = useCallback(async () => {
    const owners = new Set(pledgesRef.current.map((p) => p.owner))
    if (ownerKey) owners.add(ownerKey)
    for (const o of owners) await forgetDeviceKey(o)
    await cancelAllReminders().catch(() => {})
    pledgesRef.current = []
    setPledges([])
    // Goals, settings and the wallet connection; the wallet adapter's in-memory session is ended by signing out.
    await AsyncStorage.clear()
  }, [ownerKey])

  const devReplacePledges = useCallback(
    async (next: Pledge[]) => {
      if (!SAMPLES_ENABLED) return
      await update(() => next)
    },
    [update],
  )

  // Sample goals (debug and screenshot builds) can survive in local storage when a release build is installed over a debug one.
  // Release builds hide them; they stay in storage untouched (deleting there could hit a real goal's record).
  const visiblePledges = useMemo(
    () => (SAMPLES_ENABLED ? pledges : pledges.filter((p) => !isDemoPledge(p))),
    [pledges],
  )

  const value = useMemo<PledgeContextValue>(
    () => ({
      pledges: visiblePledges,
      loading,
      stepsAccess,
      lastSyncAt,
      createPledge,
      checkIn,
      claim,
      syncSteps,
      syncChain,
      restoreFromChain,
      linkThisPhone,
      refund,
      inSafeMode,
      refreshSafeMode,
      testTiming,
      setTestTiming,
      devReplacePledges,
      deleteLocalData,
      clockTick,
    }),
    [
      visiblePledges,
      loading,
      stepsAccess,
      lastSyncAt,
      createPledge,
      checkIn,
      claim,
      syncSteps,
      syncChain,
      restoreFromChain,
      linkThisPhone,
      refund,
      inSafeMode,
      refreshSafeMode,
      testTiming,
      setTestTiming,
      devReplacePledges,
      deleteLocalData,
      clockTick,
    ],
  )

  return <PledgeContext.Provider value={value}>{children}</PledgeContext.Provider>
}

export function usePledges(): PledgeContextValue {
  const ctx = useContext(PledgeContext)
  if (!ctx) throw new Error('usePledges must be used within a PledgeProvider')
  return ctx
}

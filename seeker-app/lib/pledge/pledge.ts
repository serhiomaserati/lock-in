// Core domain model for Lock-In pledges.
// A pledge = user locks an SKR deposit on a personal goal. The challenge starts the
// next full day; hit the goal on `durationDays` distinct days inside a window of
// durationDays + 1 days (one spare day) to get the deposit back. Miss it and the
// deposit is forfeited. There is no bonus: Lock-In never pays out more than you put in.

import { now as clockNow } from '../dev/clock'

/** 'refunded' = deposit returned in Lock-In's safe mode, whatever the progress. */
export type PledgeStatus = 'upcoming' | 'active' | 'verifying' | 'completed' | 'failed' | 'refunded'

/** How a day gets counted: 'manual' = honor-system tap, 'steps' = verified by Health Connect. */
export type ProofKind = 'manual' | 'steps'

/** The deposit's on-chain state (pledges locked through the Lock-In program). */
export interface PledgeChain {
  program?: string // program the goal lives on (missing = the real Lock-In program)
  address: string // pledge account
  status: 'active' | 'returned' | 'forfeited' | 'refunded'
  checked: number[] // day indexes recorded on-chain
  deviceKey: string // key the program accepts check-ins from
  linked: boolean // this phone holds that key
  closeAt: number // ms; check-ins accepted until then (safe-mode extensions not included)
  settledAt?: number // ms
  syncError?: string
  syncedAt?: number // ms
}

export interface Pledge {
  id: string
  owner: string // wallet address that created the pledge
  goal: string
  amountSkr: number // SKR deposit (devnet placeholder for now)
  durationDays: number // distinct days the goal must be hit
  createdAt: number // ms epoch
  startsAt?: number // ms epoch, local midnight after creation (missing on old pledges → createdAt)
  deadline: number // ms epoch - last moment a day can count
  tzOffset?: number // minutes, Date#getTimezoneOffset() at creation (fallback for old pledges)
  tzName?: string // e.g. "Europe/Kyiv" - display only, the rules use `bounds`
  bounds?: number[] // UTC start of each challenge day + end of the last (N+2), fixed at creation
  checkIns: number[] // ms timestamps of each counted day
  lockTxSig?: string // devnet tx signature of the deposit transfer (null in dev mode)
  lockOnChain: boolean // whether the deposit was actually moved on-chain
  claimedAt?: number // ms epoch when the deposit was claimed back
  seekerBoost?: boolean // creator held a Seeker Genesis Token → Seeker badge
  proof?: ProofKind // missing on pledges created before proofs existed → 'manual'
  stepsPerDay?: number // 'steps' pledges: daily target
  stepsByDay?: Record<string, number> // 'steps' pledges: dayStart → verified steps
  stepsSyncedAt?: number // 'steps' pledges: when steps were last read from Health Connect (ms)
  chain?: PledgeChain // set when the deposit is held by the Lock-In program
  testTiming?: boolean // devnet fast TEST program: days last minutes, not calendar days
}

export const DAY_MS = 24 * 60 * 60 * 1000

/** After the deadline, step pledges wait this long for late Health Connect data before failing. */
export const VERIFY_GRACE_MS = DAY_MS

export const STEP_TARGETS = [5000, 8000, 10000, 15000]

export function proofKind(p: Pledge): ProofKind {
  return p.proof ?? 'manual'
}

/** Until when late data still counts. On-chain goals: the program's close_at (check-ins stop, forfeits start). */
export function verifyUntil(p: Pledge): number {
  return p.chain ? p.chain.closeAt : p.deadline + VERIFY_GRACE_MS
}

/** Moments when a goal's derived state can change (day starts and ends, deadline, close of the late-data window). */
export function stateEdges(p: Pledge): number[] {
  return [...dayBounds(p), p.deadline + 1, verifyUntil(p)]
}

/**
 * A missed goal is 'pending' until a settle transaction has actually moved the deposit on-chain
 * (until then it is still held by the program); 'forfeited' only once the chain confirms it.
 * Demo goals have no chain and are simply 'forfeited'.
 */
export function lossState(p: Pledge): 'pending' | 'forfeited' {
  return p.chain && p.chain.status !== 'forfeited' ? 'pending' : 'forfeited'
}

/** Local midnight for `ts` in a fixed UTC offset (minutes, Date#getTimezoneOffset sign). */
export function startOfDayAt(ts: number, tzOffset: number): number {
  const shift = tzOffset * 60_000
  const local = ts - shift
  return local - (local % DAY_MS) + shift
}

/**
 * `count` consecutive local midnights (device timezone, DST-aware) starting with the day
 * that contains `ts`. Days around a DST switch are 23 or 25 hours long.
 */
export function localMidnights(ts: number, count: number): number[] {
  const d = new Date(ts)
  return Array.from({ length: count }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime())
}

/** IANA name of the device timezone, if the JS engine exposes it. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export function startsAtOf(p: Pledge): number {
  return p.startsAt ?? p.createdAt
}

/**
 * UTC start of every challenge day plus the end of the last one (durationDays + 2 values).
 * New pledges store these at creation; older ones derive them from a fixed offset.
 */
export function dayBounds(p: Pledge): number[] {
  if (p.bounds && p.bounds.length === p.durationDays + 2) return p.bounds
  const first = startOfDayAt(startsAtOf(p), p.tzOffset ?? new Date().getTimezoneOffset())
  return Array.from({ length: p.durationDays + 2 }, (_, i) => first + i * DAY_MS)
}

/** Start of the challenge day containing `ts` (outside the window: local midnight). */
export function dayStart(p: Pledge, ts: number): number {
  const b = dayBounds(p)
  if (ts >= b[0] && ts < b[b.length - 1]) {
    for (let i = b.length - 2; i >= 0; i--) if (ts >= b[i]) return b[i]
  }
  return startOfDayAt(ts, p.tzOffset ?? new Date(ts).getTimezoneOffset())
}

/** A challenge never starts at a midnight closer than this (the deposit transaction needs time). */
export const MIN_START_LEAD_MS = 10 * 60 * 1000

/**
 * Challenge window for a pledge created at `now`: starts at the next local midnight
 * (the one after, if that is only minutes away), one spare day.
 */
export function pledgeWindow(now: number, durationDays: number) {
  let bounds = localMidnights(now, durationDays + 3).slice(1) // tomorrow … end of the last day
  if (bounds[0] - now < MIN_START_LEAD_MS) bounds = localMidnights(now, durationDays + 4).slice(2)
  return {
    tzOffset: new Date(now).getTimezoneOffset(),
    tzName: deviceTimeZone(),
    bounds,
    startsAt: bounds[0],
    deadline: bounds[bounds.length - 1] - 1,
  }
}

/** Test-timing window (devnet fast TEST program): `dayMs`-long days starting `leadMs` from now. */
export function testWindow(now: number, durationDays: number, dayMs: number, leadMs: number) {
  const first = Math.ceil((now + leadMs) / 1000) * 1000
  const bounds = Array.from({ length: durationDays + 2 }, (_, i) => first + i * dayMs)
  return {
    tzOffset: new Date(now).getTimezoneOffset(),
    tzName: deviceTimeZone(),
    bounds,
    startsAt: bounds[0],
    deadline: bounds[bounds.length - 1] - 1,
  }
}

/** 10000 → "10,000" (no Intl dependency). */
export function formatSteps(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Verified steps for the day containing `ts` (0 if not synced yet). */
export function stepsOn(p: Pledge, ts: number = clockNow()): number {
  return p.stepsByDay?.[String(dayStart(p, ts))] ?? 0
}

/**
 * For an on-chain goal the program only returns the deposit once the required days are recorded there.
 * A goal completed on the phone (e.g. checked in offline) isn't returnable before that. Demo goals have no chain.
 */
export function daysRecorded(p: Pledge): boolean {
  return !p.chain || p.chain.status !== 'active' || p.chain.checked.length >= p.durationDays
}

export function isClaimable(p: Pledge, now: number = clockNow()): boolean {
  return pledgeStatus(p, now) === 'completed' && !p.claimedAt && daysRecorded(p)
}

/** Number of distinct days the goal was hit. */
export function distinctCheckInDays(p: Pledge): number {
  return new Set(p.checkIns.map((c) => dayStart(p, c))).size
}

/** Index of the window day starting at `day` (a `dayStart` value), or -1. */
export function dayIndex(p: Pledge, day: number): number {
  return dayBounds(p).slice(0, -1).indexOf(day)
}

/**
 * Today's day for a goal: 'open' (goal not reached yet), 'pending' (reached on this phone, not yet
 * on Solana), 'recorded' (on Solana; demo goals have no chain, so reaching it is the record).
 */
export type TodayRecord = 'open' | 'pending' | 'recorded'

export function todayRecord(p: Pledge, now: number = clockNow()): TodayRecord {
  if (!hasCheckedInToday(p, now)) return 'open'
  if (!p.chain) return 'recorded'
  return p.chain.checked.includes(dayIndex(p, dayStart(p, now))) ? 'recorded' : 'pending'
}

/** False while the goal's deposit is on Solana but this phone can't record its days (new install or phone). */
export function phoneLinked(p: Pledge): boolean {
  return !p.chain || p.chain.status !== 'active' || p.chain.linked
}

/** Dev-build sample goals (lib/dev/demo-pledges.ts): never synced with Health Connect or Solana. */
export function isDemoPledge(p: Pledge): boolean {
  return p.id.startsWith('demo-')
}

/** Status is derived, never stored - always correct against the current time. */
export function pledgeStatus(p: Pledge, now: number = clockNow()): PledgeStatus {
  if (p.chain?.status === 'forfeited') return 'failed'
  if (p.chain?.status === 'refunded') return 'refunded'
  if (p.chain?.status === 'returned') return 'completed'
  if (distinctCheckInDays(p) >= p.durationDays) return 'completed'
  if (now < startsAtOf(p)) return 'upcoming'
  if (now <= p.deadline) return 'active'
  if (proofKind(p) === 'steps' && now < verifyUntil(p)) return 'verifying'
  return 'failed'
}

export function hasCheckedInToday(p: Pledge, now: number = clockNow()): boolean {
  const today = dayStart(p, now)
  return p.checkIns.some((c) => dayStart(p, c) === today)
}

/** Consecutive challenge days hit, counting back from today (or yesterday if today is open). */
export function currentStreak(p: Pledge, now: number = clockNow()): number {
  const days = challengeDays(p, now)
  let i = days.findIndex((d) => d.isToday)
  if (i === -1) i = now >= dayBounds(p)[days.length] ? days.length - 1 : -1
  if (i >= 0 && days[i].state !== 'done') i -= 1
  let streak = 0
  while (i >= 0 && days[i].state === 'done') {
    streak++
    i--
  }
  return streak
}

export function daysLeft(p: Pledge, now: number = clockNow()): number {
  return Math.max(0, Math.ceil((p.deadline - now) / DAY_MS))
}

/** 'unneeded': the goal was already completed on an earlier day, so this day doesn't count either way. */
export type DayState = 'done' | 'today' | 'missed' | 'future' | 'unneeded'

export interface ChallengeDay {
  day: number // start of the challenge day (UTC ms)
  end: number // start of the next day (UTC ms)
  weekday: number // 0 = Sunday
  state: DayState
  spare: boolean // the extra (N+1th) day of the window
  isToday: boolean
}

/** Every calendar day of the challenge window (durationDays + 1 spare), in order. */
export function challengeDays(p: Pledge, now: number = clockNow()): ChallengeDay[] {
  const b = dayBounds(p)
  const total = p.durationDays + 1
  const done = new Set(p.checkIns.map((c) => dayStart(p, c)))
  // The day on which the N-th required day was hit; later days aren't needed any more.
  const completedOn = [...done].sort((a, b) => a - b)[p.durationDays - 1] ?? Infinity
  return Array.from({ length: total }, (_, i) => {
    const day = b[i]
    const end = b[i + 1]
    const isToday = now >= day && now < end
    const state: DayState = done.has(day)
      ? 'done'
      : day > completedOn
        ? 'unneeded'
        : isToday
          ? 'today'
          : end <= now
            ? 'missed'
            : 'future'
    // Weekday of the day's midpoint, so a 23/25-hour DST day can't flip it.
    return { day, end, weekday: new Date(day + (end - day) / 2).getDay(), state, spare: i === total - 1, isToday }
  })
}

/**
 * The spare day is an allowance for one miss: 'free' (not used), 'used' (one day missed),
 * 'gone' (more than one missed), 'not-needed' (completed without a miss).
 */
export type SpareState = 'free' | 'used' | 'gone' | 'not-needed'

export function spareState(days: ChallengeDay[]): SpareState {
  const missed = days.filter((d) => d.state === 'missed').length
  const complete = days.filter((d) => d.state === 'done').length >= days.length - 1
  if (missed === 0) return complete ? 'not-needed' : 'free'
  return missed === 1 ? 'used' : 'gone'
}

/** Days already gone by without hitting the goal. One is free (the spare day). */
export function missedDays(p: Pledge, now: number = clockNow()): number {
  return challengeDays(p, now).filter((d) => d.state === 'missed').length
}

/** False once too many days were missed for the goal to still be reachable. */
export function isStillReachable(p: Pledge, now: number = clockNow()): boolean {
  return missedDays(p, now) <= 1
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

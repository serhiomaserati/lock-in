import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  CircleCheck,
  CloudOff,
  Footprints,
  ListChecks,
  Plus,
  RefreshCw,
  Smartphone,
  TriangleAlert,
} from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native'
import { ClaimButton } from '@/components/lockin/chain-actions'
import {
  formatAmount,
  formatCountdown,
  formatDay,
  formatRange,
  formatTime,
  stepsUpdatedLabel,
} from '@/components/lockin/format'
import { Screen, SectionLabel } from '@/components/lockin/screen'
import { colors, space } from '@/components/lockin/theme'
import { Button, Card, DemoNote, Divider, IconButton, Notice, Pill, ProgressBar, T } from '@/components/lockin/ui'
import { DayTrack } from '@/components/lockin/week-track'
import { now as clockNow } from '@/lib/dev/clock'
import { SAMPLE_CAPTIONS } from '@/lib/dev/samples'
import {
  challengeDays,
  dayBounds,
  daysRecorded,
  distinctCheckInDays,
  formatSteps,
  isDemoPledge,
  isStillReachable,
  lossState,
  phoneLinked,
  Pledge,
  PledgeStatus,
  pledgeStatus,
  proofKind,
  startsAtOf,
  stepsOn,
  todayRecord,
  verifyUntil,
} from '@/lib/pledge/pledge'
import { usePledges } from '@/lib/pledge/pledge-provider'
import { StepsAccess } from '@/lib/proof/steps'

const RESTORE_EVERY_MS = 60_000

// What needs attention first.
const ORDER: Record<PledgeStatus, number> = {
  active: 0,
  completed: 1, // only unreturned ones are "in progress"
  verifying: 2,
  upcoming: 3,
  failed: 4,
  refunded: 5,
}

/** Still needs something: running, waiting for late data, or a deposit to take back. */
function inProgress(p: Pledge, now: number): boolean {
  const s = pledgeStatus(p, now)
  return s === 'active' || s === 'verifying' || s === 'upcoming' || (s === 'completed' && !p.claimedAt)
}

export default function GoalsScreen() {
  const { account } = useMobileWallet()
  const router = useRouter()
  const { pledges, loading, stepsAccess, checkIn, syncSteps, syncChain, restoreFromChain } = usePledges()
  const [syncing, setSyncing] = useState(false)

  // Whenever the list is shown: fresh step data, this wallet's goals from the chain (after a reinstall
  // or a failed earlier attempt), and pending check-ins sent. The full on-chain lookup is heavy
  // (two program scans), so tab switches reuse it for a minute.
  const lastRestoreAt = useRef(0)
  useFocusEffect(
    useCallback(() => {
      if (loading) return
      syncSteps()
      const restore =
        Date.now() - lastRestoreAt.current > RESTORE_EVERY_MS
          ? restoreFromChain().then(() => {
              lastRestoreAt.current = Date.now()
            })
          : Promise.resolve()
      restore.then(() => syncChain()).catch((e) => console.warn('Lock-In: restore from chain failed', e))
    }, [loading, syncSteps, syncChain, restoreFromChain]),
  )

  const refreshSteps = useCallback(async () => {
    setSyncing(true)
    try {
      await syncSteps()
    } finally {
      setSyncing(false)
    }
  }, [syncSteps])

  const now = clockNow()
  const owner = account?.address?.toString()
  const mine = pledges
    .filter((p) => p.owner === owner)
    .sort((a, b) => ORDER[pledgeStatus(a, now)] - ORDER[pledgeStatus(b, now)] || b.createdAt - a.createdAt)
  const current = mine.filter((p) => inProgress(p, now))
  // History: most recent first.
  const history = mine.filter((p) => !inProgress(p, now)).sort((a, b) => b.deadline - a.deadline)
  const offline = current.some((p) => p.chain?.syncError)
  const openCreate = () => router.push('/(tabs)/pledges/create')
  const open = (p: Pledge) => router.push(`/(tabs)/pledges/${p.id}`)

  if (!loading && mine.length === 0) return <EmptyGoals onCreate={openCreate} />

  return (
    <Screen logo title="Your goals" large titleRight={<Button compact icon={Plus} label="New" onPress={openCreate} />}>
      {loading ? (
        <Card style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <T variant="small">Loading your goals…</T>
        </Card>
      ) : (
        <>
          {offline && (
            <Notice tone="warning" icon={CloudOff} title="Can't reach Solana right now">
              Your days are saved on this phone and will be recorded when the connection is back.
            </Notice>
          )}
          {current.length > 0 && <SectionLabel>In progress</SectionLabel>}
          {current.map((p) => (
            <GoalCard
              key={p.id}
              pledge={p}
              now={now}
              stepsAccess={stepsAccess}
              syncing={syncing}
              onRefresh={refreshSteps}
              onCheckIn={() => checkIn(p.id)}
              onOpen={() => open(p)}
            />
          ))}
          {current.length === 0 && (
            <Card style={{ alignItems: 'flex-start' }}>
              <T variant="bodyStrong">Nothing running right now.</T>
              <T variant="small">Start a new goal. It begins tomorrow, with one spare day.</T>
              <Button kind="outline" compact icon={Plus} label="New goal" onPress={openCreate} />
            </Card>
          )}
          {history.length > 0 && <SectionLabel>History</SectionLabel>}
          {history.length > 0 && (
            <Card style={{ paddingVertical: 4, gap: 0 }}>
              {history.map((p, i) => (
                <View key={p.id}>
                  {i > 0 && <Divider />}
                  <HistoryRow pledge={p} now={now} onOpen={() => open(p)} />
                </View>
              ))}
            </Card>
          )}
        </>
      )}
      <DemoNote />
    </Screen>
  )
}

function EmptyGoals({ onCreate }: { onCreate: () => void }) {
  return (
    <Screen logo title="Your goals" large contentStyle={{ alignItems: 'center', gap: space.xl, paddingTop: space.xl }}>
      <View style={styles.emptyGrid} accessible={false} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: 8 }, (_, i) => (
          <View key={i} style={[styles.emptyDot, i === 0 && { borderColor: colors.accent }]} />
        ))}
      </View>
      <View style={{ gap: space.sm, alignItems: 'center' }}>
        <T variant="heading" style={{ fontSize: 24, lineHeight: 30, textAlign: 'center' }}>
          Start with one promise.
        </T>
        <T variant="body" style={{ color: colors.textSecondary, textAlign: 'center' }}>
          Choose something you want to do every day.
        </T>
      </View>
      <View style={{ alignSelf: 'stretch', gap: space.sm }}>
        <Button label="Create your first goal" onPress={onCreate} />
        <T variant="caption" style={{ textAlign: 'center' }}>
          Starts tomorrow. One spare day included.
        </T>
      </View>
      <DemoNote />
    </Screen>
  )
}

function GoalCard({
  pledge,
  now,
  stepsAccess,
  syncing,
  onRefresh,
  onCheckIn,
  onOpen,
}: {
  pledge: Pledge
  now: number
  stepsAccess: StepsAccess | null
  syncing: boolean
  onRefresh: () => void
  onCheckIn: () => Promise<void>
  onOpen: () => void
}) {
  const status = pledgeStatus(pledge, now)
  const isSteps = proofKind(pledge) === 'steps'
  const Icon = isSteps ? Footprints : ListChecks
  const record = todayRecord(pledge, now)
  const done = distinctCheckInDays(pledge)
  // Large system fonts: the title gets the card's full width and the status or button goes below it.
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale >= 1.2
  const sample = SAMPLE_CAPTIONS && isDemoPledge(pledge) ? <T variant="caption">Sample data</T> : null

  // Self check-in, running: one compact row with the action.
  if (status === 'active' && !isSteps) {
    return (
      <Card onPress={onOpen} accessibilityLabel={`${pledge.goal}, self check-in`}>
        <View style={styles.head}>
          <Icon size={22} color={colors.textSecondary} strokeWidth={1.75} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="bodyStrong" numberOfLines={3}>
              {pledge.goal}
            </T>
            <T variant="small">
              Self check-in · {Math.min(done, pledge.durationDays)} of {pledge.durationDays}{' '}
              {pledge.durationDays === 1 ? 'day' : 'days'}
            </T>
            {sample}
          </View>
          {!stacked && <CompactAction pledge={pledge} now={now} record={record} onCheckIn={onCheckIn} />}
        </View>
        {stacked && (
          <View style={styles.stackedAction}>
            <CompactAction pledge={pledge} now={now} record={record} onCheckIn={onCheckIn} />
          </View>
        )}
        {!isStillReachable(pledge, now) && <Unreachable />}
      </Card>
    )
  }

  return (
    <Card onPress={onOpen} accessibilityLabel={pledge.goal}>
      <View style={styles.head}>
        <Icon size={22} color={colors.textSecondary} strokeWidth={1.75} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="heading" numberOfLines={3}>
            {pledge.goal}
          </T>
          {sample}
        </View>
        {!stacked && <StatusPill pledge={pledge} status={status} />}
      </View>
      {stacked && <StatusPill pledge={pledge} status={status} />}

      {status === 'active' && isSteps && (
        <TodaySteps pledge={pledge} now={now} access={stepsAccess} syncing={syncing} onRefresh={onRefresh} />
      )}
      {status === 'upcoming' && (
        <T variant="small">
          {pledge.testTiming
            ? `Test goal · starts at ${formatTime(startsAtOf(pledge))}`
            : `Starts ${formatDay(startsAtOf(pledge))} at 00:00`}
          {' · '}
          {pledge.durationDays} {pledge.durationDays === 1 ? 'day' : 'days'}
        </T>
      )}
      {status === 'verifying' && (
        <T variant="small">Checking late step data · results in {formatCountdown(verifyUntil(pledge), now)}</T>
      )}

      {status !== 'upcoming' && (
        <>
          <Divider />
          <DayTrack days={challengeDays(pledge, now)} numbered={pledge.testTiming} />
        </>
      )}
      {status === 'active' && !isStillReachable(pledge, now) && <Unreachable />}

      <Divider />
      {status === 'completed' && !daysRecorded(pledge) ? (
        <View style={styles.footerRow}>
          <T variant="bodyStrong" style={{ flex: 1 }}>
            {formatAmount(pledge.amountSkr)} locked
          </T>
          <Pill label="Recording…" tone="warning" />
        </View>
      ) : status === 'completed' ? (
        <View style={styles.footerRow}>
          <T variant="bodyStrong" style={{ flex: 1 }}>
            {formatAmount(pledge.amountSkr)} ready to return
          </T>
          <ClaimButton pledge={pledge} label="Return" compact />
        </View>
      ) : (
        <T variant="small">
          <T variant="smallStrong">{formatAmount(pledge.amountSkr)}</T> locked
        </T>
      )}
    </Card>
  )
}

/** The day's check-in: shows progress and ignores taps while it runs. */
function CheckInButton({ onCheckIn }: { onCheckIn: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      compact
      label={busy ? 'Saving…' : 'Check in'}
      loading={busy}
      onPress={async () => {
        if (busy) return
        setBusy(true)
        try {
          await onCheckIn()
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}

/** The compact card's right side: link the phone, check in, or today's state. */
function CompactAction({
  pledge,
  now,
  record,
  onCheckIn,
}: {
  pledge: Pledge
  now: number
  record: ReturnType<typeof todayRecord>
  onCheckIn: () => Promise<void>
}) {
  if (!phoneLinked(pledge)) return <Pill label="Link phone" tone="warning" icon={Smartphone} />
  if (record === 'open') return isStillReachable(pledge, now) ? <CheckInButton onCheckIn={onCheckIn} /> : null
  return <TodayDone record={record} />
}

function StatusPill({ pledge, status }: { pledge: Pledge; status: PledgeStatus }) {
  if (status === 'upcoming') return <Pill label={pledge.testTiming ? 'Upcoming' : 'Starts tomorrow'} tone="neutral" />
  if (status === 'verifying') return <Pill label="Checking" tone="warning" />
  if (status === 'completed') return <Pill label="Completed" tone="success" icon={CircleCheck} />
  return null
}

/** Today's check: reached on the phone ('pending', being recorded) or recorded on Solana. */
function TodayDone({ record }: { record: 'pending' | 'recorded' }) {
  return record === 'recorded' ? (
    <Pill label="Done today" tone="success" icon={CircleCheck} />
  ) : (
    <Pill label="Saving…" tone="warning" />
  )
}

function Unreachable() {
  return (
    <T variant="small" style={{ color: colors.danger }}>
      More than one day missed. This goal can no longer be completed.
    </T>
  )
}

function TodaySteps({
  pledge,
  now,
  access,
  syncing,
  onRefresh,
}: {
  pledge: Pledge
  now: number
  access: StepsAccess | null
  syncing: boolean
  onRefresh: () => void
}) {
  // Without access the real count is unknown: never present that as zero steps.
  if (access && access !== 'ready') {
    return (
      <View style={styles.inline}>
        <TriangleAlert size={18} color={colors.danger} />
        <T variant="small" style={{ color: colors.danger, flex: 1 }}>
          Step access is off. Open this goal to restore it. Your goal deadline still applies.
        </T>
      </View>
    )
  }
  const target = pledge.stepsPerDay ?? 0
  const today = stepsOn(pledge, now)
  const record = todayRecord(pledge, now)
  return (
    <View style={{ gap: space.sm }}>
      <T variant="label">Today</T>
      <View style={styles.numberRow}>
        <T variant="number" numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>
          {formatSteps(today)}
        </T>
        <T variant="small" style={{ fontSize: 16, color: colors.textSecondary }} numberOfLines={1}>
          / {formatSteps(target)} steps
        </T>
      </View>
      {record === 'open' ? (
        <T variant="small">{formatSteps(Math.max(0, target - today))} steps to go</T>
      ) : (
        <TodayDone record={record} />
      )}
      <ProgressBar value={target > 0 ? today / target : 0} />
      <View style={styles.syncRow}>
        <T variant="caption" style={{ flex: 1 }}>
          {stepsUpdatedLabel(pledge, syncing, now)}
        </T>
        {syncing ? (
          <View style={styles.syncSpinner}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : (
          <IconButton icon={RefreshCw} label="Refresh steps" onPress={onRefresh} color={colors.textSecondary} />
        )}
      </View>
    </View>
  )
}

function HistoryRow({ pledge, now, onOpen }: { pledge: Pledge; now: number; onOpen: () => void }) {
  const status = pledgeStatus(pledge, now)
  const Icon = proofKind(pledge) === 'steps' ? Footprints : ListChecks
  const b = dayBounds(pledge)
  const outcome =
    status === 'completed'
      ? { label: 'Returned', color: colors.success }
      : status === 'refunded'
        ? { label: 'Refunded', color: colors.textSecondary }
        : lossState(pledge) === 'pending'
          ? { label: 'Transfer pending', color: colors.warning }
          : { label: 'Forfeited', color: colors.danger }
  // Large system fonts: amount and outcome go under the title, so the title keeps the row's width.
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale >= 1.2
  return (
    <Card onPress={onOpen} accessibilityLabel={`${pledge.goal}, ${outcome.label}`} style={styles.historyRow}>
      <Icon size={22} color={colors.textSecondary} strokeWidth={1.75} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="bodyStrong" numberOfLines={stacked ? 2 : 1}>
          {pledge.goal}
        </T>
        <T variant="caption">{formatRange(b[0], b[b.length - 1] - 1)}</T>
        {stacked && (
          <T variant="small">
            <T variant="smallStrong">{formatAmount(pledge.amountSkr)}</T>
            {' · '}
            <T variant="small" style={{ color: outcome.color }}>
              {outcome.label}
            </T>
          </T>
        )}
      </View>
      {!stacked && (
        <View style={{ alignItems: 'flex-end' }}>
          <T variant="smallStrong">{formatAmount(pledge.amountSkr)}</T>
          <T variant="caption" style={{ color: outcome.color }}>
            {outcome.label}
          </T>
        </View>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // Under the title, lined up with its text (icon 22 + gap).
  stackedAction: { alignItems: 'flex-start', paddingLeft: 22 + space.md },
  numberRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  syncRow: { flexDirection: 'row', alignItems: 'center', marginVertical: -8, marginRight: -12 },
  syncSpinner: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  inline: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  emptyGrid: { flexDirection: 'row', flexWrap: 'wrap', width: 248, gap: 16, justifyContent: 'center' },
  emptyDot: { width: 46, height: 46, borderRadius: 23, borderWidth: 2.5, borderColor: colors.borderStrong },
})

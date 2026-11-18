import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import {
  CalendarClock,
  CalendarDays,
  Check,
  Clock,
  Flame,
  FlaskConical,
  Footprints,
  Hourglass,
  Info,
  LifeBuoy,
  Lock,
  RefreshCw,
  RotateCcw,
  Share2,
  TriangleAlert,
  X,
} from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native'
import {
  ClaimButton,
  DepositDetails,
  ErrorText,
  lateDataCloses,
  LinkPhoneNotice,
  SafeModeRefund,
} from '@/components/lockin/chain-actions'
import {
  ceilMinute,
  countLabel,
  formatAmount,
  formatCountdown,
  formatDay,
  formatShortDate,
  formatTime,
  stepsUpdatedLabel,
  utcOffsetLabel,
} from '@/components/lockin/format'
import { Padlock } from '@/components/lockin/padlock'
import { Screen, SectionLabel } from '@/components/lockin/screen'
import { colors, space } from '@/components/lockin/theme'
import {
  Button,
  Card,
  Collapsible,
  DemoNote,
  DetailRows,
  Divider,
  IconButton,
  InfoLine,
  Notice,
  Pill,
  ProgressBar,
  T,
  Tile,
} from '@/components/lockin/ui'
import { DayTrack } from '@/components/lockin/week-track'
import { now as clockNow } from '@/lib/dev/clock'
import {
  challengeDays,
  currentStreak,
  DAY_MS,
  dayStart,
  distinctCheckInDays,
  formatSteps,
  daysRecorded,
  isClaimable,
  isStillReachable,
  lossState,
  phoneLinked,
  Pledge,
  PledgeStatus,
  pledgeStatus,
  proofKind,
  spareState,
  SpareState,
  startsAtOf,
  stepsOn,
  todayRecord,
  TodayRecord,
  verifyUntil,
} from '@/lib/pledge/pledge'
import { StepSyncResult, usePledges } from '@/lib/pledge/pledge-provider'
import { openHealthConnectInstall, requestStepsAccess } from '@/lib/proof/steps'
import { useCluster } from '@/components/cluster/cluster-provider'
import { isLockEnabled, networkName } from '@/constants/lockin'

export default function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { pledges, checkIn, syncSteps, syncChain, refreshSafeMode, inSafeMode } = usePledges()
  const pledge = useMemo(() => pledges.find((p) => p.id === id), [pledges, id])
  const isSteps = pledge ? proofKind(pledge) === 'steps' : false

  const [syncing, setSyncing] = useState(false)
  const [sync, setSync] = useState<StepSyncResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  // The same screen can be reused for another goal (deep link): drop the previous goal's step result.
  useEffect(() => {
    setSync(null)
    setCheckError(null)
  }, [id])

  const runSync = useCallback(async () => {
    if (!id) return
    setSyncing(true)
    try {
      setSync(await syncSteps(id))
    } finally {
      setSyncing(false)
    }
  }, [id, syncSteps])

  // Re-verify steps (and on-chain state) every time the screen comes into view.
  useFocusEffect(
    useCallback(() => {
      // Sample goals (debug builds) are never synced.
      if (id?.startsWith('demo-')) return
      if (isSteps) runSync()
      else if (id) syncChain(id).catch(() => {})
      refreshSafeMode().catch(() => {})
    }, [id, isSteps, runSync, syncChain, refreshSafeMode]),
  )

  if (!pledge) {
    return (
      <Screen title="Goal" back>
        <T variant="body">This goal is no longer on this phone.</T>
        <Button kind="secondary" label="Back to goals" onPress={() => router.replace('/(tabs)/pledges')} />
      </Screen>
    )
  }

  const now = clockNow()
  const status = pledgeStatus(pledge, now)
  const record = todayRecord(pledge, now)
  const shareable = status === 'active' || status === 'completed' || status === 'verifying'
  const openShare = () => router.push({ pathname: '/(tabs)/pledges/share', params: { id: pledge.id } })

  async function onCheckIn() {
    if (checking) return
    setChecking(true)
    setCheckError(null)
    try {
      await checkIn(pledge!.id)
    } catch {
      setCheckError('Your check-in is saved on this phone. It will be recorded on Solana when the connection is back.')
    } finally {
      setChecking(false)
    }
  }

  const blocked = isSteps && sync?.access !== undefined && sync.access !== 'ready'

  return (
    <Screen
      title={pledge.goal}
      back
      right={shareable ? <IconButton icon={Share2} label="Share" onPress={openShare} /> : undefined}
    >
      {pledge.testTiming && <Pill label="Test goal · 3-minute days" tone="accent" icon={FlaskConical} />}
      <LinkPhoneNotice pledge={pledge} />
      <SafeModeRefund pledge={pledge} />

      {status === 'completed' && pledge.claimedAt ? (
        <Returned pledge={pledge} onShare={openShare} onBack={() => router.replace('/(tabs)/pledges')} />
      ) : (
        <>
          <StateHero pledge={pledge} status={status} record={record} now={now} />

          {/* Today */}
          {status === 'active' && isSteps && blocked && (
            <StepsBlocked
              access={sync!.access}
              onAllow={async () => {
                if (await requestStepsAccess()) await runSync()
              }}
            />
          )}
          {status === 'active' && isSteps && !blocked && (
            <TodaySteps pledge={pledge} now={now} record={record} syncing={syncing} sync={sync} onSync={runSync} />
          )}
          {status === 'active' &&
            !isSteps &&
            record === 'open' &&
            isStillReachable(pledge, now) &&
            phoneLinked(pledge) && (
              <View style={{ gap: space.sm }}>
                <Button
                  label={checking ? 'Checking in…' : 'Check in for today'}
                  onPress={onCheckIn}
                  loading={checking}
                />
                <ErrorText error={checkError} />
                <T variant="caption" style={{ textAlign: 'center' }}>
                  Self check-ins are on your honor. They only ever return your own deposit.
                </T>
              </View>
            )}

          {/* Progress */}
          <SectionLabel>Your progress</SectionLabel>
          <Card>
            {status === 'refunded' ? (
              // Refunded in safe mode: the goal ended early, so no day is "today" and no spare is left to use.
              <DayTrack
                days={challengeDays(pledge, now).map((d) =>
                  d.state === 'today' || d.state === 'future' ? { ...d, state: 'unneeded' as const } : d,
                )}
                numbered={pledge.testTiming}
                showHeader={false}
              />
            ) : (
              <DayTrack days={challengeDays(pledge, now)} numbered={pledge.testTiming} />
            )}
          </Card>

          <MoneyState pledge={pledge} status={status} now={now} onShare={openShare} inSafeMode={inSafeMode(pledge)} />

          {status === 'verifying' && <VerifyingPanel pledge={pledge} now={now} syncing={syncing} onSync={runSync} />}

          {(status === 'active' || status === 'upcoming') && (
            <View style={styles.tiles}>
              {/* Once today is done the deposit has its own card above: show the spare day instead. */}
              {status === 'active' && record !== 'open' ? (
                <Tile icon={LifeBuoy} value={SPARE_TILE[spareState(challengeDays(pledge, now))]} label="Spare day" />
              ) : (
                <Tile icon={Lock} value={formatAmount(pledge.amountSkr)} label="Deposit" />
              )}
              {status === 'active' ? (
                <Tile
                  icon={Flame}
                  value={countLabel(currentStreak(pledge, now), 'day')}
                  label="Streak"
                  iconColor={colors.warning}
                />
              ) : (
                <Tile icon={CalendarDays} value={countLabel(pledge.durationDays, 'day')} label="Required" />
              )}
            </View>
          )}

          {(status === 'active' || status === 'upcoming') && <DayClock pledge={pledge} now={now} />}

          {status === 'failed' && (
            <Button
              kind="secondary"
              label="Create another goal"
              onPress={() => router.push('/(tabs)/pledges/create')}
            />
          )}

          <Card style={{ paddingVertical: 0, gap: 0 }}>
            {/* Keyed by goal: opening another goal starts with its own folded/unfolded state. */}
            <DepositDetails key={`details-${pledge.id}`} pledge={pledge} now={now} open={status === 'failed'} />
            <DayLog key={`log-${pledge.id}`} pledge={pledge} now={now} isSteps={isSteps} />
          </Card>
        </>
      )}
      <DemoNote />
    </Screen>
  )
}

const SPARE_TILE: Record<SpareState, string> = {
  free: '1 left',
  used: 'Used',
  gone: 'None left',
  'not-needed': 'Not needed',
}

// ---------------------------------------------------------------- the big status on top

type HeroIcon = 'check' | 'saving' | 'clock' | 'x' | 'alert' | 'calendar' | 'refund' | 'none'

function Hero({ icon, title, subtitle }: { icon: HeroIcon; title: string; subtitle?: string }) {
  return (
    <View style={styles.hero} accessible accessibilityRole="header" accessibilityLabel={`${title} ${subtitle ?? ''}`}>
      {icon !== 'none' && <HeroBadge icon={icon} />}
      <T variant="hero" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {subtitle ? (
        <T variant="body" style={{ color: colors.textSecondary, textAlign: 'center' }}>
          {subtitle}
        </T>
      ) : null}
    </View>
  )
}

function HeroBadge({ icon }: { icon: Exclude<HeroIcon, 'none'> }) {
  const ring = (color: string, Icon: LucideIcon) => (
    <View style={[styles.badge, { borderWidth: 3, borderColor: color }]}>
      <Icon size={28} color={color} strokeWidth={2.5} />
    </View>
  )
  switch (icon) {
    case 'check':
      return (
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Check size={32} color={colors.onAccent} strokeWidth={3} />
        </View>
      )
    case 'saving':
      return (
        <View style={[styles.badge, { borderWidth: 3, borderColor: colors.warning }]}>
          <ActivityIndicator color={colors.warning} />
        </View>
      )
    case 'clock':
      return ring(colors.warning, Clock)
    case 'alert':
      return ring(colors.warning, TriangleAlert)
    case 'x':
      return ring(colors.danger, X)
    case 'calendar':
      return ring(colors.textSecondary, CalendarClock)
    case 'refund':
      return ring(colors.textSecondary, RotateCcw)
  }
}

function StateHero({
  pledge,
  status,
  record,
  now,
}: {
  pledge: Pledge
  status: PledgeStatus
  record: TodayRecord
  now: number
}) {
  const done = distinctCheckInDays(pledge)
  const required = countLabel(pledge.durationDays, 'day')
  switch (status) {
    case 'upcoming':
      return (
        <Hero
          icon="calendar"
          title={pledge.testTiming ? `Starts at ${formatTime(startsAtOf(pledge))}.` : 'Starts tomorrow.'}
          subtitle={`Complete ${required} within ${pledge.durationDays + 1}.`}
        />
      )
    case 'active':
      if (!isStillReachable(pledge, now))
        return (
          <Hero
            icon="alert"
            title="Can't be completed anymore."
            subtitle={`More than one day was missed, so ${required} no longer fit before the end.`}
          />
        )
      if (record === 'recorded') return <Hero icon="check" title="Done for today." subtitle="Day recorded on Solana." />
      // Not linked: nothing can be recorded from this phone yet. The Link notice above says so and has the button.
      if (!phoneLinked(pledge)) return null
      if (record === 'pending')
        return pledge.chain?.syncError ? (
          <Hero
            icon="clock"
            title="Saved on this phone."
            subtitle="It will be recorded on Solana when the connection is back."
          />
        ) : (
          <Hero icon="saving" title="Saving your check-in…" subtitle="Recording your day on Solana." />
        )
      return (
        <Hero
          icon="none"
          title={proofKind(pledge) === 'steps' ? 'Keep moving.' : 'Show up today.'}
          subtitle={proofKind(pledge) === 'steps' ? undefined : 'Check in once you have done it.'}
        />
      )
    case 'verifying':
      return (
        <Hero
          icon="clock"
          title="Checking late steps."
          subtitle="The goal has ended. Late step data can still count."
        />
      )
    case 'completed':
      return <Hero icon="check" title="You kept your word." subtitle={`${pledge.goal}.`} />
    case 'failed':
      return lossState(pledge) === 'pending' ? (
        <Hero icon="clock" title="Goal not met." subtitle={`${done} of ${required} complete.`} />
      ) : (
        <Hero icon="x" title="Deposit forfeited." subtitle={`${done} of ${required} complete.`} />
      )
    case 'refunded':
      return (
        <Hero
          icon="refund"
          title="Deposit refunded."
          subtitle="Lock-In was in safe mode, so your deposit went back to your wallet."
        />
      )
  }
}

// ---------------------------------------------------------------- today (steps)

function TodaySteps({
  pledge,
  now,
  record,
  syncing,
  sync,
  onSync,
}: {
  pledge: Pledge
  now: number
  record: TodayRecord
  syncing: boolean
  sync: StepSyncResult | null
  onSync: () => void
}) {
  const target = pledge.stepsPerDay ?? 0
  const today = stepsOn(pledge, now)
  const over = today - target
  return (
    <Card style={{ gap: space.sm }}>
      <View style={styles.rowCenter}>
        {record === 'open' ? (
          <T variant="label" style={{ flex: 1 }}>
            Today
          </T>
        ) : (
          <View style={[styles.rowCenter, { flex: 1, gap: space.sm }]}>
            <Footprints size={18} color={colors.textSecondary} />
            <T variant="small">Steps</T>
          </View>
        )}
      </View>
      <View style={styles.numberRow}>
        <T variant="number" numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>
          {formatSteps(today)}
        </T>
        <T variant="body" style={{ color: colors.textSecondary }} numberOfLines={1}>
          / {formatSteps(target)} steps
        </T>
      </View>
      <ProgressBar value={target > 0 ? today / target : 0} />
      <T variant="small">
        {record === 'open'
          ? `${formatSteps(Math.max(0, target - today))} steps to go`
          : over > 0
            ? `${formatSteps(over)} steps above your goal.`
            : 'Goal reached.'}
      </T>
      <View style={styles.syncRow}>
        <T variant="caption" style={{ flex: 1 }}>
          {stepsUpdatedLabel(pledge, syncing, now)}
        </T>
        <Button
          kind="ghost"
          compact
          icon={syncing ? undefined : RefreshCw}
          loading={syncing}
          label="Refresh steps"
          onPress={onSync}
        />
      </View>
      {sync?.access === 'ready' && !sync.error && sync.sources.length === 0 && today === 0 && (
        <InfoLine>No step data yet. Make sure an app that counts steps writes to Health Connect.</InfoLine>
      )}
      {sync?.error && (
        <T variant="small" style={{ color: colors.danger }}>
          Couldn&apos;t read steps: {sync.error}
        </T>
      )}
    </Card>
  )
}

function StepsBlocked({ access, onAllow }: { access: StepSyncResult['access']; onAllow: () => void }) {
  return (
    <Notice
      tone="danger"
      icon={TriangleAlert}
      title="Steps can't be read right now"
      action={
        access === 'needs-permission' ? (
          <Button label="Allow step access" onPress={onAllow} />
        ) : access === 'needs-install' ? (
          <Button label="Get Health Connect" onPress={openHealthConnectInstall} />
        ) : undefined
      }
    >
      {access === 'needs-install'
        ? 'Health Connect is missing or outdated on this phone. Install it to sync your steps. Your goal deadline still applies.'
        : access === 'unsupported'
          ? 'Step tracking is not available on this device. Your goal deadline still applies.'
          : 'Step access is off, which is not the same as zero steps. Restore access to sync your steps. Your goal deadline still applies.'}
    </Notice>
  )
}

// ---------------------------------------------------------------- money

function MoneyState({
  pledge,
  status,
  now,
  onShare,
  inSafeMode,
}: {
  pledge: Pledge
  status: PledgeStatus
  now: number
  onShare: () => void
  inSafeMode: boolean
}) {
  const amount = formatAmount(pledge.amountSkr)
  if (status === 'completed') {
    return (
      <Card>
        <View style={styles.moneyRow}>
          <Padlock size={34} />
          <View style={{ flex: 1 }}>
            <T variant="numberSm">{amount}</T>
            <T variant="small">
              {daysRecorded(pledge) ? 'Deposit ready to return.' : 'Your days are being recorded on Solana.'}
            </T>
          </View>
        </View>
        {isClaimable(pledge, now) && <ClaimButton pledge={pledge} />}
        <Button kind="outline" icon={Share2} label="Share achievement" onPress={onShare} />
        <InfoLine icon={Clock}>
          {daysRecorded(pledge)
            ? 'Not returned yet. Tap Return to send it to your wallet.'
            : 'Return becomes available once your days are confirmed on Solana. Keep Lock-In open with a connection.'}
        </InfoLine>
      </Card>
    )
  }
  if (status === 'failed' && lossState(pledge) === 'pending' && !inSafeMode) {
    const closes = ceilMinute(verifyUntil(pledge))
    return (
      <>
        <Card>
          <View style={styles.moneyRow}>
            <Padlock size={34} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <T variant="numberSm">{amount}</T>
              <T variant="small" style={{ color: colors.text }}>
                Transfer pending.
              </T>
              <T variant="small">Your deposit has not moved yet.</T>
            </View>
          </View>
        </Card>
        <InfoLine>
          {now < closes
            ? `The rules are unchanged. From ${formatShortDate(closes)}, ${formatTime(closes)} the deposit can go to the recipient set when you created the goal.`
            : 'The rules are unchanged. The deposit goes to the recipient set when you created the goal.'}
        </InfoLine>
      </>
    )
  }
  if (status === 'failed' && lossState(pledge) === 'forfeited') {
    return (
      <Card>
        <View style={styles.moneyRow}>
          <Padlock size={34} color={colors.danger} />
          <View style={{ flex: 1 }}>
            <T variant="numberSm">{amount}</T>
            <T variant="small">
              Forfeited{pledge.chain?.settledAt ? ` on ${formatShortDate(pledge.chain.settledAt)}` : ''}. Transferred
              according to this goal&apos;s rules.
            </T>
          </View>
        </View>
      </Card>
    )
  }
  if (status === 'verifying' || (status === 'active' && todayRecord(pledge, now) !== 'open')) {
    return (
      <Card>
        <View style={styles.moneyRow}>
          <Padlock size={34} />
          <View style={{ flex: 1 }}>
            <T variant="numberSm">
              {amount}{' '}
              <T variant="body" style={{ color: colors.textSecondary }}>
                locked
              </T>
            </T>
            <T variant="small">Your deposit is still locked.</T>
          </View>
        </View>
      </Card>
    )
  }
  return null
}

function VerifyingPanel({
  pledge,
  now,
  syncing,
  onSync,
}: {
  pledge: Pledge
  now: number
  syncing: boolean
  onSync: () => void
}) {
  return (
    <Card>
      <View style={styles.moneyRow}>
        <Hourglass size={30} color={colors.warning} />
        <View style={{ flex: 1 }}>
          <T variant="small">Results in</T>
          <T variant="numberMd">{formatCountdown(verifyUntil(pledge), now)}</T>
          <T variant="caption">
            Late data window closes {lateDataCloses(pledge)} · {pledge.tzName ?? utcOffsetLabel(pledge.tzOffset)}
          </T>
        </View>
      </View>
      <Button
        kind="outline"
        icon={syncing ? undefined : RefreshCw}
        loading={syncing}
        label={syncing ? 'Refreshing…' : 'Refresh steps'}
        onPress={onSync}
      />
      <InfoLine>Only steps taken during your goal can count.</InfoLine>
    </Card>
  )
}

/** When the goal's days start, in its own fixed time zone (and on this phone's clock if that differs). */
function DayClock({ pledge, now }: { pledge: Pledge; now: number }) {
  const zone = pledge.tzName ?? utcOffsetLabel(pledge.tzOffset)
  const localStart = pledge.testTiming ? '00:00' : formatTime(dayStart(pledge, now))
  const done = todayRecord(pledge, now) !== 'open'
  return (
    <Card style={styles.moneyRow}>
      <CalendarClock size={24} color={colors.textSecondary} strokeWidth={1.75} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong">
          {pledge.testTiming
            ? 'Test days last 3 minutes'
            : pledgeStatus(pledge, now) === 'upcoming'
              ? `First day: ${formatDay(startsAtOf(pledge))}, 00:00`
              : done
                ? 'Next day starts at midnight'
                : 'Today ends at midnight'}
        </T>
        <T variant="small">Goal time zone: {zone}. Fixed when you created this goal.</T>
        {localStart !== '00:00' && <T variant="small">By this phone&apos;s clock, each day starts at {localStart}.</T>}
      </View>
    </Card>
  )
}

/** Past days with their result (and steps), folded away by default. */
function DayLog({ pledge, now, isSteps }: { pledge: Pledge; now: number; isSteps: boolean }) {
  const today = dayStart(pledge, now)
  const days = challengeDays(pledge, now)
    .filter((d) => d.day < today && (d.state === 'done' || d.state === 'missed'))
    .reverse()
  if (days.length === 0) return null
  const label = (day: number) => (day === today - DAY_MS ? 'Yesterday' : formatShortDate(day + 12 * 60 * 60 * 1000))
  return (
    <>
      <Divider />
      <Collapsible icon={Info} title="Day by day">
        {days.map((d) => (
          <View key={d.day} style={styles.dayRow}>
            <T variant="body" style={{ flex: 1 }}>
              {label(d.day)}
            </T>
            {isSteps && <T variant="small">{formatSteps(pledge.stepsByDay?.[String(d.day)] ?? 0)} steps</T>}
            {d.state === 'done' ? (
              <Check size={20} color={colors.accent} strokeWidth={2.5} />
            ) : (
              <X size={20} color={colors.danger} />
            )}
          </View>
        ))}
      </Collapsible>
    </>
  )
}

// ---------------------------------------------------------------- returned

function Returned({ pledge, onShare, onBack }: { pledge: Pledge; onShare: () => void; onBack: () => void }) {
  const { getExplorerUrl } = useCluster()
  return (
    <>
      <View style={styles.hero} accessible accessibilityRole="header">
        <Padlock size={88} open check />
        <T variant="number" style={{ textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
          {formatAmount(pledge.amountSkr)}
        </T>
        <T variant="body" style={{ color: colors.textSecondary }}>
          Back in your wallet.
        </T>
      </View>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <T variant="hero" style={{ fontSize: 28, lineHeight: 34 }}>
          All yours.
        </T>
        <T variant="body" style={{ color: colors.textSecondary, textAlign: 'center' }}>
          {pledge.goal} completed.
        </T>
      </View>
      <Card>
        <DetailRows
          rows={[
            { label: 'Amount', value: formatAmount(pledge.amountSkr) },
            { label: 'Status', value: 'Confirmed', color: colors.accent },
            { label: 'Returned', value: pledge.claimedAt ? formatShortDate(pledge.claimedAt) : '-' },
            { label: 'Network', value: isLockEnabled() ? networkName() : 'Demo' },
          ]}
        />
        {pledge.chain && (
          <Button
            kind="ghost"
            compact
            label="View on Solana Explorer"
            onPress={() => Linking.openURL(getExplorerUrl(`address/${pledge.chain!.address}`))}
            style={{ alignSelf: 'flex-start', marginLeft: -8 }}
          />
        )}
      </Card>
      <Button label="Back to goals" onPress={onBack} />
      <Button kind="outline" icon={Share2} label="Share achievement" onPress={onShare} />
    </>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  numberRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  syncRow: { flexDirection: 'row', alignItems: 'center', marginVertical: -4, marginRight: -8 },
  tiles: { flexDirection: 'row', gap: space.md },
  moneyRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
})

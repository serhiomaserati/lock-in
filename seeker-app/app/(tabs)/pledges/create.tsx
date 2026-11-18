import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { useRouter } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import { BadgeCheck, CalendarDays, FileText, FlaskConical, Footprints, Info, LifeBuoy, Lock } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { ErrorText } from '@/components/lockin/chain-actions'
import { formatAmount, formatDay, formatTime, utcOffsetLabel } from '@/components/lockin/format'
import { Screen, SectionLabel } from '@/components/lockin/screen'
import { colors, fonts, radius, space } from '@/components/lockin/theme'
import { Button, Card, Collapsible, DemoNote, Pill, Segmented, T } from '@/components/lockin/ui'
import { isLockEnabled, isMainnet, LockInConfig, TEST_DAY_MS, TEST_LEAD_MS } from '@/constants/lockin'
import { explainChainError } from '@/lib/chain/lockin-program'
import { newPledgeProgram } from '@/lib/chain/test-timing'
import { useDepositLimits } from '@/lib/chain/use-deposit-limits'
import { now as clockNow } from '@/lib/dev/clock'
import { SAMPLE_WALLET, STORE_SHOTS } from '@/lib/dev/samples'
import { deviceTimeZone, formatSteps, pledgeWindow, ProofKind, STEP_TARGETS, testWindow } from '@/lib/pledge/pledge'
import { usePledges } from '@/lib/pledge/pledge-provider'
import { useSeekerGenesis } from '@/lib/pledge/use-seeker-genesis'
import { getStepsAccess, openHealthConnectInstall, requestStepsAccess } from '@/lib/proof/steps'
import { reminderSettings, requestReminderPermission } from '@/lib/reminders/reminders'
import { useSkrBalance } from '@/lib/wallet/use-skr-balance'
import { useSolBalance } from '@/lib/wallet/use-sol-balance'
import { lamportsToSol } from '@/utils/lamports-to-sol'

const DURATIONS = [3, 5, 7, 30]
/** Fast test days (devnet): a 1-day goal makes the whole flow take ~10 minutes. */
const TEST_DURATIONS = [1, 3, 5, 7]
const NAME_MAX = 50

export default function CreateGoalScreen() {
  const router = useRouter()
  const { account } = useMobileWallet()
  const { createPledge, testTiming } = usePledges()
  const { data: isSeeker } = useSeekerGenesis()
  const onChain = isLockEnabled()
  const skrQuery = useSkrBalance()
  const sol = useSolBalance().data
  const realLimits = useDepositLimits(newPledgeProgram()).data
  // Store screenshot builds only: a sample wallet, as the shots are taken without real SKR.
  const balance = STORE_SHOTS ? SAMPLE_WALLET.skr : skrQuery.data
  const limits = STORE_SHOTS ? SAMPLE_WALLET.limits : realLimits
  // Never hand the wallet a deposit that can only fail: both balances must be known and enough.
  const checkFunds = onChain && !STORE_SHOTS
  const lowSol = checkFunds && typeof sol === 'number' && sol < LockInConfig.minGoalLamports
  const fundsKnown = !checkFunds || (typeof balance === 'number' && typeof sol === 'number')

  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [duration, setDuration] = useState(7)
  const [proof, setProof] = useState<ProofKind>('steps')
  const [stepsPerDay, setStepsPerDay] = useState(10000)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsInstall, setNeedsInstall] = useState(false)

  const amountNum = Number(amount.replace(',', '.'))
  const amountOk = amount.trim() !== '' && Number.isFinite(amountNum) && amountNum > 0
  const defaultStepsName = `Walk ${formatSteps(stepsPerDay)} steps a day`
  const goalText = name.trim() || (proof === 'steps' ? defaultStepsName : '')
  const tooMuch = onChain && typeof balance === 'number' && amountNum > balance
  const outOfRange = onChain && !!limits && amountOk && (amountNum < limits.min || amountNum > limits.max)
  const paused = onChain && !!limits?.pausedNew
  const valid = goalText.length >= 3 && amountOk && !tooMuch && !outOfRange && !paused && !lowSol && fundsKnown
  // On-chain goals follow the real clock (the program checks it), demo goals the dev clock.
  const durations = testTiming ? TEST_DURATIONS : DURATIONS
  const days = durations.includes(duration) ? duration : durations[0]
  const startsAt = testTiming
    ? testWindow(Date.now(), days, TEST_DAY_MS, TEST_LEAD_MS).startsAt
    : pledgeWindow(onChain ? Date.now() : clockNow(), days).startsAt
  const zone = deviceTimeZone() ?? utcOffsetLabel()
  const symbol = LockInConfig.tokenSymbol

  /** Step goals need Health Connect read access before any deposit is locked. */
  async function ensureStepsAccess(): Promise<boolean> {
    const access = await getStepsAccess()
    if (access === 'ready') return true
    if (access === 'needs-permission') {
      if (await requestStepsAccess()) return true
      setError('Allow Lock-In to read your steps from Health Connect. That is how your days are verified.')
      return false
    }
    if (access === 'needs-install') {
      setNeedsInstall(true)
      setError('Step goals need Health Connect. Install or update it, then try again.')
      return false
    }
    setError('Step tracking is not available on this device. Use a self check-in goal instead.')
    return false
  }

  async function onSubmit() {
    if (!valid || !account || submitting) return
    setSubmitting(true)
    setError(null)
    setNeedsInstall(false)
    try {
      if (proof === 'steps' && !(await ensureStepsAccess())) return
      // Locks the deposit on-chain when configured (one wallet approval), otherwise demo only.
      await createPledge({
        owner: account.address.toString(),
        goal: goalText,
        amountSkr: amountNum,
        durationDays: days,
        proof,
        stepsPerDay,
        seekerBoost: isSeeker ?? false,
      })
      // Right after committing is when a reminder makes sense; Android 13+ asks only once.
      if (reminderSettings().enabled) requestReminderPermission().catch(() => {})
      router.back()
    } catch (e) {
      setError(onChain ? explainChainError(e) : 'Could not save your goal. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen
      title="New goal"
      back
      fullScreen
      footer={
        <>
          {/* Right above the button: further down the scroll view nobody sees it. */}
          <ErrorText error={error} />
          {needsInstall && <Button kind="secondary" label="Get Health Connect" onPress={openHealthConnectInstall} />}
          <Button
            label={submitting ? 'Locking…' : amountOk ? `Lock ${formatAmount(amountNum)}` : `Lock ${symbol}`}
            onPress={onSubmit}
            disabled={!valid}
            loading={submitting}
          />
          <DemoNote />
        </>
      }
    >
      <SectionLabel>Verification method</SectionLabel>
      <View style={styles.types} accessibilityRole="radiogroup">
        <TypeCard
          icon={Footprints}
          title="Steps"
          body="Read from Health Connect"
          selected={proof === 'steps'}
          onPress={() => setProof('steps')}
        />
        <TypeCard
          icon={FileText}
          title="Self check-in"
          body="You confirm each day"
          selected={proof === 'manual'}
          onPress={() => setProof('manual')}
        />
      </View>

      {proof === 'steps' && (
        <>
          <SectionLabel>Daily target</SectionLabel>
          <Segmented
            label="Daily step target"
            options={STEP_TARGETS}
            value={stepsPerDay}
            onChange={setStepsPerDay}
            format={formatSteps}
          />
        </>
      )}

      <SectionLabel right={<T variant="caption">{`${name.length} / ${NAME_MAX}`}</T>}>Goal name</SectionLabel>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX}
        placeholder={proof === 'steps' ? defaultStepsName : 'e.g. Read 20 pages'}
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel="Goal name"
        style={styles.input}
      />
      {proof === 'manual' && <T variant="caption">Only you see the name. It stays on this phone.</T>}

      <SectionLabel>Duration</SectionLabel>
      <Segmented
        label="Duration"
        options={durations}
        value={days}
        onChange={setDuration}
        format={(d) => `${d} ${d === 1 ? 'day' : 'days'}`}
      />
      <Card style={styles.infoCard}>
        <Info size={18} color={colors.textSecondary} />
        <T variant="small" style={{ flex: 1, color: colors.text }}>
          Complete {days} {days === 1 ? 'day' : 'days'} within {days + 1} calendar days.
        </T>
      </Card>

      <SectionLabel>Deposit amount</SectionLabel>
      <View style={[styles.amountBox, (tooMuch || outOfRange) && { borderColor: colors.danger }]}>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder={String(limits?.min ?? 100)}
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
          accessibilityLabel={`Deposit amount in ${symbol}`}
          style={styles.amountInput}
        />
        <T variant="bodyStrong" style={{ color: colors.textSecondary }}>
          {symbol}
        </T>
      </View>
      {onChain && typeof balance === 'number' && (
        <T variant="small" style={tooMuch ? { color: colors.danger } : undefined}>
          {tooMuch ? `You only have ${formatAmount(balance)}` : `Available: ${formatAmount(balance)}`}
        </T>
      )}
      {onChain && balance == null && (
        <T variant="small">{skrQuery.isLoading ? 'Checking your balance…' : 'Balance unavailable right now.'}</T>
      )}
      {lowSol && (
        <T variant="small" style={{ color: colors.danger }}>
          {`Not enough SOL for network fees: you have ${lamportsToSol(sol ?? 0)} SOL, a new goal needs about 0.008 SOL.`}
        </T>
      )}
      {limits && (
        <T variant="small" style={outOfRange ? { color: colors.danger } : undefined}>
          {`From ${formatAmount(limits.min)} to ${formatAmount(limits.max)} per goal`}
        </T>
      )}
      {paused && (
        <T variant="small" style={{ color: colors.danger }}>
          New goals are paused right now. Your existing goals are not affected.
        </T>
      )}

      <Card style={{ gap: space.sm }}>
        {testTiming ? (
          <Rule icon={FlaskConical} text={`Test goal: each day lasts 3 minutes · starts ${formatTime(startsAt)}`} />
        ) : (
          <Rule icon={CalendarDays} text={`Starts ${formatDay(startsAt)}, 00:00 · ${zone}`} />
        )}
        <Rule icon={LifeBuoy} text="1 spare day" />
        <Rule icon={Lock} text="Deposit returned if completed" />
      </Card>

      <Card style={{ paddingVertical: 0 }}>
        <Collapsible title="Deposit rules">
          <T variant="small">
            If you miss your goal, the deposit is not returned. It goes to the{' '}
            {onChain ? (isMainnet() ? 'Lock-In treasury (a wallet of the operator)' : 'test treasury (devnet)') : 'forfeit address'}, fixed when you create
            the goal. It is never paid to other users.
          </T>
          {onChain && (
            <T variant="small">
              The deposit is held by the Lock-In program on Solana and paid out by its rules. Network costs are
              separate: about 0.0036 SOL of storage for the goal, plus up to 0.003 SOL for this phone&apos;s check-in
              fees when its balance is low. About 0.0015 SOL comes back to your wallet when the goal is settled. Your
              wallet shows the exact amount before you sign.
            </T>
          )}
          {proof === 'manual' && (
            <T variant="small">Self check-ins are on your honor. They only ever return your own deposit.</T>
          )}
        </Collapsible>
      </Card>

      {isSeeker && <Pill label="Seeker verified" tone="success" icon={BadgeCheck} />}
    </Screen>
  )
}

function TypeCard({
  icon: Icon,
  title,
  body,
  selected,
  onPress,
}: {
  icon: LucideIcon
  title: string
  body: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      style={({ pressed }) => [styles.type, selected && styles.typeOn, pressed && { opacity: 0.75 }]}
    >
      {/* One row: icon, text, radio. The height follows the text (larger system fonts just wrap). */}
      <Icon size={22} color={selected ? colors.accent : colors.textSecondary} strokeWidth={1.75} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="bodyStrong">{title}</T>
        <T variant="caption">{body}</T>
      </View>
      <View style={[styles.radio, selected && { borderColor: colors.accent }]}>
        {selected && <View style={styles.radioDot} />}
      </View>
    </Pressable>
  )
}

function Rule({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <View style={styles.rule}>
      <Icon size={18} color={colors.textSecondary} strokeWidth={1.75} />
      <T variant="small" style={{ color: colors.text, flex: 1 }}>
        {text}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  types: { gap: space.sm },
  type: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  typeOn: { borderColor: colors.accent, borderWidth: 1.5 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
  },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  amountInput: { flex: 1, fontFamily: fonts.number, fontSize: 30, color: colors.text, paddingVertical: 8 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 28 },
})

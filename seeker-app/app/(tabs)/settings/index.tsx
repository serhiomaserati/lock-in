import Constants from 'expo-constants'
import { useFocusEffect, useRouter } from 'expo-router'
import Clipboard from '@react-native-clipboard/clipboard'
import {
  BadgeCheck,
  Bell,
  Copy,
  ExternalLink,
  FileText,
  FlaskConical,
  Footprints,
  Globe,
  LifeBuoy,
  LogOut,
  ScrollText,
  Shield,
  Trash2,
  Wallet as WalletIcon,
} from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { useAuth } from '@/components/auth/auth-provider'
import { DevPanel } from '@/components/dev/dev-panel'
import { utcOffsetLabel } from '@/components/lockin/format'
import { Screen, SectionLabel } from '@/components/lockin/screen'
import { colors, space } from '@/components/lockin/theme'
import { Button, Card, DemoBadge, Divider, IconButton, ListRow, Logo, Pill, T, Toggle } from '@/components/lockin/ui'
import { AppConfig } from '@/constants/app-config'
import { canUseTestTiming, isLockEnabled, isMainnet, LockInConfig } from '@/constants/lockin'
import { deviceTimeZone, isDemoPledge, type Pledge } from '@/lib/pledge/pledge'
import { usePledges } from '@/lib/pledge/pledge-provider'
import { useSeekerGenesis } from '@/lib/pledge/use-seeker-genesis'
import { formatHour } from '@/lib/reminders/plan'
import { loadReminderSettings, onReminderSettingsChange, reminderSettings } from '@/lib/reminders/reminders'
import { openSitePage } from '@/lib/site'
import {
  getStepsAccess,
  openHealthConnectInstall,
  openStepSettings,
  requestStepsAccess,
  StepsAccess,
} from '@/lib/proof/steps'
import { useWalletPublicKey } from '@/lib/wallet/use-wallet-public-key'
import { ellipsify } from '@/utils/ellipsify'

const ACCESS_LABEL: Record<StepsAccess, { text: string; color: string }> = {
  ready: { text: 'Connected', color: colors.textSecondary },
  'needs-permission': { text: 'Not allowed', color: colors.danger },
  'needs-install': { text: 'Install Health Connect', color: colors.danger },
  unsupported: { text: 'Not available', color: colors.textTertiary },
}

export default function SettingsScreen() {
  const router = useRouter()
  const owner = useWalletPublicKey()
  const { signOut } = useAuth()
  const { pledges, deleteLocalData } = usePledges()
  const { data: isSeeker } = useSeekerGenesis()
  const [access, setAccess] = useState<StepsAccess | null>(null)
  const [reminders, setReminders] = useState(reminderSettings)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    loadReminderSettings().then(setReminders)
    return onReminderSettingsChange(() => setReminders(reminderSettings()))
  }, [])

  useFocusEffect(
    useCallback(() => {
      getStepsAccess().then(setAccess)
    }, []),
  )

  async function onStepTracking() {
    if (access === 'needs-permission') {
      await requestStepsAccess()
      setAccess(await getStepsAccess())
    } else if (access === 'needs-install') {
      openHealthConnectInstall()
    } else if (access === 'ready') {
      openStepSettings()
    }
  }

  function copyAddress() {
    if (!owner) return
    Clipboard.setString(owner.toBase58())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Screen title="Settings" large>
      {owner && (
        <Card style={styles.walletCard}>
          <WalletIcon size={24} color={colors.textSecondary} strokeWidth={1.75} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="body">Connected wallet</T>
            <View style={styles.addressRow}>
              <T variant="small">{ellipsify(owner.toBase58(), 4)}</T>
              {copied ? (
                <T variant="caption" style={{ paddingHorizontal: 12 }}>
                  Copied
                </T>
              ) : (
                <IconButton
                  icon={Copy}
                  label="Copy wallet address"
                  onPress={copyAddress}
                  color={colors.textSecondary}
                />
              )}
            </View>
            {isSeeker && <Pill label="Seeker verified" tone="success" icon={BadgeCheck} />}
          </View>
          <DemoBadge />
        </Card>
      )}

      <SectionLabel>Routine</SectionLabel>
      <Card style={styles.list}>
        <ListRow
          icon={Footprints}
          label="Step tracking"
          detail={access ? ACCESS_LABEL[access].text : 'Checking…'}
          detailColor={access ? ACCESS_LABEL[access].color : undefined}
          detailDot={access === 'ready' ? colors.accent : undefined}
          onPress={access && access !== 'unsupported' ? onStepTracking : undefined}
        />
        <Divider />
        <ListRow
          icon={Bell}
          label="Daily reminder"
          detail={reminders.enabled ? formatHour(reminders.hour) : 'Off'}
          onPress={() => router.push('/(tabs)/settings/reminders')}
        />
        <Divider />
        <ListRow icon={Globe} label="Time zone for new goals" detail={deviceTimeZone() ?? utcOffsetLabel()} />
      </Card>
      <T variant="caption">Existing goals keep their own time zone, so their days never shift.</T>

      <SectionLabel>About</SectionLabel>
      <Card style={styles.list}>
        <ListRow
          icon={FileText}
          label="How deposits work"
          onPress={() => router.push('/(tabs)/settings/how-it-works')}
        />
        <Divider />
        <ListRow icon={Shield} label="Privacy" onPress={() => router.push('/(tabs)/settings/privacy')} />
        <Divider />
        <ListRow icon={ScrollText} label="Terms of use" onPress={() => openSitePage('terms.html')} />
        <Divider />
        <ListRow icon={LifeBuoy} label="Help and support" onPress={() => openSitePage('support.html')} />
        <Divider />
        <ListRow icon={ExternalLink} label="Website" detail={AppConfig.domain} onPress={() => openSitePage('')} />
      </Card>

      {canUseTestTiming() && <TestTimingCard />}

      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Button kind="secondary" icon={LogOut} label="Disconnect wallet" onPress={() => signOut()} />
        <Button
          kind="danger"
          icon={Trash2}
          label="Delete local data"
          onPress={() => confirmDeleteData(heldGoals(pledges, owner?.toBase58()), deleteLocalData, signOut)}
        />
      </View>
      <View style={styles.version}>
        <Logo size={16} />
        <T variant="caption">
          {isLockEnabled() ? (isMainnet() ? 'Mainnet' : 'Devnet') : 'Demo'} · v{Constants.expoConfig?.version ?? '1.0.0'}
        </T>
      </View>

      <DevPanel />
    </Screen>
  )
}

/** Goals of this wallet whose deposit the program still holds, and how many of them can still record days. */
function heldGoals(pledges: Pledge[], owner: string | undefined) {
  const held = pledges.filter((p) => p.owner === owner && p.chain?.status === 'active' && !isDemoPledge(p))
  return { held: held.length, recording: held.filter((p) => p.chain && p.chain.closeAt > Date.now()).length }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function confirmDeleteData(
  goals: { held: number; recording: number },
  deleteLocalData: () => Promise<void>,
  signOut: () => Promise<void>,
) {
  const removed =
    "Removed from this phone: goal names (they're kept only here), step counts, reminders, settings and this phone's check-in key."
  const message =
    goals.held === 0
      ? `${removed} Records on Solana stay as they are.`
      : [
          `This doesn't cancel anything and doesn't return deposits. Your ${plural(goals.held, 'goal', 'goals')} and the ${LockInConfig.tokenSymbol} locked in ${goals.held === 1 ? 'it' : 'them'} stay on Solana under the same rules.`,
          removed,
          goals.recording > 0
            ? "Until you connect the same wallet again and tap Link this phone on each goal (one wallet approval each), this phone can't record your days. Days that aren't recorded count as missed."
            : 'To return a deposit later, connect the same wallet again: goals are found on Solana.',
        ].join('\n\n')
  Alert.alert('Delete local data?', message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        await deleteLocalData()
        await signOut()
      },
    },
  ])
}

/** Devnet testing: new goals go to the separate fast TEST program, where a day lasts 3 minutes. */
function TestTimingCard() {
  const { testTiming, setTestTiming } = usePledges()
  return (
    <>
      <Card>
        <View style={styles.accountRow}>
          <FlaskConical size={22} color={colors.textSecondary} strokeWidth={1.75} />
          <T variant="body" style={{ flex: 1 }}>
            Fast test days (devnet)
          </T>
          <Toggle value={testTiming} onChange={setTestTiming} label="Fast test days" />
        </View>
      </Card>
      <T variant="caption">
        For testing only: new goals use a separate test program where one day lasts 3 minutes. Existing goals keep their
        own timing.
      </T>
    </>
  )
}

const styles = StyleSheet.create({
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  walletCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  addressRow: { flexDirection: 'row', alignItems: 'center', marginVertical: -10 },
  list: { paddingVertical: 0, gap: 0 },
  version: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
})

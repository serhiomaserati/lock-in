import Clipboard from '@react-native-clipboard/clipboard'
import { useRouter } from 'expo-router'
import {
  ArrowDownToLine,
  BadgeCheck,
  Copy,
  Footprints,
  Info,
  ListChecks,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react-native'
import { useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { useGetBalance } from '@/components/account/use-get-balance'
import { ClaimButton } from '@/components/lockin/chain-actions'
import { formatAmount, formatShortDate, formatTime } from '@/components/lockin/format'
import { Screen, SectionLabel } from '@/components/lockin/screen'
import { colors, radius, space } from '@/components/lockin/theme'
import { Button, Card, DemoNote, Divider, IconButton, Pill, T, Tile } from '@/components/lockin/ui'
import { LockInConfig } from '@/constants/lockin'
import { now as clockNow } from '@/lib/dev/clock'
import { isClaimable, isDemoPledge, lossState, Pledge, pledgeStatus, proofKind, verifyUntil } from '@/lib/pledge/pledge'
import { usePledges } from '@/lib/pledge/pledge-provider'
import { useSeekerGenesis } from '@/lib/pledge/use-seeker-genesis'
import { useSkrBalance } from '@/lib/wallet/use-skr-balance'
import { useWalletPublicKey } from '@/lib/wallet/use-wallet-public-key'
import { ellipsify } from '@/utils/ellipsify'
import { lamportsToSol } from '@/utils/lamports-to-sol'

export default function WalletScreen() {
  const router = useRouter()
  const owner = useWalletPublicKey()
  const { pledges } = usePledges()
  const { data: isSeeker } = useSeekerGenesis()
  const skr = useSkrBalance()
  const [copied, setCopied] = useState(false)

  if (!owner) {
    return (
      <Screen logo>
        <T variant="body">Connect a wallet to see your deposits.</T>
      </Screen>
    )
  }

  const now = clockNow()
  // Real deposits only: sample goals (debug builds) are never part of the totals or the activity.
  const mine = pledges.filter((p) => p.owner === owner.toBase58() && !isDemoPledge(p))
  // Missed goals whose deposit hasn't been settled yet are still held by the program.
  const locked = mine.filter((p) => {
    const s = pledgeStatus(p, now)
    return ['upcoming', 'active', 'verifying'].includes(s) || (s === 'failed' && lossState(p) === 'pending')
  })
  const returnable = mine.filter((p) => isClaimable(p, now))
  const sum = (xs: Pledge[]) => xs.reduce((n, p) => n + p.amountSkr, 0)

  function copyAddress() {
    Clipboard.setString(owner!.toBase58())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Screen logo>
      <Card>
        <T variant="small">Available balance</T>
        {skr.isLoading ? (
          <View style={[styles.skeleton, { width: 180, height: 52 }]} />
        ) : skr.data == null ? (
          <View style={{ gap: 2 }}>
            <T variant="heading">Balance unavailable</T>
            <T variant="small">Couldn&apos;t read your {LockInConfig.tokenSymbol} balance. Check your connection.</T>
          </View>
        ) : (
          <T variant="number" numberOfLines={1} adjustsFontSizeToFit>
            {formatAmount(skr.data)}
          </T>
        )}
        <View style={styles.addressRow}>
          <T variant="small" style={{ color: colors.text }}>
            {ellipsify(owner.toBase58(), 4)}
          </T>
          {copied ? (
            <T variant="caption" style={{ paddingHorizontal: 12 }}>
              Copied
            </T>
          ) : (
            <IconButton icon={Copy} label="Copy wallet address" onPress={copyAddress} color={colors.textSecondary} />
          )}
          <View style={{ flex: 1 }} />
          {isSeeker && <Pill label="Seeker verified" tone="success" icon={BadgeCheck} />}
        </View>
      </Card>

      <SectionLabel
        right={
          <IconButton
            icon={Info}
            label="About these amounts"
            color={colors.textSecondary}
            onPress={() =>
              Alert.alert(
                'Your deposits',
                'Locked: deposits of goals that are running, waiting for late step data, or waiting to be settled.\n\nReady to return: completed goals. Return them to move the deposit back to your wallet.',
              )
            }
          />
        }
      >
        Deposits
      </SectionLabel>
      <View style={styles.tiles}>
        <Tile icon={Lock} value={formatAmount(sum(locked))} label="Locked in goals" />
        <Tile icon={RefreshCw} value={formatAmount(sum(returnable))} label="Ready to return" />
      </View>

      {returnable.length > 0 && (
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {returnable.map((p, i) => (
            <View key={p.id}>
              {i > 0 && <Divider />}
              <View style={styles.returnRow}>
                {proofKind(p) === 'steps' ? (
                  <Footprints size={22} color={colors.textSecondary} strokeWidth={1.75} />
                ) : (
                  <ListChecks size={22} color={colors.textSecondary} strokeWidth={1.75} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="bodyStrong" numberOfLines={1}>
                    {p.goal}
                  </T>
                  <T variant="small">{formatAmount(p.amountSkr)}</T>
                </View>
                <ClaimButton pledge={p} label="Return" compact />
              </View>
            </View>
          ))}
        </Card>
      )}

      <SolFees />

      <Activity pledges={mine} now={now} />

      {__DEV__ && (
        <Button
          kind="secondary"
          label="Get devnet SOL (debug)"
          onPress={() => router.push('/(tabs)/account/airdrop')}
        />
      )}
      <DemoNote />
    </Screen>
  )
}

function SolFees() {
  const owner = useWalletPublicKey()!
  const sol = useGetBalance({ address: owner })
  return (
    <View style={styles.feeRow}>
      <View style={{ flex: 1 }}>
        <T variant="caption" style={{ fontSize: 13 }}>
          Network fees: SOL · balance {sol.data != null ? `${lamportsToSol(sol.data)} SOL` : 'unavailable'}
        </T>
      </View>
      <IconButton
        icon={Info}
        label="About network fees"
        color={colors.textSecondary}
        onPress={() =>
          Alert.alert(
            'Network fees',
            'Solana charges small fees in SOL for each transaction: locking a deposit, linking a phone and returning it. Your wallet shows the fee before you sign. Recording your days uses a small SOL balance kept on this phone.',
          )
        }
      />
    </View>
  )
}

type Event = {
  /** Stable per goal and kind, so a new event doesn't shift (and remount) the rows below it. */
  key: string
  at: number
  label: string
  goal: string
  amount: number
  kind: 'out' | 'in' | 'lost'
  icon: typeof Lock
}

function Activity({ pledges, now }: { pledges: Pledge[]; now: number }) {
  const events: Event[] = []
  for (const p of pledges) {
    events.push({
      key: `${p.id}-locked`,
      at: p.createdAt,
      label: 'Deposit locked',
      goal: p.goal,
      amount: p.amountSkr,
      kind: 'out',
      icon: Lock,
    })
    if (p.claimedAt)
      events.push({
        key: `${p.id}-returned`,
        at: p.claimedAt,
        label: pledgeStatus(p, now) === 'refunded' ? 'Deposit refunded' : 'Deposit returned',
        goal: p.goal,
        amount: p.amountSkr,
        kind: 'in',
        icon: ArrowDownToLine,
      })
    // Not a second charge: the deposit that was already locked is simply not coming back.
    if (pledgeStatus(p, now) === 'failed' && lossState(p) === 'forfeited')
      events.push({
        key: `${p.id}-forfeited`,
        at: p.chain?.settledAt ?? verifyUntil(p),
        label: 'Deposit forfeited',
        goal: p.goal,
        amount: p.amountSkr,
        kind: 'lost',
        icon: X,
      })
  }
  events.sort((a, b) => b.at - a.at)
  if (events.length === 0) return null

  return (
    <>
      <SectionLabel>Recent activity</SectionLabel>
      <Card style={{ paddingVertical: 4, gap: 0 }}>
        {events.slice(0, 10).map((e, i) => (
          <View key={e.key}>
            {i > 0 && <Divider />}
            <View style={styles.eventRow}>
              <View style={styles.eventIcon}>
                <e.icon size={18} color={e.kind === 'in' ? colors.accent : colors.textSecondary} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" numberOfLines={1}>
                  {e.label}
                </T>
                <T variant="caption" numberOfLines={1}>
                  {e.goal}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T
                  variant="smallStrong"
                  style={{ color: e.kind === 'in' ? colors.accent : e.kind === 'lost' ? colors.danger : colors.text }}
                >
                  {e.kind === 'in' ? '+' : e.kind === 'out' ? '−' : ''}
                  {formatAmount(e.amount)}
                </T>
                <T variant="caption">
                  {e.kind === 'lost' ? 'not returned' : `${formatShortDate(e.at)}, ${formatTime(e.at)}`}
                </T>
              </View>
            </View>
          </View>
        ))}
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginVertical: -8 },
  tiles: { flexDirection: 'row', gap: space.md },
  returnRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12 },
  feeRow: { flexDirection: 'row', alignItems: 'center', marginVertical: -8 },
  skeleton: { borderRadius: radius.sm, backgroundColor: colors.raised },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12 },
  eventIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

import { Linking, View } from 'react-native'
import { useState } from 'react'
import { ExternalLink, FileText, ShieldAlert, Smartphone } from 'lucide-react-native'
import { useCluster } from '@/components/cluster/cluster-provider'
import { ceilMinute, formatAmount, formatDay, formatShortDate, formatTime } from '@/components/lockin/format'
import { colors, space } from '@/components/lockin/theme'
import { Button, Collapsible, DetailRows, Divider, ListRow, Notice, T } from '@/components/lockin/ui'
import { forfeitRecipientName, isLockEnabled, networkName } from '@/constants/lockin'
import { explainChainError } from '@/lib/chain/lockin-program'
import { lossState, Pledge, pledgeStatus, todayRecord, verifyUntil } from '@/lib/pledge/pledge'
import { usePledges } from '@/lib/pledge/pledge-provider'

/** Runs an async action once at a time, with a readable error next to the button. */
function useAction(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(explainChainError(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <T variant="small" style={{ color: colors.danger }} accessibilityLiveRegion="polite">
      {error}
    </T>
  )
}

/** Returns a completed goal's deposit (on-chain: settles the pledge). The button stays for a retry. */
export function ClaimButton({ pledge, label, compact }: { pledge: Pledge; label?: string; compact?: boolean }) {
  const { claim } = usePledges()
  const { busy, error, run } = useAction(() => claim(pledge.id))
  return (
    <View style={{ gap: space.xs, alignItems: compact ? 'flex-end' : 'stretch' }}>
      <Button
        compact={compact}
        label={busy ? 'Returning…' : (label ?? `Return ${formatAmount(pledge.amountSkr)}`)}
        onPress={run}
        loading={busy}
      />
      <ErrorText error={error} />
    </View>
  )
}

/** Shown when the goal's check-in key isn't on this phone (reinstall, new phone). */
export function LinkPhoneNotice({ pledge }: { pledge: Pledge }) {
  const { linkThisPhone } = usePledges()
  const { busy, error, run } = useAction(() => linkThisPhone(pledge.id))
  if (!pledge.chain || pledge.chain.status !== 'active' || pledge.chain.linked) return null
  return (
    <Notice
      tone="warning"
      icon={Smartphone}
      title="Link this phone to the goal"
      action={
        <View style={{ gap: space.xs }}>
          <Button label={busy ? 'Linking…' : 'Link this phone'} onPress={run} loading={busy} />
          <ErrorText error={error} />
        </View>
      }
    >
      Your goal and deposit are safe on Solana, but this phone can&apos;t record your days yet (new install or new
      phone). Linking takes one wallet approval.
      {todayRecord(pledge) === 'pending' &&
        ' Today’s check-in is saved here and is recorded once this phone is linked.'}
    </Notice>
  )
}

/** Safe mode (Lock-In's emergency switch): forfeits are paused and the owner can take the deposit back. */
export function SafeModeRefund({ pledge }: { pledge: Pledge }) {
  const { refund, inSafeMode } = usePledges()
  const { busy, error, run } = useAction(() => refund(pledge.id))
  if (!pledge.chain || pledge.chain.status !== 'active' || !inSafeMode(pledge)) return null
  return (
    <Notice
      tone="warning"
      icon={ShieldAlert}
      title="Lock-In is in safe mode"
      action={
        <View style={{ gap: space.xs }}>
          <Button
            kind="secondary"
            label={busy ? 'Returning…' : `Take my ${formatAmount(pledge.amountSkr)} back`}
            onPress={run}
            loading={busy}
          />
          <ErrorText error={error} />
        </View>
      }
    >
      Something went wrong on our side, so no deposit can be forfeited right now. You can take your deposit back to your
      wallet, or keep the goal running.
    </Notice>
  )
}

/** Where the deposit is and where it would go: amount, status, recipient, explorer link. */
export function DepositDetails({ pledge, now, open }: { pledge: Pledge; now: number; open?: boolean }) {
  const { getExplorerUrl } = useCluster()
  const chain = pledge.chain
  const status = pledgeStatus(pledge, now)
  const statusText = !chain
    ? 'Demo, nothing on Solana'
    : chain.status === 'returned'
      ? 'Returned'
      : chain.status === 'refunded'
        ? 'Refunded'
        : chain.status === 'forfeited'
          ? 'Forfeited'
          : status === 'failed' && lossState(pledge) === 'pending'
            ? 'Awaiting settlement'
            : status === 'completed'
              ? 'Ready to return'
              : 'Locked'
  const rows = [
    { label: 'Amount', value: formatAmount(pledge.amountSkr) },
    { label: 'Status', value: statusText },
    {
      label: 'If missed',
      value: isLockEnabled() ? forfeitRecipientName() : 'Not returned',
    },
    ...(chain
      ? [
          { label: 'Days recorded on Solana', value: `${chain.checked.length} of ${pledge.durationDays}` },
          {
            label: 'Late data until',
            value: `${formatShortDate(ceilMinute(verifyUntil(pledge)))}, ${formatTime(ceilMinute(verifyUntil(pledge)))}`,
          },
        ]
      : []),
    { label: 'Network', value: isLockEnabled() ? networkName() : 'Demo' },
  ]
  return (
    <View style={{ gap: 0 }}>
      <Collapsible icon={FileText} title="Deposit details" initiallyOpen={open}>
        <DetailRows rows={rows} />
        {chain?.syncError && (
          <T variant="small" style={{ color: colors.warning }}>
            Couldn&apos;t reach Solana: {chain.syncError} It retries automatically.
          </T>
        )}
      </Collapsible>
      {chain && (
        <>
          <Divider />
          <ListRow
            icon={ExternalLink}
            label="View on Solana Explorer"
            onPress={() => Linking.openURL(getExplorerUrl(`address/${chain.address}`))}
          />
        </>
      )}
    </View>
  )
}

/** "Oct 20, 00:00" for when a step goal's late-data window closes. */
export function lateDataCloses(pledge: Pledge): string {
  return `${formatDay(ceilMinute(verifyUntil(pledge)))}, ${formatTime(ceilMinute(verifyUntil(pledge)))}`
}

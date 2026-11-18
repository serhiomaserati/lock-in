import * as Sharing from 'expo-sharing'
import { useLocalSearchParams } from 'expo-router'
import { Share2 } from 'lucide-react-native'
import { useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { captureRef } from 'react-native-view-shot'
import { ErrorText } from '@/components/lockin/chain-actions'
import { formatAmount } from '@/components/lockin/format'
import { Padlock } from '@/components/lockin/padlock'
import { Screen } from '@/components/lockin/screen'
import { colors, fonts, radius, space } from '@/components/lockin/theme'
import { Button, Card, Divider, Logo, T, Toggle } from '@/components/lockin/ui'
import { now as clockNow } from '@/lib/dev/clock'
import { distinctCheckInDays, Pledge, pledgeStatus } from '@/lib/pledge/pledge'
import { usePledges } from '@/lib/pledge/pledge-provider'

/**
 * The achievement card. Only the card is shared, as an image: no app screen, no wallet address.
 * It says what is true right now: a return is only mentioned once it is confirmed.
 */
export default function ShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { pledges } = usePledges()
  const pledge = useMemo(() => pledges.find((p) => p.id === id), [pledges, id])
  const [withAmount, setWithAmount] = useState(false)
  const [withName, setWithName] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const card = useRef<View>(null)

  if (!pledge) {
    return (
      <Screen title="Share achievement" back>
        <T variant="body">This goal is no longer on this phone.</T>
      </Screen>
    )
  }

  async function onShare() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' })
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your Lock-In card' })
    } catch {
      setError('Couldn’t create the image. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title="Share achievement"
      back
      fullScreen
      footer={
        <>
          <ErrorText error={error} />
          <Button
            icon={busy ? undefined : Share2}
            label={busy ? 'Preparing…' : 'Share card'}
            onPress={onShare}
            loading={busy}
          />
          <T variant="caption" style={{ textAlign: 'center' }}>
            Only the card above will be shared.
          </T>
        </>
      }
    >
      <T variant="label">Preview</T>
      <View ref={card} collapsable={false} style={styles.capture}>
        <AchievementCard pledge={pledge} withAmount={withAmount} withName={withName} />
      </View>

      <Card style={{ paddingVertical: 4, gap: 0 }}>
        <View style={styles.toggleRow}>
          <T variant="body" style={{ flex: 1 }}>
            Include deposit amount
          </T>
          <Toggle value={withAmount} onChange={setWithAmount} label="Include deposit amount" />
        </View>
        <Divider />
        <View style={styles.toggleRow}>
          <T variant="body" style={{ flex: 1 }}>
            Include goal name
          </T>
          <Toggle value={withName} onChange={setWithName} label="Include goal name" />
        </View>
      </Card>
    </Screen>
  )
}

function AchievementCard({ pledge, withAmount, withName }: { pledge: Pledge; withAmount: boolean; withName: boolean }) {
  const now = clockNow()
  const status = pledgeStatus(pledge, now)
  const done = Math.min(distinctCheckInDays(pledge), pledge.durationDays)
  const returned = status === 'completed' && !!pledge.claimedAt
  const headline =
    status === 'completed' ? 'You kept your word.' : status === 'verifying' ? 'Waiting for late steps.' : 'Still going.'
  const money =
    status === 'completed'
      ? returned
        ? `${formatAmount(pledge.amountSkr)} back in the wallet`
        : `${formatAmount(pledge.amountSkr)} deposit`
      : `${formatAmount(pledge.amountSkr)} on the line`
  return (
    <View style={styles.card}>
      <Logo size={30} />
      <View style={{ alignItems: 'center' }}>
        <Text maxFontSizeMultiplier={1} style={styles.score}>
          {done}/{pledge.durationDays}
        </Text>
        <Text maxFontSizeMultiplier={1} style={styles.scoreLabel}>
          {pledge.durationDays === 1 ? 'DAY' : 'DAYS'} COMPLETED
        </Text>
      </View>
      <View style={styles.rule} />
      {withName && (
        <Text maxFontSizeMultiplier={1.2} style={styles.goal} numberOfLines={2}>
          {pledge.goal}
        </Text>
      )}
      <View style={styles.badge}>
        <Text maxFontSizeMultiplier={1.2} style={styles.badgeText}>
          {headline}
        </Text>
      </View>
      {withAmount && (
        <Text maxFontSizeMultiplier={1.2} style={styles.money}>
          {money}
        </Text>
      )}
      <View style={styles.footer}>
        <Padlock size={14} />
        <Text maxFontSizeMultiplier={1} style={styles.footerText}>
          KEEP YOUR WORD.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  capture: { backgroundColor: colors.bg, borderRadius: radius.lg },
  card: {
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: 28,
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.bg,
  },
  score: { fontFamily: fonts.brand, fontSize: 112, lineHeight: 118, color: colors.accent, letterSpacing: -2 },
  scoreLabel: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 3, color: colors.text },
  rule: { height: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  goal: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.text, textAlign: 'center' },
  badge: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
  },
  badgeText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.accent },
  money: { fontFamily: fonts.medium, fontSize: 14, color: colors.textSecondary },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerText: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 3, color: colors.textSecondary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
})

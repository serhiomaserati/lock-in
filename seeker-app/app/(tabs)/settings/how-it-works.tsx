import { CalendarDays, CircleAlert, Coins, LifeBuoy, ShieldCheck } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { Screen } from '@/components/lockin/screen'
import { colors, space } from '@/components/lockin/theme'
import { Card, Collapsible, Divider, InfoLine, Notice, T } from '@/components/lockin/ui'
import { isLockEnabled, isMainnet, LockInConfig } from '@/constants/lockin'

const RULES = [
  { n: '01', title: 'Lock a deposit', body: 'Choose your goal, its duration and the amount.' },
  { n: '02', title: 'Show up each day', body: 'Complete the required days. One spare day is included.' },
  {
    n: '03',
    title: 'Get your deposit back',
    body: 'Complete your goal and the full deposit returns. No bonus, no yield.',
  },
]

export default function HowItWorksScreen() {
  const onChain = isLockEnabled()
  return (
    <Screen title="How deposits work" back>
      {RULES.map((r) => (
        <Card key={r.n} style={styles.rule}>
          <T variant="numberMd" style={styles.n}>
            {r.n}
          </T>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="heading">{r.title}</T>
            <T variant="small">{r.body}</T>
          </View>
        </Card>
      ))}

      <Notice tone="warning" icon={CircleAlert} title="If you miss your goal">
        Your deposit goes to the recipient shown before you create the goal
        {onChain && !isMainnet() ? ' (on devnet: a test treasury)' : ''}. It is never paid to other users.
      </Notice>

      <Card style={{ paddingVertical: 0, gap: 0 }}>
        <Collapsible icon={CalendarDays} title="Calendar and late data">
          <T variant="small">
            A goal starts at the next midnight and keeps the time zone it was created in, so its days never shift. Hit
            your goal on N of N + 1 calendar days: you can miss one day.
          </T>
          <T variant="small">
            Step data can arrive late (for example from a watch), so for 24 hours after the goal ends, its days still
            count.
          </T>
        </Collapsible>
        <Divider />
        <Collapsible icon={ShieldCheck} title="Step verification">
          <T variant="small">
            Steps are read from Health Connect. Manually entered steps don&apos;t count, and a walk recorded by both
            your phone and a watch counts once.
          </T>
          {onChain && (
            <T variant="small">
              Each completed day is written on Solana by a key kept on this phone, so there is no wallet pop-up every
              day. The program can&apos;t see your steps. It relies on your phone&apos;s check.
            </T>
          )}
        </Collapsible>
        <Divider />
        <Collapsible icon={Coins} title="Network fees">
          <T variant="small">
            Locking a deposit, linking a phone and returning a deposit are Solana transactions paid in SOL. Your wallet
            shows each fee before you sign. Recording your days uses a small SOL balance kept on this phone.
          </T>
        </Collapsible>
        <Divider />
        <Collapsible icon={LifeBuoy} title="Emergency mode">
          <T variant="small">
            If something goes wrong on Lock-In&apos;s side, safe mode pauses every forfeit. While it is on, you can take
            your deposit back to your wallet.
          </T>
        </Collapsible>
      </Card>

      <InfoLine>
        {!onChain
          ? 'Demo. No real funds move.'
          : isMainnet()
            ? 'Solana mainnet. Deposits are in SKR, with a minimum and a maximum per goal. Lock-In is new: its developer can still update the program.'
            : `Devnet. Test tokens only (${LockInConfig.tokenSymbol}). While Lock-In is being tested, its developer can still update the program.`}
      </InfoLine>
    </Screen>
  )
}

const styles = StyleSheet.create({
  rule: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  n: { color: colors.accent, minWidth: 44 },
})

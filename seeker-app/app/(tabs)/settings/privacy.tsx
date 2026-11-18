import type { LucideIcon } from 'lucide-react-native'
import { ExternalLink, Globe, Heart, Network, Smartphone } from 'lucide-react-native'
import { PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'
import { Screen } from '@/components/lockin/screen'
import { colors, space } from '@/components/lockin/theme'
import { Card, DemoNote, ListRow, T } from '@/components/lockin/ui'
import { AppConfig } from '@/constants/app-config'
import { openStepSettings } from '@/lib/proof/steps'
import { openSitePage } from '@/lib/site'

// In-app summary of the full privacy policy (website/privacy.html). Keep the two in line.
export default function PrivacyScreen() {
  return (
    <Screen title="Privacy" back>
      <View style={{ gap: space.sm, marginBottom: space.sm }}>
        <T variant="hero" style={{ fontSize: 28, lineHeight: 34 }}>
          Your data, clearly explained.
        </T>
        <T variant="body" style={{ color: colors.textSecondary }}>
          Lock-In keeps as little as it can. Here is what stays on your phone and what is recorded on Solana.
        </T>
      </View>

      <Group icon={Smartphone} title="On this phone">
        <Line>Goal names</Line>
        <Line>Exact step counts</Line>
        <Line>This phone&apos;s check-in key</Line>
        <T variant="caption">
          Lock-In has no server and doesn&apos;t send these anywhere. A goal name only leaves the phone if you put it on
          a share card yourself.
        </T>
      </Group>

      <Group icon={Globe} title="Public on Solana">
        <Line>Wallet address and deposit</Line>
        <Line>Goal rules: type, step target, days, day boundaries, time zone name</Line>
        <Line>Which days were completed, and the outcome</Line>
        <T variant="caption">
          Anyone can read these, and they can&apos;t be erased by deleting the app. Your step counts are never recorded
          there, only that a day was completed.
        </T>
      </Group>

      <Card style={{ paddingVertical: 0 }}>
        <ListRow
          icon={Heart}
          label="Health Connect"
          detail="Steps only, only while you have a step goal, to check your days."
          onPress={() => openStepSettings()}
        />
      </Card>
      <Card style={{ paddingVertical: 0 }}>
        <ListRow
          icon={Network}
          label="Network services"
          detail="The Solana RPC service and your wallet app receive connection data such as your IP address."
        />
      </Card>
      <Card style={{ paddingVertical: 0 }}>
        <ListRow
          icon={ExternalLink}
          label="Full privacy policy"
          detail={`${AppConfig.domain}/privacy.html`}
          onPress={() => openSitePage('privacy.html')}
        />
      </Card>
      <T variant="caption">
        Remove everything Lock-In keeps on this phone in Settings → Delete local data. Lock-In never sees your wallet
        keys or recovery phrase.
      </T>
      <DemoNote />
    </Screen>
  )
}

function Group({ icon: Icon, title, children }: PropsWithChildren<{ icon: LucideIcon; title: string }>) {
  return (
    <Card style={styles.group}>
      <Icon size={24} color={colors.textSecondary} strokeWidth={1.75} />
      <View style={{ flex: 1, gap: 6 }}>
        <T variant="label" style={{ color: colors.text }}>
          {title}
        </T>
        {children}
      </View>
    </Card>
  )
}

function Line({ children }: PropsWithChildren) {
  return <T variant="body">{children}</T>
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
})

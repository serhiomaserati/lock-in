import { useRouter } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import { CalendarDays, Target, WalletCards } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/components/auth/auth-provider'
import { ErrorText } from '@/components/lockin/chain-actions'
import { colors, radius, space } from '@/components/lockin/theme'
import { Button, DemoBadge, DemoNote, Logo, T } from '@/components/lockin/ui'
import { SampleTrack } from '@/components/lockin/week-track'
import { explainChainError } from '@/lib/chain/lockin-program'

export default function SignIn() {
  const router = useRouter()
  const { signIn } = useAuth()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConnect() {
    if (connecting) return
    setConnecting(true)
    setError(null)
    try {
      await signIn()
    } catch (e) {
      // Wallet declined or unavailable: stay on this screen, but say so. A silent no-op
      // looks like the button is broken.
      console.warn('Lock-In: wallet sign-in failed', e)
      setError(`Couldn't connect the wallet: ${explainChainError(e)}`)
    } finally {
      setConnecting(false)
    }
    // No manual navigation: Stack.Protected in app/_layout.tsx swaps to (tabs) once
    // authenticated. Navigating here too raced it and crashed Fabric on Android.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <Logo size={32} />
          <DemoBadge />
        </View>
        <T variant="hero" style={styles.hero} accessibilityRole="header">
          Keep{'\n'}your word.
        </T>
        <SampleTrack />
        <T variant="heading" style={{ fontSize: 22, lineHeight: 28 }}>
          A goal. A deposit.{'\n'}A reason to follow through.
        </T>
        <View style={{ gap: space.lg }}>
          <Feature
            icon={Target}
            title="Set your goal"
            body="Daily steps from Health Connect, or any goal you check in yourself."
          />
          <Feature icon={CalendarDays} title="Show up each day" body="Complete the days. One spare day is included." />
          <Feature
            icon={WalletCards}
            title="Get your deposit back"
            body="Finish your goal and the full deposit is returned to you."
          />
        </View>
        <T variant="small">Miss the goal and your deposit is not returned.</T>
      </ScrollView>
      <View style={styles.footer}>
        <ErrorText error={error} />
        <Button label={connecting ? 'Connecting…' : 'Connect wallet'} onPress={onConnect} loading={connecting} />
        <View style={styles.links}>
          <Link label="Privacy" onPress={() => router.push('/info/privacy')} />
          <T variant="caption">·</T>
          <Link label="How it works" onPress={() => router.push('/info/how-it-works')} />
        </View>
        <DemoNote />
      </View>
    </SafeAreaView>
  )
}

function Feature({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Icon size={24} color={colors.text} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong">{title}</T>
        <T variant="small">{body}</T>
      </View>
    </View>
  )
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8} style={styles.link}>
      <T variant="small" style={{ textDecorationLine: 'underline' }}>
        {label}
      </T>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  content: { paddingHorizontal: space.screen, paddingTop: space.lg, paddingBottom: space.xl, gap: space.xl },
  hero: { fontSize: 56, lineHeight: 58, letterSpacing: -2 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  featureIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { paddingHorizontal: space.screen, paddingBottom: space.md, paddingTop: space.sm, gap: space.sm },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.md },
  link: { minHeight: 40, justifyContent: 'center' },
})

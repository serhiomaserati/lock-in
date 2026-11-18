import { useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { PropsWithChildren, ReactNode } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, space, TOUCH } from './theme'
import { DemoBadge, Logo, T } from './ui'

/**
 * Every Lock-In screen on the graphite canvas.
 * - Root tabs: `logo` puts the LOCK-IN wordmark and the Devnet badge on top; `title` + `large` is the big title.
 * - Inner screens: `back` + `title` (+ `right` actions).
 * A `footer` stays above the keyboard, so errors and the main button remain reachable while typing.
 */
export function Screen({
  title,
  back,
  large,
  logo,
  right,
  titleRight,
  scroll = true,
  footer,
  contentStyle,
  fullScreen,
  children,
}: PropsWithChildren<{
  /** No tab bar below (see tab-bar.tsx FULL_SCREEN): the footer keeps clear of the system navigation. */
  fullScreen?: boolean
  title?: string
  back?: boolean
  large?: boolean
  logo?: boolean
  right?: ReactNode
  /** Next to a large title (e.g. the New button). */
  titleRight?: ReactNode
  scroll?: boolean
  footer?: ReactNode
  contentStyle?: StyleProp<ViewStyle>
}>) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const keyboard = useAnimatedKeyboard()
  // A full screen reaches the bottom edge, so the keyboard covers its height less the system navigation the footer
  // already pads for. (KeyboardAvoidingView mis-measures on edge-to-edge Android: the footer stayed raised.)
  const keyboardPad = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value - insets.bottom, 0) }))
  const largeTitle =
    large && title ? (
      <View style={styles.largeTitle}>
        <T variant="title" style={{ flex: 1 }} numberOfLines={2}>
          {title}
        </T>
        {titleRight}
      </View>
    ) : null
  // The large title scrolls away with the content; the wordmark row stays.
  const body = (
    <>
      {largeTitle}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </>
  )
  // A root screen with only a large title needs no header row above it.
  const header = back || (!!title && !large) || !!right

  const content = (
    <>
      {logo ? (
        <View style={styles.logoRow}>
          <Logo />
          <View style={styles.right}>
            {right}
            <DemoBadge />
          </View>
        </View>
      ) : header ? (
        <View style={styles.header}>
          {back && (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft size={24} color={colors.text} />
            </Pressable>
          )}
          <View style={{ flex: 1 }}>
            {title && !large ? (
              <T variant="heading" style={{ fontSize: 20, lineHeight: 26 }} numberOfLines={1}>
                {title}
              </T>
            ) : null}
          </View>
          <View style={styles.right}>{right}</View>
        </View>
      ) : (
        <View style={{ height: space.md }} />
      )}
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer ? (
        <View style={[styles.footer, fullScreen && { paddingBottom: space.md + insets.bottom }]}>{footer}</View>
      ) : null}
    </>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Edge-to-edge Android doesn't resize the window for the keyboard, so pad for it on both platforms. */}
      {fullScreen ? (
        <Animated.View style={[{ flex: 1 }, keyboardPad]}>{content}</Animated.View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {content}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}

/** Small uppercase section label ("IN PROGRESS", "TODAY"). */
export function SectionLabel({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
  return (
    <View style={styles.section}>
      <T variant="label" style={{ flex: 1 }}>
        {children}
      </T>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.screen,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    minHeight: 56,
  },
  back: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  largeTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.screen,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  scroll: { paddingBottom: 40 },
  content: { paddingHorizontal: space.screen, gap: space.md },
  section: { flexDirection: 'row', alignItems: 'center', marginTop: space.md },
  footer: {
    paddingHorizontal: space.screen,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
})

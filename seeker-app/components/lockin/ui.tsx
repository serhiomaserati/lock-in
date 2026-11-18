import type { LucideIcon } from 'lucide-react-native'
import { ChevronDown, ChevronRight, ChevronUp, Info } from 'lucide-react-native'
import { PropsWithChildren, ReactNode, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native'
import { Padlock } from './padlock'
import { colors, fonts, radius, space, TOUCH } from './theme'
import { isLockEnabled, isMainnet, LockInConfig } from '@/constants/lockin'

// ---------- Text ----------

type Variant =
  | 'hero'
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'small'
  | 'smallStrong'
  | 'caption'
  | 'label'
  | 'number'
  | 'numberMd'
  | 'numberSm'

const variants: Record<Variant, TextStyle> = {
  hero: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colors.text },
  display: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colors.text },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6, color: colors.text },
  heading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.text },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.text },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  smallStrong: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.text },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: colors.textTertiary },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  number: { fontFamily: fonts.number, fontSize: 56, lineHeight: 60, color: colors.text },
  numberMd: { fontFamily: fonts.number, fontSize: 36, lineHeight: 40, color: colors.text },
  numberSm: { fontFamily: fonts.number, fontSize: 26, lineHeight: 30, color: colors.text },
}

const NUMBER_VARIANTS: Variant[] = ['number', 'numberMd', 'numberSm']

export function T({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  // Big numbers still grow with the system font size, but not past the card.
  const numeric = NUMBER_VARIANTS.includes(variant)
  return <Text maxFontSizeMultiplier={numeric ? 1.25 : undefined} {...props} style={[variants[variant], style]} />
}

/** The LOCK-IN wordmark with the lime padlock. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <View style={styles.logo} accessibilityRole="header" accessibilityLabel="Lock-In">
      <Text
        maxFontSizeMultiplier={1}
        style={{
          fontFamily: fonts.brand,
          fontSize: size,
          lineHeight: size * 1.1,
          color: colors.text,
          letterSpacing: -0.5,
        }}
      >
        LOCK-IN
      </Text>
      <Padlock size={size * 0.78} />
    </View>
  )
}

// ---------- Layout ----------

type CardTone = 'default' | 'accent' | 'warning' | 'danger'

const cardBorder: Record<CardTone, string> = {
  default: colors.border,
  accent: colors.accent,
  warning: colors.warning,
  danger: colors.danger,
}

export function Card({
  children,
  style,
  onPress,
  tone = 'default',
  accessibilityLabel,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  tone?: CardTone
  accessibilityLabel?: string
}>) {
  const toneStyle = tone === 'default' ? null : { borderColor: cardBorder[tone] }
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, toneStyle, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    )
  }
  return <View style={[styles.card, toneStyle, style]}>{children}</View>
}

export function Divider({ vertical }: { vertical?: boolean }) {
  return <View style={vertical ? styles.dividerV : styles.dividerH} />
}

// ---------- Buttons ----------

type ButtonKind = 'primary' | 'outline' | 'secondary' | 'ghost' | 'danger'

const buttonFg: Record<ButtonKind, string> = {
  primary: colors.onAccent,
  outline: colors.accent,
  secondary: colors.text,
  ghost: colors.accent,
  danger: colors.danger,
}

/** One action. While `loading`, it shows progress and ignores further taps. */
export function Button({
  label,
  onPress,
  kind = 'primary',
  icon: Icon,
  disabled,
  loading,
  compact,
  style,
}: {
  label: string
  onPress?: () => void
  kind?: ButtonKind
  icon?: LucideIcon
  disabled?: boolean
  loading?: boolean
  compact?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const fg = buttonFg[kind]
  const inactive = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      hitSlop={compact ? 6 : undefined}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        kind === 'primary' && { backgroundColor: colors.accent },
        kind === 'outline' && { borderWidth: 1.5, borderColor: colors.accent },
        kind === 'secondary' && { borderWidth: 1, borderColor: colors.borderStrong },
        (kind === 'ghost' || kind === 'danger') && styles.buttonText,
        disabled && !loading && { opacity: 0.4 },
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={18} color={fg} /> : null}
      <T variant="bodyStrong" style={{ color: fg, fontSize: compact ? 14 : 16 }} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  )
}

export function IconButton({
  icon: Icon,
  onPress,
  color = colors.text,
  label,
}: {
  icon: LucideIcon
  onPress: () => void
  color?: string
  label: string
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon size={22} color={color} />
    </Pressable>
  )
}

// ---------- Status ----------

export type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'neutral'

const toneColors: Record<Tone, { bg: string; fg: string }> = {
  accent: { bg: colors.accentSoft, fg: colors.accent },
  success: { bg: colors.successSoft, fg: colors.success },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  neutral: { bg: colors.neutralSoft, fg: colors.textSecondary },
}

export function Pill({
  label,
  tone = 'neutral',
  icon: Icon,
  dot,
  style,
}: {
  label: string
  tone?: Tone
  icon?: LucideIcon
  dot?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const c = toneColors[tone]
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: c.fg }]} />}
      {Icon && <Icon size={12} color={c.fg} strokeWidth={2.5} />}
      <T variant="caption" style={{ color: c.fg, fontFamily: fonts.semibold }}>
        {label}
      </T>
    </View>
  )
}

/** On every root screen while Lock-In runs on a test network (nothing on mainnet). */
export function DemoBadge() {
  if (isMainnet()) return null
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: colors.accent }]} />
      <T variant="caption" style={{ color: colors.text, fontFamily: fonts.semibold }}>
        {isLockEnabled() ? 'Devnet' : 'Demo'}
      </T>
    </View>
  )
}

export function DemoNote() {
  if (isMainnet()) return null
  return (
    <T variant="caption" style={{ textAlign: 'center' }}>
      {isLockEnabled() ? `Devnet · Test tokens (${LockInConfig.tokenSymbol}), no real value` : 'Demo · No real funds'}
    </T>
  )
}

export function ProgressBar({ value, color = colors.accent }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value))
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
    >
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  )
}

/** A state that needs explaining: icon, title, short text. */
export function Notice({
  tone,
  icon: Icon,
  title,
  children,
  action,
}: PropsWithChildren<{ tone: Tone; icon: LucideIcon; title: string; action?: ReactNode }>) {
  const c = toneColors[tone]
  return (
    <View style={[styles.notice, { backgroundColor: c.bg, borderColor: c.fg }]}>
      <View style={styles.noticeRow}>
        <Icon size={20} color={c.fg} />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong" style={{ color: c.fg }}>
            {title}
          </T>
          {children ? <T variant="small">{children}</T> : null}
        </View>
      </View>
      {action}
    </View>
  )
}

/** A quiet one-line explanation with an info icon. */
export function InfoLine({ children, icon: Icon = Info }: PropsWithChildren<{ icon?: LucideIcon }>) {
  return (
    <View style={styles.infoLine}>
      <Icon size={16} color={colors.textTertiary} />
      <T variant="caption" style={{ flex: 1, fontSize: 13, lineHeight: 18 }}>
        {children}
      </T>
    </View>
  )
}

/** Settings-style row: icon · label (with a detail line) · right side · chevron. */
export function ListRow({
  icon: Icon,
  label,
  detail,
  detailColor,
  detailDot,
  value,
  onPress,
  right,
  danger,
}: {
  icon: LucideIcon
  label: string
  detail?: string
  detailColor?: string
  detailDot?: string
  value?: string
  onPress?: () => void
  right?: ReactNode
  danger?: boolean
}) {
  const fg = danger ? colors.danger : colors.text
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon size={22} color={danger ? colors.danger : colors.textSecondary} strokeWidth={1.75} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="body" style={{ color: fg }}>
          {label}
        </T>
        {detail ? (
          <View style={styles.detail}>
            <T variant="small" style={detailColor ? { color: detailColor } : undefined}>
              {detail}
            </T>
            {detailDot && <View style={[styles.dot, { backgroundColor: detailDot }]} />}
          </View>
        ) : null}
      </View>
      {value ? <T variant="small">{value}</T> : null}
      {right}
      {onPress ? <ChevronRight size={20} color={colors.textTertiary} /> : null}
    </Pressable>
  )
}

/** Label/value lines, e.g. deposit details. */
export function DetailRows({ rows }: { rows: { label: string; value: string; color?: string }[] }) {
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((r) => (
        <View key={r.label} style={styles.detailRow}>
          <T variant="small">{r.label}</T>
          <T variant="smallStrong" style={[{ flexShrink: 1, textAlign: 'right' }, r.color ? { color: r.color } : null]}>
            {r.value}
          </T>
        </View>
      ))}
    </View>
  )
}

/** A row that opens to show more. No animation: content simply appears. */
export function Collapsible({
  icon: Icon,
  title,
  children,
  initiallyOpen = false,
}: PropsWithChildren<{ icon?: LucideIcon; title: string; initiallyOpen?: boolean }>) {
  const [open, setOpen] = useState(initiallyOpen)
  const Chevron = open ? ChevronUp : ChevronDown
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {Icon && <Icon size={22} color={colors.textSecondary} strokeWidth={1.75} />}
        <T variant="bodyStrong" style={{ flex: 1 }}>
          {title}
        </T>
        <Chevron size={20} color={colors.textSecondary} />
      </Pressable>
      {open && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  )
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      accessibilityLabel={label}
      trackColor={{ true: colors.accent, false: colors.borderStrong }}
      thumbColor={value ? colors.onAccent : colors.textSecondary}
    />
  )
}

/** Small stat block: icon, value, label. */
export function Tile({
  icon: Icon,
  value,
  label,
  iconColor = colors.textSecondary,
  style,
}: {
  icon: LucideIcon
  value: string
  label: string
  iconColor?: string
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Card style={[styles.tile, style]}>
      <Icon size={22} color={iconColor} strokeWidth={1.75} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="numberSm" numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </T>
        <T variant="small">{label}</T>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  pressed: { opacity: 0.75 },
  dividerH: { height: 1, backgroundColor: colors.border },
  dividerV: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    minHeight: 52,
    paddingHorizontal: space.lg,
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.md },
  buttonText: { minHeight: TOUCH, paddingHorizontal: space.sm },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: TOUCH / 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill },
  notice: { gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  noticeRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  infoLine: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: 10 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md },
  collapsibleBody: { paddingBottom: space.md, gap: space.sm },
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
})

/** Equal-width option row (step target, duration…). */
export function Segmented<V extends string | number>({
  options,
  value,
  onChange,
  format = String,
  label,
}: {
  options: readonly V[]
  value: V
  onChange: (v: V) => void
  format?: (v: V) => string
  label?: string
}) {
  return (
    <View style={segStyles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o === value
        return (
          <Pressable
            key={String(o)}
            onPress={() => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [
              segStyles.item,
              on && { backgroundColor: colors.accent, borderColor: colors.accent },
              pressed && styles.pressed,
            ]}
          >
            <T
              variant="smallStrong"
              style={{ color: on ? colors.onAccent : colors.text, fontSize: 14 }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {format(o)}
            </T>
          </Pressable>
        )
      })}
    </View>
  )
}

const segStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
})

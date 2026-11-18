// Lock-In design tokens: dark, sporty. Graphite surfaces, one lime accent for the main action and for
// "done", amber for waiting, a soft red only for a real loss. Solid colours: no glow, gradients or heavy shadows.

export const colors = {
  bg: '#111310',
  card: '#1B1E18',
  /** Inputs, chips and the inside of cards. */
  raised: '#22261F',
  border: '#30352B',
  /** Outlined secondary buttons. */
  borderStrong: '#4A5143',
  text: '#F5F6F0',
  textSecondary: '#A3AA99',
  /** Captions; ≥ 4.5:1 on cards. */
  textTertiary: '#8A9182',
  accent: '#D4F66A',
  /** Text and icons on a lime surface. */
  onAccent: '#111310',
  accentSoft: 'rgba(212,246,106,0.12)',
  // Done = the accent: lime marks both the main action and completion.
  success: '#D4F66A',
  successSoft: 'rgba(212,246,106,0.12)',
  warning: '#E6BE76',
  warningSoft: 'rgba(230,190,118,0.12)',
  danger: '#EFA89C',
  dangerSoft: 'rgba(239,168,156,0.12)',
  neutralSoft: '#262A22',
  track: '#30352B',
  white: '#FFFFFF',
}

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  /** Big numbers (steps, amounts, times). */
  number: 'BarlowCondensed_700Bold',
  /** The LOCK-IN wordmark and the share card's score. */
  brand: 'BarlowCondensed_800ExtraBold_Italic',
}

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 }

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, screen: 20 }

/** Minimum touch target (dp). */
export const TOUCH = 48

import { PropsWithChildren } from 'react'
import { DarkTheme, Theme, ThemeProvider } from '@react-navigation/native'
import { colors } from '@/components/lockin/theme'

// Lock-In is dark only: navigation surfaces (screen backgrounds during transitions) use its palette.
const LockInNavTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
}

export function useAppTheme() {
  return { colorScheme: 'dark' as const, isDark: true, theme: LockInNavTheme }
}

export function AppTheme({ children }: PropsWithChildren) {
  return <ThemeProvider value={LockInNavTheme}>{children}</ThemeProvider>
}

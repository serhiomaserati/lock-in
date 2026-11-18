import { Stack } from 'expo-router'
import { colors } from '@/components/lockin/theme'

export default function SettingsLayout() {
  // Headers are drawn by <Screen>.
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
}

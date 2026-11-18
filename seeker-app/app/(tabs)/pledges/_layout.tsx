import { Stack } from 'expo-router'
import { colors } from '@/components/lockin/theme'

export default function PledgesLayout() {
  // Headers are drawn by <Screen>, so the native ones stay hidden.
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
}

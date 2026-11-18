import { WalletUiDropdown } from '@/components/solana/wallet-ui-dropdown'
import { Stack } from 'expo-router'
import { colors } from '@/components/lockin/theme'

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: 'Account',
        headerRight: () => <WalletUiDropdown />,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="airdrop" options={{ headerTitle: 'Airdrop', headerRight: () => null }} />
      <Stack.Screen name="receive" options={{ headerTitle: 'Receive', headerRight: () => null }} />
    </Stack>
  )
}

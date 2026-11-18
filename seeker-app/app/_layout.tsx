import { PortalHost } from '@rn-primitives/portal'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { AppProviders } from '@/components/app-providers'
import { useCallback } from 'react'
import * as SplashScreen from 'expo-splash-screen'
import { LogBox, View } from 'react-native'
import { useTrackLocations } from '@/hooks/use-track-locations'
import { AppSplashController } from '@/components/app-splash-controller'
import { ReminderSync } from '@/components/lockin/reminder-sync'
import { useAuth } from '@/components/auth/auth-provider'
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular'
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium'
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold'
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold'
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold'
import { BarlowCondensed_800ExtraBold_Italic } from '@expo-google-fonts/barlow-condensed/800ExtraBold_Italic'
import { colors } from '@/components/lockin/theme'

SplashScreen.preventAutoHideAsync()

// Debug builds: the public devnet RPC rate-limits often; web3.js retries by itself, so its notices are just noise on screen.
LogBox.ignoreLogs([/429/, /Too many requests/i])

export default function RootLayout() {
  // Use this hook to track the locations for analytics or debugging.
  // Delete if you don't need it.
  useTrackLocations((pathname, params) => {
    console.log(`Track ${pathname}`, { params })
  })
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold_Italic,
  })

  const onLayoutRootView = useCallback(async () => {
    console.log('onLayoutRootView')
    if (loaded) {
      console.log('loaded')
      // This tells the splash screen to hide immediately! If we call this after
      // `setAppIsReady`, then we may see a blank screen while the app is
      // loading its initial state and rendering its first pixels. So instead,
      // we hide the splash screen once we know the root view has already
      // performed layout.
      await SplashScreen.hideAsync()
    }
  }, [loaded])

  if (!loaded) {
    // Async font loading only occurs in development.
    return null
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayoutRootView}>
      <AppProviders>
        <AppSplashController />
        <RootNavigator />
        <ReminderSync />
        <StatusBar style="light" />
      </AppProviders>
      <PortalHost />
    </View>
  )
}

function RootNavigator() {
  const { isAuthenticated } = useAuth()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      {/* Readable signed in or not (linked from the sign-in screen). */}
      <Stack.Screen name="info/privacy" />
      <Stack.Screen name="info/how-it-works" />
    </Stack>
  )
}

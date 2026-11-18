import { Tabs } from 'expo-router'
import { Settings, Target, Wallet } from 'lucide-react-native'
import React from 'react'
import { TabBar } from '@/components/lockin/tab-bar'
import { colors } from '@/components/lockin/theme'

export default function TabLayout() {
  return (
    // Our own bar: the default one cross-fades icons in a way that crashes Fabric (see tab-bar.tsx).
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={(props) => <TabBar {...props} />}
    >
      {/* The index redirects to the goals screen */}
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="pledges"
        options={{ title: 'Goals', tabBarIcon: ({ color }) => <Target size={24} color={color} strokeWidth={1.75} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Wallet', tabBarIcon: ({ color }) => <Wallet size={24} color={color} strokeWidth={1.75} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Settings size={24} color={color} strokeWidth={1.75} />,
        }}
      />
      {/* Template demo screen kept in the bundle but hidden from the tab bar */}
      <Tabs.Screen name="demo" options={{ href: null }} />
    </Tabs>
  )
}

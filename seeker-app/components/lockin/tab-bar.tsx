import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { getFocusedRouteNameFromRoute } from '@react-navigation/native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fonts } from './theme'

/**
 * The bottom tab bar. Replaces React Navigation's default bar on purpose: that one draws every
 * icon twice and cross-fades them with opacity 0/1, so on each tab switch Android Fabric flattens
 * one wrapper view and un-flattens the other. After the tabs mount during a wallet round-trip,
 * that un-flatten can lose its native view and crash the app
 * ("RetryableMountingLayerException: Unable to find viewState for tag").
 * Here each icon is drawn once and only its color changes.
 *
 * Tabs without a `tabBarIcon` (routes hidden with `href: null`) are not shown.
 * Full-screen flows (new goal, share card) hide the bar: they have their own back arrow and bottom button.
 */
const FULL_SCREEN = ['create', 'share']

export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const screen = getFocusedRouteNameFromRoute(state.routes[state.index])
  if (screen && FULL_SCREEN.includes(screen)) return null
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]
        if (!options.tabBarIcon) return null
        const focused = state.index === index
        const color = focused ? colors.accent : colors.textSecondary
        const label = options.title ?? route.name

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params)
        }
        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key })

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            style={styles.item}
          >
            {options.tabBarIcon({ focused, color, size: 24 })}
            <Text style={[styles.label, { color }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 60,
    paddingTop: 8,
    paddingBottom: 6,
  },
  label: { fontFamily: fonts.semibold, fontSize: 12 },
})

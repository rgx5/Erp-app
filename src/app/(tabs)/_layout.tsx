import React from 'react'
import { View } from 'react-native'
import { Redirect, Tabs } from 'expo-router'
import type { BottomTabBarProps } from 'expo-router/tabs'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIndustry } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { T } from '@/ui/Text'
import { Tap } from '@/ui/primitives'
import { ChartColumn, Home, Menu, Package, ReceiptText } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const ICONS = { index: Home, items: Package, sell: ReceiptText, reports: ChartColumn, more: Menu } as const

/**
 * Bottom navigation: four places and the one action that matters most — selling — as a raised button in the middle.
 * Cashiers only see what their role allows (Home, Sell, More).
 */
function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { c, shadow } = useTheme()
  const insets = useSafeAreaInsets()
  const labels = useIndustry().labels
  const inventory = useCan('inventory')
  const reports = useCan('reports')
  const names: Record<string, string> = { index: 'Home', items: labels.items, sell: labels.sale, reports: 'Reports', more: 'More' }
  const visible = state.routes.filter((r) => (r.name === 'items' ? inventory : r.name === 'reports' ? reports : true))

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end', backgroundColor: c.surface, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10), borderTopWidth: 1, borderTopColor: c.line, paddingHorizontal: 6 }]}>
      {visible.map((route) => {
        const focused = state.routes[state.index].key === route.key
        const Icon = ICONS[route.name as keyof typeof ICONS] ?? Home
        const press = () => { if (!focused) navigateToTab(route.key) }
        if (route.name === 'sell') {
          return (
            <View key={route.key} style={{ flex: 1, alignItems: 'center' }}>
              <Tap onPress={press} accessibilityLabel={`New ${labels.sale.toLowerCase()}`} style={[{ marginTop: -26, borderRadius: 30 }, shadow(3)]}>
                <LinearGradient colors={['#4C7CFF', '#1B3FD1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: c.surface }}>
                  <Icon size={26} color="#fff" strokeWidth={2} />
                </LinearGradient>
              </Tap>
              <T v="micro" style={{ color: focused ? c.primary : c.inkMute, marginTop: 4 }}>{names.sell}</T>
            </View>
          )
        }
        return (
          <Tap key={route.key} onPress={press} accessibilityLabel={names[route.name]} accessibilityState={{ selected: focused }} style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 }}>
            <View style={{ height: 28, minWidth: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? c.primaryTint : 'transparent' }}>
              <Icon size={22} color={focused ? c.primary : c.inkMute} strokeWidth={focused ? 2.2 : 1.8} />
            </View>
            <T v="micro" style={{ color: focused ? c.primary : c.inkMute }} numberOfLines={1}>{names[route.name]}</T>
          </Tap>
        )
      })}
    </View>
  )
}

export default function TabsLayout() {
  const ws = useApp((s) => s.workspace)
  const session = useApp((s) => s.session)
  if (!ws) return <Redirect href="/welcome" />
  if (!session) return <Redirect href="/who" />
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="items" />
      <Tabs.Screen name="sell" />
      <Tabs.Screen name="reports" />
      <Tabs.Screen name="more" />
    </Tabs>
  )
}

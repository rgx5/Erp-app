import React from 'react'
import { View } from 'react-native'
import { Redirect, Tabs, useRouter, usePathname } from 'expo-router'
import type { BottomTabBarProps } from 'expo-router/tabs'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIndustry } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { Logo } from '@/features/Logo'
import { T } from '@/ui/Text'
import { Tap } from '@/ui/primitives'
import { ChartColumn, Grid, Home, Menu, Package, ReceiptText } from '@/ui/icons'
import { useBreakpoint } from '@/ui/layout'
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

/**
 * A permanent left column, in place of the bottom bar, once there is room for one (a desktop window or a tablet in
 * landscape). Same five places, plus a straight link into the Apps hub — worth its own row once there is space for
 * it, rather than buried a tap deeper under "More" as it is on a phone.
 */
function SidebarRow({ icon: Icon, label, active, onPress }: { icon: typeof Home; label: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Tap onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected: active }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: active ? c.primaryTint : 'transparent' }}>
      <Icon size={20} color={active ? c.primary : c.inkMute} strokeWidth={active ? 2.2 : 1.8} />
      <T v="body" style={{ color: active ? c.primary : c.inkSoft, fontWeight: active ? '600' : '400' }}>{label}</T>
    </Tap>
  )
}

function Sidebar() {
  const { c } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const labels = useIndustry().labels
  const inventory = useCan('inventory')
  const reports = useCan('reports')
  const names: Record<string, string> = { index: 'Home', items: labels.items, sell: labels.sale, reports: 'Reports', more: 'More' }
  const routes = (['index', 'items', 'sell', 'reports', 'more'] as const).filter((r) => (r === 'items' ? inventory : r === 'reports' ? reports : true))
  const pathOf = (r: string) => (r === 'index' ? '/' : `/${r}`)

  return (
    <View style={{ width: 232, borderRightWidth: 1, borderRightColor: c.line, backgroundColor: c.surface, paddingVertical: 18, paddingHorizontal: 12, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingBottom: 16 }}>
        <Logo size={32} />
        <T v="title">OneSyncERP</T>
      </View>
      {routes.map((r) => (
        <SidebarRow key={r} icon={ICONS[r]} label={names[r]} active={pathname === pathOf(r)} onPress={() => router.push(pathOf(r))} />
      ))}
      <View style={{ height: 1, backgroundColor: c.line, marginVertical: 10 }} />
      <SidebarRow icon={Grid} label="All apps" active={pathname.startsWith('/apps')} onPress={() => router.push('/apps')} />
    </View>
  )
}

export default function TabsLayout() {
  const ws = useApp((s) => s.workspace)
  const session = useApp((s) => s.session)
  const { isDesktop } = useBreakpoint()
  if (!ws) return <Redirect href="/welcome" />
  if (!session) return <Redirect href="/who" />
  const tabs = (
    <Tabs tabBar={isDesktop ? () => null : (p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="items" />
      <Tabs.Screen name="sell" />
      <Tabs.Screen name="reports" />
      <Tabs.Screen name="more" />
    </Tabs>
  )
  if (!isDesktop) return tabs
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Sidebar />
      <View style={{ flex: 1 }}>{tabs}</View>
    </View>
  )
}

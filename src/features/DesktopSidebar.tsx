import React from 'react'
import { View } from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import { useIndustry } from '@/data/hooks'
import { useCan } from '@/data/store'
import { T } from '@/ui/Text'
import { Tap } from '@/ui/primitives'
import { ChartColumn, Grid, Home, Menu, Package, ReceiptText, type IconProps } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { Logo } from './Logo'

const ICONS = { index: Home, items: Package, sell: ReceiptText, reports: ChartColumn, more: Menu } as const

function SidebarRow({ icon: Icon, label, active, onPress }: { icon: React.ComponentType<IconProps>; label: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Tap onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected: active }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: active ? c.primaryTint : 'transparent' }}>
      <Icon size={20} color={active ? c.primary : c.inkMute} strokeWidth={active ? 2.2 : 1.8} />
      <T v="body" style={{ color: active ? c.primary : c.inkSoft, fontWeight: active ? '600' : '400' }}>{label}</T>
    </Tap>
  )
}

/**
 * A permanent left column, in place of the bottom tab bar, once there is room for one (a desktop window or a tablet
 * in landscape). It wraps the *whole* signed-in app (root layout), not just the five tabs — so it stays put while
 * you are in Bills, a module under /m/*, Settings, anywhere — with a direct link into the Apps hub, worth its own
 * row once there is space for it, rather than buried a tap deeper under "More" as it is on a phone.
 */
export function DesktopSidebar() {
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

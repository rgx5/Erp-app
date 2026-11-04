import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import { useIndustry } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { T } from '@/ui/Text'
import { Tap } from '@/ui/primitives'
import { ChartColumn, Grid, Home, Menu, Package, PanelLeftClose, PanelLeftOpen, ReceiptText, type IconProps } from '@/ui/icons'
import { fonts, useTheme } from '@/ui/theme'
import { Logo } from './Logo'

const ICONS = { index: Home, items: Package, sell: ReceiptText, reports: ChartColumn, more: Menu } as const

const COLLAPSED_W = 64
const EXPANDED_W = 232

/** A small label that only appears beside its row on hover — the sidebar's substitute for the visible text a
 * collapsed, icon-only row no longer has room for. Positioned to escape the sidebar's own width so it is never
 * clipped by `overflow: hidden` elsewhere in the row. */
function RowTooltip({ label }: { label: string }) {
  const { c, shadow } = useTheme()
  return (
    <View pointerEvents="none" style={[
      { position: 'absolute', left: COLLAPSED_W + 6, top: '50%', marginTop: -14, paddingHorizontal: 10, height: 28, justifyContent: 'center', borderRadius: 6, backgroundColor: c.ink, zIndex: 50 },
      shadow(2),
    ]}>
      <T style={{ color: c.bg, fontSize: 12.5, fontFamily: fonts.bodyMedium }} numberOfLines={1}>{label}</T>
    </View>
  )
}

function SidebarRow({ icon: Icon, label, active, collapsed, onPress }: { icon: React.ComponentType<IconProps>; label: string; active: boolean; collapsed: boolean; onPress: () => void }) {
  const { c } = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <View style={{ position: 'relative' }}>
      <Tap
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderRadius: 12,
          backgroundColor: active ? c.primaryTint : 'transparent',
          ...(collapsed ? { justifyContent: 'center', width: 40, height: 40, alignSelf: 'center' } : { paddingHorizontal: 14 }),
        }}
      >
        <Icon size={20} color={active ? c.primary : c.inkMute} strokeWidth={active ? 2.2 : 1.8} />
        {collapsed ? null : <T v="body" style={{ color: active ? c.primary : c.inkSoft, fontWeight: active ? '600' : '400' }}>{label}</T>}
      </Tap>
      {collapsed && hovered ? <RowTooltip label={label} /> : null}
    </View>
  )
}

/**
 * A permanent left column, in place of the bottom tab bar, once there is room for one (a desktop window or a tablet
 * in landscape). It wraps the *whole* signed-in app (root layout), not just the five tabs — so it stays put while
 * you are in Bills, a module under /m/*, Settings, anywhere — with a direct link into the Apps hub, worth its own
 * row once there is space for it, rather than buried a tap deeper under "More" as it is on a phone.
 *
 * Collapsed to icons-only (a preference, remembered across restarts), it gives a screen like the counter or a dense
 * report more width without losing navigation — a row's label becomes a hover tooltip instead of disappearing.
 */
export function DesktopSidebar() {
  const { c } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const labels = useIndustry().labels
  const inventory = useCan('inventory')
  const reports = useCan('reports')
  const collapsed = useApp((s) => s.prefs.sidebarCollapsed)
  const setPrefs = useApp((s) => s.setPrefs)
  const names: Record<string, string> = { index: 'Home', items: labels.items, sell: labels.sale, reports: 'Reports', more: 'More' }
  const routes = (['index', 'items', 'sell', 'reports', 'more'] as const).filter((r) => (r === 'items' ? inventory : r === 'reports' ? reports : true))
  const pathOf = (r: string) => (r === 'index' ? '/' : `/${r}`)

  return (
    <View style={{ width: collapsed ? COLLAPSED_W : EXPANDED_W, zIndex: 10, borderRightWidth: 1, borderRightColor: c.line, backgroundColor: c.surface, paddingVertical: 18, paddingHorizontal: collapsed ? 10 : 12, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: collapsed ? 0 : 10, paddingBottom: 16, justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <Logo size={32} />
        {collapsed ? null : <T v="title" numberOfLines={1} style={{ flex: 1 }}>OneSyncERP</T>}
      </View>
      {routes.map((r) => (
        <SidebarRow key={r} icon={ICONS[r]} label={names[r]} active={pathname === pathOf(r)} collapsed={collapsed} onPress={() => router.push(pathOf(r))} />
      ))}
      <View style={{ height: 1, backgroundColor: c.line, marginVertical: 10 }} />
      <SidebarRow icon={Grid} label="All apps" active={pathname.startsWith('/apps')} collapsed={collapsed} onPress={() => router.push('/apps')} />

      <View style={{ flex: 1 }} />
      <View style={{ position: 'relative' }}>
        <SidebarToggle collapsed={collapsed} onPress={() => void setPrefs({ sidebarCollapsed: !collapsed })} />
      </View>
    </View>
  )
}

function SidebarToggle({ collapsed, onPress }: { collapsed: boolean; onPress: () => void }) {
  const { c } = useTheme()
  const [hovered, setHovered] = useState(false)
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <View style={{ position: 'relative' }}>
      <Tap
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderRadius: 12,
          ...(collapsed ? { justifyContent: 'center', width: 40, height: 40, alignSelf: 'center' } : { paddingHorizontal: 14 }),
        }}
      >
        <Icon size={19} color={c.inkMute} strokeWidth={1.8} />
        {collapsed ? null : <T v="body" style={{ color: c.inkMute }}>Collapse</T>}
      </Tap>
      {collapsed && hovered ? <RowTooltip label="Expand sidebar" /> : null}
    </View>
  )
}

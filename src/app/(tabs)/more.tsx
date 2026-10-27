import React from 'react'
import { View } from 'react-native'
import Constants from 'expo-constants'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { ROLE_LABEL } from '@/domain/permissions'
import { signOut } from '@/data/auth'
import { useIndustry, useLabels } from '@/data/hooks'
import { useApp, useCan, useUser } from '@/data/store'
import { PackGlyph } from '@/features/packIcons'
import { useSyncStatus } from '@/features/settingsKit'
import { Screen } from '@/ui/Screen'
import { Avatar, Group, IconWell, Tap } from '@/ui/primitives'
import { ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import {
  Boxes, ChartColumn, ChevronRight, Clock, Cloud, Database, Gift, IdCard, Info, Layers, Grid, Lock, LogOut, Palette, Percent, Printer, Receipt, Store, Tags, Ticket, Truck, Users, UserRound, Wallet,
  type IconProps,
} from '@/ui/icons'
import { ask } from '@/ui/overlays'
import { toneColor, useTheme, type Tone } from '@/ui/theme'

interface Item { label: string; sub?: string; icon: React.ComponentType<IconProps>; tone: Tone; to: string; show?: boolean }

export default function More() {
  const { c } = useTheme()
  const router = useRouter()
  const user = useUser()
  const labels = useLabels()
  const pack = useIndustry()
  const ws = useApp((s) => s.workspace)
  const prefs = useApp((s) => s.prefs)
  const setLocked = useApp((s) => s.setLocked)
  const pending = useApp((s) => s.sync.pending)
  const sync = useSyncStatus()
  const canStock = useCan('stock')
  const canBuy = useCan('purchases')
  const canExp = useCan('expenses')
  const canReports = useCan('reports')
  const canSettings = useCan('settings')

  const run: Item[] = [
    { label: 'All apps', sub: 'Sales, stock, accounts, people and more', icon: Grid, tone: 'primary', to: '/apps' },
    { label: `${labels.sales}`, sub: 'Every bill, return and receipt', icon: Receipt, tone: 'primary', to: '/bills' },
    { label: `${labels.customers}`, sub: 'Contacts, points and credit', icon: Users, tone: 'success', to: '/customers' },
    { label: 'Stock', sub: 'On hand, restock and counts', icon: Boxes, tone: 'accent', to: '/stock', show: canStock },
    { label: 'Purchases', sub: 'Goods received and suppliers', icon: Truck, tone: 'primary', to: '/purchases', show: canBuy },
    { label: 'Expenses', sub: 'Rent, salaries and running costs', icon: Wallet, tone: 'warning', to: '/expenses', show: canExp },
    { label: 'Reports', sub: 'Sales, GST, profit and more', icon: ChartColumn, tone: 'success', to: '/(tabs)/reports', show: canReports },
    { label: 'Day close', sub: 'Count the drawer and close the day', icon: Clock, tone: 'accent', to: '/dayclose', show: canReports },
  ]
  const business: Item[] = [
    { label: 'Business profile', sub: 'Name, address and GSTIN', icon: Store, tone: 'primary', to: '/settings/store' },
    { label: 'Industry', sub: `${pack.name} — the words the app uses`, icon: Layers, tone: 'accent', to: '/settings/industry' },
    { label: 'Tax & GST', sub: 'Slabs and how prices include tax', icon: Percent, tone: 'warning', to: '/settings/tax' },
    { label: 'Receipts', sub: 'Paper width, policy and footer', icon: Printer, tone: 'primary', to: '/settings/receipt' },
    { label: 'Loyalty & rules', sub: 'Points, discount limits, low stock', icon: Gift, tone: 'accent', to: '/settings/loyalty' },
    { label: 'Coupons', sub: 'Codes your customers can use', icon: Ticket, tone: 'success', to: '/settings/coupons' },
    { label: 'Categories', sub: `How each kind of ${labels.item.toLowerCase()} is sold`, icon: Tags, tone: 'primary', to: '/settings/categories' },
    { label: 'Staff & roles', sub: 'Who can do what', icon: IdCard, tone: 'success', to: '/settings/staff' },
    { label: 'Data & backup', sub: 'Export everything or reset this phone', icon: Database, tone: 'warning', to: '/settings/data' },
  ]
  const phone: Item[] = [
    { label: 'Appearance & security', sub: 'Theme, app lock, haptics', icon: Palette, tone: 'accent', to: '/settings/appearance' },
    { label: 'Sync & connection', sub: sync.label, icon: Cloud, tone: ws?.mode === 'remote' ? 'primary' : 'default', to: '/settings/sync' },
    { label: 'About', sub: `${pack.name} · version ${Constants.expoConfig?.version ?? '0.1.0'}`, icon: Info, tone: 'default', to: '/settings/about' },
  ]

  const rows = (items: Item[]) => items.filter((i) => i.show !== false).map((i) => (
    <ListRow key={i.to} icon={<i.icon size={20} color={toneColor(c, i.tone)} />} iconTone={i.tone} title={i.label} subtitle={i.sub} onPress={() => router.push(i.to as never)} />
  ))

  async function leave() {
    const local = ws?.mode !== 'remote'
    const ok = await ask({
      title: 'Sign out of this business?',
      message: local
        ? 'This business lives only on this phone. Signing out erases it — export a backup first from Data & backup.'
        : pending ? `${pending} ${pending === 1 ? 'change has' : 'changes have'} not reached the server yet and will be lost.` : 'Everything is saved on the server. You can sign back in at any time.',
      confirm: 'Sign out', danger: true,
    })
    if (!ok) return
    await signOut()
    router.replace('/welcome')
  }

  return (
    <Screen large title="More" subtitle={ws?.name}>
      <View style={{ gap: 4, paddingBottom: 12 }}>
        <LinearGradient colors={c.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 18, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={user?.name ?? '?'} size={54} />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="h2" tone="hero" numberOfLines={1}>{user?.name ?? 'Signed out'}</T>
              <T v="caption" style={{ color: 'rgba(255,255,255,0.72)' }} numberOfLines={1}>{ws?.name}</T>
            </View>
            {user ? <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' }}><T v="micro" tone="hero">{ROLE_LABEL[user.role]}</T></View> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}><PackGlyph icon={pack.icon} size={17} color="#fff" /></View>
              <T v="caption" style={{ color: 'rgba(255,255,255,0.8)' }} numberOfLines={1}>{ws?.demo ? 'Demo · ' : ''}{pack.name}</T>
            </View>
            <Tap onPress={() => router.push('/who')} accessibilityLabel="Switch user" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)' }}>
              <UserRound size={15} color="#fff" />
              <T v="bodyStrong" tone="hero" style={{ fontSize: 13 }}>Switch user</T>
            </Tap>
          </View>
        </LinearGradient>

        <Tap onPress={() => router.push('/settings/sync')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 12, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <IconWell tone={sync.calm ? (ws?.mode === 'remote' ? 'success' : 'default') : sync.tone === c.danger ? 'danger' : 'warning'} size={38}><sync.Icon size={18} color={sync.tone} /></IconWell>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{sync.label}</T>
            <T v="caption" tone="mute" numberOfLines={2}>{sync.detail}</T>
          </View>
          <ChevronRight size={18} color={c.inkMute} />
        </Tap>

        <Block title="Run the business">{rows(run)}</Block>
        {canSettings ? <Block title="Business settings">{rows(business)}</Block> : null}
        <Block title="This phone">{rows(phone)}</Block>

        <Block title="Session">
          {prefs.appLock ? <ListRow icon={<Lock size={20} color={c.primary} />} title="Lock app now" subtitle="Ask for fingerprint or face to continue" onPress={() => setLocked(true)} /> : null}
          <ListRow icon={<LogOut size={20} color={c.danger} />} title="Sign out" subtitle={ws?.mode === 'remote' ? 'Disconnect this phone from the business' : 'Erase this business from the phone'} danger onPress={leave} chevron={false} />
        </Block>
        <T v="caption" tone="mute" align="center" style={{ marginTop: 22 }}>OneSyncERP · version {Constants.expoConfig?.version ?? '0.1.0'}</T>
      </View>
    </Screen>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const kids = React.Children.toArray(children).filter(Boolean)
  if (!kids.length) return null
  return (
    <View style={{ marginTop: 22 }}>
      <T v="label" tone="mute" style={{ marginBottom: 8, paddingHorizontal: 4 }}>{title.toUpperCase()}</T>
      <Group>{kids}</Group>
    </View>
  )
}

import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { itemName } from '@/modules/manufacturing/bom'
import { isLate, WO_LABEL } from '@/modules/manufacturing/production'
import type { WoStatus } from '@/modules/manufacturing/types'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, ClipboardList, Plus } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'

const TONE: Record<WoStatus, Tone> = { planned: 'default', in_progress: 'primary', done: 'success', cancelled: 'danger' }

/** Work orders: what is planned, on the floor, and finished. */
export default function WorkOrders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const orders = useList('workOrders')
  const data = useApp((s) => s.data)
  const [status, setStatus] = useState<'' | 'open' | WoStatus>('open')
  const rows = useMemo(() => orders.filter((o) => (status === '' ? true : status === 'open' ? o.status === 'planned' || o.status === 'in_progress' : o.status === status)).sort((a, b) => b.createdAt - a.createdAt), [orders, status])
  const now = Date.now()

  if (!can) return <Screen title="Work orders" back><T tone="mute">Work orders are for the owner, managers and stock keepers.</T></Screen>
  return (
    <Screen title="Work orders" subtitle={`${orders.length} orders`} back scroll={false}
      right={<IconButton label="New work order" tone="dark" onPress={() => router.push('/m/manufacturing/orders/new' as never)}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ paddingBottom: 10 }}>
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['open', 'Open'], ['planned', 'Planned'], ['in_progress', 'In progress'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['', 'All']] as Array<[typeof status, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={status === item[0]} onPress={() => setStatus(item[0])} />} />
      </View>
      <FlatList data={rows} keyExtractor={(o) => o.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<ClipboardList size={26} color={c.primary} />} title="No work orders" hint="Plan an order from a recipe, then start it to issue the material." action="New work order" onAction={() => router.push('/m/manufacturing/orders/new' as never)} />}
        renderItem={({ item: o }) => (
          <Tap onPress={() => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: o.id } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{itemName(data, o.outputVariantId)} × {o.qty}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{o.no} · {o.recipeName}{o.dueDate ? ` · due ${fmtDayShort(o.dueDate)}` : ''}</T>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                <Badge tone={TONE[o.status]}>{WO_LABEL[o.status]}</Badge>
                {isLate(o, now) ? <Badge tone="danger">Late</Badge> : null}
                {o.parentId ? <Badge tone="accent">Part</Badge> : null}
              </View>
            </View>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )} />
    </Screen>
  )
}

import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { isOverdue, STATUS_LABEL } from '@/modules/purchasing/logic'
import type { PoStatus } from '@/modules/purchasing/types'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, ClipboardList, Plus } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'

const TONE: Record<PoStatus, Tone> = { draft: 'default', sent: 'primary', partial: 'warning', received: 'success', cancelled: 'danger' }

/** Purchase orders: what has been asked of suppliers and how much has arrived. */
export default function PurchaseOrders() {
  const { c } = useTheme()
  const router = useRouter()
  const canBuy = useCan('purchases')
  const orders = useList('purchaseOrders')
  const suppliers = useList('suppliers')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | 'open' | PoStatus>('')

  const name = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return orders
      .filter((o) => (status === '' ? true : status === 'open' ? o.status === 'sent' || o.status === 'partial' : o.status === status))
      .filter((o) => !n || o.no.toLowerCase().includes(n) || (name.get(o.supplierId) ?? '').toLowerCase().includes(n))
      .sort((a, b) => b.date - a.date)
  }, [orders, q, status, name])
  const now = Date.now()

  if (!canBuy) return <Screen title="Purchase orders" back><T tone="mute">Purchase orders are for the owner and managers.</T></Screen>

  return (
    <Screen title="Purchase orders" subtitle={`${orders.length} orders`} back scroll={false}
      right={<IconButton label="New purchase order" tone="dark" onPress={() => router.push('/m/purchasing/orders/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search order or supplier" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['', 'All'], ['open', 'Open'], ['draft', 'Drafts'], ['received', 'Received'], ['cancelled', 'Cancelled']] as Array<[typeof status, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={status === item[0]} onPress={() => setStatus(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(o) => o.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<ClipboardList size={26} color={c.primary} />} title={q || status ? 'No orders match' : 'No purchase orders yet'}
          hint="Order from a supplier first, then receive the goods against the order to keep track of what is still to come." action={!q && !status ? 'New purchase order' : undefined} onAction={() => router.push('/m/purchasing/orders/new')} />}
        renderItem={({ item: o }) => {
          const sup = name.get(o.supplierId) ?? 'Supplier'
          const late = isOverdue(o, now)
          return (
            <Tap onPress={() => router.push({ pathname: '/m/purchasing/orders/[id]', params: { id: o.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={sup} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{sup}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{o.no} · {fmtDayShort(o.date)}{o.expectedDate ? ` · due ${fmtDayShort(o.expectedDate)}` : ''}</T>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <Badge tone={TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                  {late ? <Badge tone="danger">Overdue</Badge> : null}
                </View>
              </View>
              <T v="num">{inr(o.total, 0)}</T>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}

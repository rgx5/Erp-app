import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { fmtQty } from '@/domain/qty'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { CHALLAN_LABEL } from '@/modules/sales-docs/logic/challans'
import { CHALLAN_TONE } from '@/modules/sales-docs/ui/tones'
import type { ChallanStatus } from '@/modules/sales-docs/types'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Plus, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Filter = '' | 'out' | ChallanStatus

/** Delivery challans: goods packed, on the way and delivered, with who is carrying them. */
export default function Challans() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const challans = useList('challans')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('out')

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return challans
      .filter((x) => (filter === '' ? true : filter === 'out' ? x.status !== 'delivered' : x.status === filter))
      .filter((x) => !n || x.no.toLowerCase().includes(n) || x.partyName.toLowerCase().includes(n) || x.trackingNo.toLowerCase().includes(n) || x.vehicle.toLowerCase().includes(n))
      .sort((a, b) => b.date - a.date)
  }, [challans, q, filter])

  if (!can) return <Screen title="Delivery challans" back><T tone="mute">Challans are for people who use the billing counter.</T></Screen>

  return (
    <Screen title="Delivery challans" subtitle={`${challans.filter((x) => x.status !== 'delivered').length} not delivered yet`} back scroll={false}
      right={<IconButton label="New challan" tone="dark" onPress={() => router.push('/m/sales-docs/challans/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search number, name, vehicle or tracking" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['out', 'Not delivered'], ['packed', 'Packed'], ['dispatched', 'On the way'], ['delivered', 'Delivered'], ['', 'All']] as Array<[Filter, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(x) => x.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<Truck size={26} color={c.primary} />} title={q || filter !== 'out' ? 'No challans match' : 'Nothing waiting to be delivered'}
          hint="A challan goes with the goods: what is in the parcel, who is carrying it, and who received it." action={!q ? 'New challan' : undefined} onAction={() => router.push('/m/sales-docs/challans/new')} />}
        renderItem={({ item: x }) => (
          <Tap onPress={() => router.push({ pathname: '/m/sales-docs/challans/[id]', params: { id: x.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <Avatar name={x.partyName} size={42} />
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{x.partyName}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{x.no} · {fmtDayShort(x.date)} · {fmtQty(x.items.reduce((s, l) => s + l.qty, 0))} pcs{x.vehicle ? ` · ${x.vehicle}` : ''}</T>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}><Badge tone={CHALLAN_TONE[x.status]}>{CHALLAN_LABEL[x.status]}</Badge></View>
            </View>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )}
      />
    </Screen>
  )
}

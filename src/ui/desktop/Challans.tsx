import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { fmtQty } from '@/domain/qty'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { CHALLAN_LABEL } from '@/modules/sales-docs/logic/challans'
import { CHALLAN_TONE } from '@/modules/sales-docs/ui/tones'
import type { ChallanStatus } from '@/modules/sales-docs/types'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, Pill, Toolbar, cellText, dtext, type Column } from './kit'

type Filter = '' | 'out' | ChallanStatus
type Row = { id: string; party: string; no: string; date: number; qty: number; vehicle: string; status: ChallanStatus }

/**
 * The desktop Delivery challans screen: a search bar with a status filter, and one dense sortable grid instead of
 * the phone's scrolling cards. Rows come straight off the same `challans` list the phone
 * `m/sales-docs/challans/index.tsx` filters and sorts.
 */
export function DesktopChallans() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const challans = useList('challans')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('out')

  const rows: Row[] = useMemo(() => {
    const n = q.trim().toLowerCase()
    return challans
      .filter((x) => (filter === '' ? true : filter === 'out' ? x.status !== 'delivered' : x.status === filter))
      .filter((x) => !n || x.no.toLowerCase().includes(n) || x.partyName.toLowerCase().includes(n) || x.trackingNo.toLowerCase().includes(n) || x.vehicle.toLowerCase().includes(n))
      .sort((a, b) => b.date - a.date)
      .map((x) => ({ id: x.id, party: x.partyName, no: x.no, date: x.date, qty: x.items.reduce((s, l) => s + l.qty, 0), vehicle: x.vehicle, status: x.status }))
  }, [challans, q, filter])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Delivery challans" />}>
        <View style={{ padding: 20 }}><T tone="mute">Challans are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'party', label: 'To', sortValue: (r) => r.party, render: (r) => cellText(r.party, true) },
    { key: 'no', label: 'Challan', width: 190, sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cell} numberOfLines={1}>{r.no}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{fmtDayShort(r.date)} · {fmtQty(r.qty)} pcs{r.vehicle ? ` · ${r.vehicle}` : ''}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 140, sortValue: (r) => r.status, render: (r) => <Pill tone={CHALLAN_TONE[r.status]} label={CHALLAN_LABEL[r.status]} /> },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Delivery challans"
          subtitle={`${challans.filter((x) => x.status !== 'delivered').length} not delivered yet`}
          right={<DeskButton label="New challan" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/sales-docs/challans/new')} />}
        />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search number, name, vehicle or tracking" placeholderTextColor={c.inkMute} autoCorrect={false} autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }} />
        </View>
        <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'out', label: 'Not delivered' }, { id: 'packed', label: 'Packed' }, { id: 'dispatched', label: 'On the way' }, { id: 'delivered', label: 'Delivered' }, { id: '', label: 'All' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/sales-docs/challans/[id]', params: { id: r.id } })} emptyLabel={q || filter !== 'out' ? 'No challans match' : 'Nothing waiting to be delivered'} />
      </View>
    </DeskPage>
  )
}

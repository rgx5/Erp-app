import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { dayLabel, fmtTime, rangeBounds, RANGE_OPTIONS, type RangeKey } from '@/domain/dates'
import { inr, inr0, round2 } from '@/domain/money'
import { payLabel } from '@/domain/receipt'
import type { Bill } from '@/domain/types'
import { useLabels, useList } from '@/data/hooks'
import { useApp } from '@/data/store'
import { syncNow } from '@/data/runtime'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { SearchBar } from '@/ui/Inputs'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Receipt, ReceiptText, Return } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Status = '' | 'paid' | 'returned' | 'credit' | 'held'
type Row = { kind: 'head'; key: string; label: string; count: number; total: number } | { kind: 'bill'; key: string; bill: Bill }

export default function Bills() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const bills = useList('bills')
  const customers = useList('customers')
  const mode = useApp((s) => s.workspace?.mode)
  const [range, setRange] = useState<RangeKey>('30d')
  const [status, setStatus] = useState<Status>('')
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const [from, to] = useMemo(() => rangeBounds(range), [range])
  const cust = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers])

  const rows = useMemo<Row[]>(() => {
    const n = q.trim().toLowerCase()
    const list = bills.filter((b) => {
      if (b.date < from || b.date > to) return false
      const credit = !!b.refundOfBillId
      if (status === 'held' ? b.status !== 'held' : b.status === 'held' && status !== '') return false
      if (status === 'paid' && (b.status !== 'paid' || credit)) return false
      if (status === 'returned' && !(b.status === 'returned' || b.status === 'partial-return') ) return false
      if (status === 'credit' && !credit) return false
      if (!n) return true
      const cu = b.customerId ? cust.get(b.customerId) : undefined
      return b.no.toLowerCase().includes(n) || (cu?.name.toLowerCase().includes(n) ?? false) || (cu?.phone.includes(n) ?? false) || b.items.some((i) => i.name.toLowerCase().includes(n) || i.sku.toLowerCase().includes(n))
    }).sort((a, b) => b.date - a.date)

    const out: Row[] = []
    let key = ''
    let head: Extract<Row, { kind: 'head' }> | null = null
    for (const b of list) {
      const d = dayLabel(b.date)
      const k = new Date(b.date).toDateString()
      if (k !== key) { key = k; head = { kind: 'head', key: `h${k}`, label: d, count: 0, total: 0 }; out.push(head) }
      if (b.status !== 'held') { head!.count += b.total > 0 ? 1 : 0; head!.total = round2(head!.total + b.total) }
      out.push({ kind: 'bill', key: b.id, bill: b })
    }
    return out
  }, [bills, from, to, status, q, cust])

  async function refresh() { if (mode !== 'remote') return; setRefreshing(true); await syncNow(); setRefreshing(false) }
  const count = rows.filter((r) => r.kind === 'bill').length

  return (
    <Screen title={labels.sales} subtitle={`${count} ${count === 1 ? labels.sale.toLowerCase() : labels.sales.toLowerCase()}`} back scroll={false}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <SearchBar value={q} onChange={setQ} placeholder={`Search number, ${labels.customer.toLowerCase()}, mobile or item`} />
        <FlatList horizontal data={RANGE_OPTIONS} keyExtractor={(o) => o.value} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => <Chip label={item.label} selected={range === item.value} onPress={() => setRange(item.value)} />} />
        <FlatList horizontal data={[['', 'All'], ['paid', 'Paid'], ['returned', 'Returned'], ['credit', 'Credit notes'], ['held', 'Parked']] as Array<[Status, string]>} keyExtractor={(o) => o[0]} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => <Chip label={item[1]} selected={status === item[0]} onPress={() => setStatus(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(r) => r.key} showsVerticalScrollIndicator={false} onRefresh={mode === 'remote' ? refresh : undefined} refreshing={refreshing}
        contentContainerStyle={{ paddingBottom: 30 }} initialNumToRender={14} windowSize={9}
        ListEmptyComponent={<EmptyState icon={<Receipt size={26} color={c.primary} />} title={`No ${labels.sales.toLowerCase()} found`} hint="Try a longer date range or clear the filters." />}
        renderItem={({ item }) => {
          if (item.kind === 'head') {
            return (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 6, paddingHorizontal: 2 }}>
                <T v="label" tone="soft">{item.label.toUpperCase()}</T>
                <T v="caption" tone="mute">{item.count} · {inr0(item.total)}</T>
              </View>
            )
          }
          const b = item.bill
          const credit = !!b.refundOfBillId
          const cu = b.customerId ? cust.get(b.customerId) : undefined
          return (
            <Tap onPress={() => router.push({ pathname: '/bills/[id]', params: { id: b.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: credit ? c.dangerTint : b.status === 'held' ? c.accentTint : c.primaryTint }}>
                {credit ? <Return size={18} color={c.danger} /> : <ReceiptText size={18} color={b.status === 'held' ? c.accent : c.primary} />}
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T v="bodyStrong" numberOfLines={1}>{b.no}</T>
                  {b.status === 'partial-return' ? <Badge tone="warning">Part returned</Badge> : b.status === 'returned' && !credit ? <Badge tone="danger">Returned</Badge> : credit ? <Badge tone="danger">Credit note</Badge> : b.status === 'held' ? <Badge tone="accent">Parked</Badge> : null}
                </View>
                <T v="caption" tone="mute" numberOfLines={1}>{fmtTime(b.date)} · {cu?.name ?? 'Walk-in'}{b.payments.length ? ` · ${[...new Set(b.payments.map(payLabel))].join(' + ')}` : ''}</T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="num" tone={b.total < 0 ? 'danger' : 'default'}>{inr(b.total, 0)}</T>
                <T v="micro" tone="mute">{b.items.length} {b.items.length === 1 ? 'item' : 'items'}</T>
              </View>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}

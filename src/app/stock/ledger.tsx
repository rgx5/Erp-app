import React, { useMemo, useState } from 'react'
import { SectionList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { dayLabel, fmtTime } from '@/domain/dates'
import { filterMoves, ledgerTotals, LEDGER_FILTERS, MOVE_LABEL, type LedgerFilter } from '@/domain/ledger'
import { fmtQty } from '@/domain/qty'
import type { MoveType, StockMove } from '@/domain/types'
import { useLabels, useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Chip, IconWell, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ArrowDownLeft, ArrowUpRight, Clock, Return, Truck, ClipboardCheck, Package, Pencil } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const TONE: Record<MoveType, 'primary' | 'success' | 'warning' | 'default'> = { sale: 'primary', purchase: 'success', return: 'success', adjust: 'warning', audit: 'warning', opening: 'default', transfer: 'default' }

/** Every change to what is on the shelf — who, when, why — newest first. */
export default function Ledger() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const canStock = useCan('stock')
  const moves = useList('moves')
  const variants = useList('variants')
  const products = useList('products')
  const users = useList('users')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<LedgerFilter>('')

  const names = useMemo(() => {
    const p = new Map(products.map((x) => [x.id, x.name]))
    return new Map(variants.map((v) => [v.id, { name: p.get(v.productId) ?? 'Removed item', label: variantLabel(v.size, v.color), productId: v.productId }]))
  }, [products, variants])
  const who = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const nameOf = (vid: string) => { const n = names.get(vid); return n ? `${n.name} ${n.label}` : 'Removed item' }

  const rows = useMemo(() => filterMoves(moves, filter, q, nameOf), [moves, filter, q, names]) // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => ledgerTotals(rows), [rows])
  const sections = useMemo(() => {
    const by = new Map<string, StockMove[]>()
    for (const m of rows.slice(0, 400)) { const k = dayLabel(m.at); const l = by.get(k); if (l) l.push(m); else by.set(k, [m]) }
    return [...by.entries()].map(([title, data]) => ({ title, data }))
  }, [rows])

  if (!canStock) return <Screen title="Stock ledger" back><T tone="mute">The ledger is for the owner and managers.</T></Screen>

  const icon = (t: MoveType, qty: number) => {
    const col = t === 'sale' ? c.primary : t === 'purchase' || t === 'return' ? c.success : c.warning
    return t === 'sale' ? <ArrowUpRight size={18} color={col} /> : t === 'purchase' ? <Truck size={18} color={col} /> : t === 'return' ? <Return size={18} color={col} />
      : t === 'audit' ? <ClipboardCheck size={18} color={col} /> : t === 'opening' ? <Package size={18} color={col} /> : qty >= 0 ? <ArrowDownLeft size={18} color={col} /> : <Pencil size={18} color={col} />
  }

  return (
    <Screen title="Stock ledger" subtitle={`${rows.length} movements · +${fmtQty(totals.inQty)} in · −${fmtQty(totals.outQty)} out`} back scroll={false}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <SearchBar value={q} onChange={setQ} placeholder={`Search ${labels.item.toLowerCase()}, bill or reason`} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LEDGER_FILTERS.map((f) => <Chip key={f.value || 'all'} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />)}
        </View>
      </View>
      <SectionList
        sections={sections} keyExtractor={(m) => m.id} stickySectionHeadersEnabled={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }} initialNumToRender={16}
        ListEmptyComponent={<EmptyState icon={<Clock size={26} color={c.primary} />} title="No movements" hint={q || filter ? 'Try a different search or filter.' : 'Sales, receipts and corrections will be listed here.'} />}
        renderSectionHeader={({ section }) => <T v="label" tone="soft" style={{ marginTop: 14, marginBottom: 8, marginLeft: 2 }}>{section.title.toUpperCase()}</T>}
        renderItem={({ item: m }) => {
          const n = names.get(m.variantId)
          const tone = TONE[m.type]
          const detail = [m.ref && m.ref !== 'MANUAL' && m.ref !== 'AUDIT' ? m.ref : '', m.reason, who.get(m.userId)].filter(Boolean).join(' · ')
          return (
            <Tap disabled={!n} onPress={() => n && router.push({ pathname: '/items/[id]', params: { id: n.productId } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <IconWell tone={tone} size={38}>{icon(m.type, m.qty)}</IconWell>
              <View style={{ flex: 1, gap: 1 }}>
                <T v="bodyStrong" numberOfLines={1}>{n ? `${n.name}${n.label ? ` · ${n.label}` : ''}` : 'Removed item'}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{MOVE_LABEL[m.type]}{detail ? ` · ${detail}` : ''}</T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="num" tone={m.qty >= 0 ? 'success' : 'default'}>{m.qty >= 0 ? '+' : '−'}{fmtQty(Math.abs(m.qty))}</T>
                <T v="micro" tone="mute">{fmtTime(m.at)}</T>
              </View>
            </Tap>
          )
        }}
        ListFooterComponent={rows.length > 400 ? <T v="caption" tone="mute" align="center" style={{ paddingVertical: 14 }}>Showing the latest 400 of {rows.length}. Search to narrow it down.</T> : undefined}
      />
    </Screen>
  )
}

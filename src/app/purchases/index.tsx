import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { dayLabel } from '@/domain/dates'
import { inr, inr0, inrShort } from '@/domain/money'
import { boughtSince, filterPurchases, totalPayable } from '@/domain/purchasing'
import { purchaseDue, supplierOwed } from '@/domain/stock'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { SupplierSheet } from '@/features/SupplierSheet'
import { IconButton } from '@/ui/Button'
import { SearchBar, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, HandCoins, Plus, Truck, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Tab = 'receipts' | 'suppliers'

/** Goods received from suppliers, and what is still owed to them. */
export default function Purchases() {
  const { c } = useTheme()
  const router = useRouter()
  const canBuy = useCan('purchases')
  const purchases = useList('purchases')
  const suppliers = useList('suppliers')
  const [tab, setTab] = useState<Tab>('receipts')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)

  const name = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const receipts = useMemo(() => filterPurchases(purchases, q, (id) => name.get(id) ?? ''), [purchases, q, name])
  const parties = useMemo(() => {
    const n = q.trim().toLowerCase()
    return suppliers
      .filter((s) => !n || s.name.toLowerCase().includes(n) || s.phone.includes(n) || s.gstin.toLowerCase().includes(n))
      .map((s) => ({ s, owed: supplierOwed(s, purchases), count: purchases.filter((p) => p.supplierId === s.id).length }))
      .sort((a, b) => b.owed - a.owed || a.s.name.localeCompare(b.s.name))
  }, [suppliers, purchases, q])
  const payable = useMemo(() => totalPayable(suppliers, purchases), [suppliers, purchases])
  const month = useMemo(() => { const d = new Date(); return boughtSince(purchases, new Date(d.getFullYear(), d.getMonth(), 1).getTime()) }, [purchases])

  if (!canBuy) return <Screen title="Purchases" back><T tone="mute">Purchases are for the owner and managers.</T></Screen>

  const header = (
    <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
      <StatTile label="Owed" value={inrShort(payable)} tone={payable ? 'warning' : 'success'} icon={<HandCoins size={16} color={payable ? c.warning : c.success} />} foot={payable ? `${parties.filter((p) => p.owed > 0).length} to pay` : 'All settled'} onPress={() => setTab('suppliers')} />
      <StatTile label="This month" value={inrShort(month)} icon={<Truck size={16} color={c.primary} />} foot={`${purchases.length} receipts in all`} />
    </View>
  )

  return (
    <Screen title="Purchases" subtitle={`${purchases.length} receipts · ${suppliers.length} suppliers`} back scroll={false}
      right={<IconButton label={tab === 'receipts' ? 'Receive stock' : 'Add supplier'} tone="dark" onPress={() => (tab === 'receipts' ? router.push('/purchases/new') : setAdding(true))}>{tab === 'receipts' ? <Plus size={22} color={c.bg} /> : <UserPlus size={20} color={c.bg} />}</IconButton>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <Segmented<Tab> value={tab} onChange={(t) => { setTab(t); setQ('') }} options={[{ value: 'receipts', label: 'Receipts' }, { value: 'suppliers', label: 'Suppliers' }]} />
        <SearchBar value={q} onChange={setQ} placeholder={tab === 'receipts' ? 'Search receipt, bill no. or supplier' : 'Search suppliers'} />
      </View>

      {tab === 'receipts' ? (
        <FlatList
          data={receipts} keyExtractor={(p) => p.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
          ListHeaderComponent={q ? undefined : header}
          ListEmptyComponent={<EmptyState icon={<Truck size={26} color={c.primary} />} title={q ? 'No receipts match' : 'No receipts yet'} hint={q ? 'Try a different search.' : 'When goods arrive, record them here — stock goes up and the cost is remembered.'} action={q ? undefined : 'Receive stock'} onAction={() => router.push('/purchases/new')} />}
          renderItem={({ item: p }) => {
            const due = purchaseDue(p)
            return (
              <Tap onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: p.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
                <Avatar name={name.get(p.supplierId) ?? '?'} size={42} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="bodyStrong" numberOfLines={1}>{name.get(p.supplierId) ?? 'Supplier'}</T>
                  <T v="caption" tone="mute" numberOfLines={1}>{[p.no, p.invoiceRef ? `Bill ${p.invoiceRef}` : '', dayLabel(p.date)].filter(Boolean).join(' · ')}</T>
                  <T v="caption" tone="mute">{p.items.length} {p.items.length === 1 ? 'line' : 'lines'}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <T v="num">{inr0(p.total)}</T>
                  {due > 0 ? <Badge tone="warning">Due {inr0(due)}</Badge> : <Badge tone="success">Paid</Badge>}
                </View>
                <ChevronRight size={16} color={c.inkMute} />
              </Tap>
            )
          }}
        />
      ) : (
        <FlatList
          data={parties} keyExtractor={(x) => x.s.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
          ListHeaderComponent={q ? undefined : header}
          ListEmptyComponent={<EmptyState icon={<UserPlus size={26} color={c.primary} />} title={q ? 'No suppliers match' : 'No suppliers yet'} hint={q ? 'Try a different search.' : 'Add the people you buy from to keep track of what you owe them.'} action={q ? undefined : 'Add supplier'} onAction={() => setAdding(true)} />}
          renderItem={({ item: { s, owed, count } }) => (
            <Tap onPress={() => router.push({ pathname: '/suppliers/[id]', params: { id: s.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={s.name} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{s.name}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{[s.phone, `${count} ${count === 1 ? 'receipt' : 'receipts'}`].filter(Boolean).join(' · ')}</T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                {owed > 0 ? <T v="num" tone="warning">{inr(owed, 0)}</T> : <T v="num" tone="mute">—</T>}
                <T v="micro" tone="mute">{owed > 0 ? 'you owe' : owed < 0 ? `${inr0(-owed)} advance` : 'settled'}</T>
              </View>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )}
        />
      )}
      <SupplierSheet visible={adding} onClose={() => setAdding(false)} onSaved={(s) => router.push({ pathname: '/suppliers/[id]', params: { id: s.id } })} />
    </Screen>
  )
}

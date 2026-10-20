import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { inr } from '@/domain/money'
import { partyBalances } from '@/modules/accounting/ledger'
import { useLedger } from '@/modules/accounting/ui/hooks'
import type { PartyType } from '@/modules/postings'
import { Screen } from '@/ui/Screen'
import { SearchBar, Segmented } from '@/ui/Inputs'
import { Avatar, Card, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Who owes us and whom we owe, from the books. A tap opens the person's ledger. */
export default function PartiesPage() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('accounting')
  const data = useApp((s) => s.data)
  const customers = useList('customers'), suppliers = useList('suppliers')
  const ledger = useLedger()
  const [type, setType] = useState<'customer' | 'supplier'>('customer')
  const [q, setQ] = useState('')
  const names = useMemo(() => new Map<string, string>([...customers.map((x) => [x.id, x.name] as const), ...suppliers.map((x) => [`s:${x.id}`, x.name] as const)]), [customers, suppliers])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return partyBalances(ledger, data, type as PartyType).map((b) => ({ ...b, name: names.get(type === 'supplier' ? `s:${b.id}` : b.id) ?? 'Removed record' })).filter((r) => !n || r.name.toLowerCase().includes(n))
  }, [ledger, data, type, q, names])
  const total = rows.reduce((s, r) => s + r.balance, 0)
  if (!can) return <Screen title="Party ledgers" back><T tone="mute">The books are for the owner and managers.</T></Screen>
  return (
    <Screen title="Party ledgers" subtitle={type === 'customer' ? 'What customers owe' : 'What we owe suppliers'} back scroll={false}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <Segmented value={type} options={[{ value: 'customer', label: 'Customers' }, { value: 'supplier', label: 'Suppliers' }]} onChange={setType} />
        <SearchBar value={q} onChange={setQ} placeholder="Search by name" />
        <Card><T v="label" tone="soft">{type === 'customer' ? 'TOTAL RECEIVABLE' : 'TOTAL PAYABLE'}</T><T v="numLg">{inr(total, 2)}</T></Card>
      </View>
      <FlatList data={rows} keyExtractor={(r) => r.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<Users size={26} color={c.primary} />} title="Nothing outstanding" hint={type === 'customer' ? 'Credit sales and customer receipts will show up here.' : 'Goods received on credit and supplier payments will show up here.'} />}
        renderItem={({ item: r }) => (
          <Tap onPress={() => router.push({ pathname: '/m/accounting/parties/[type]/[id]', params: { type, id: r.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <Avatar name={r.name} size={42} />
            <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{r.name}</T>
            <T v="num" tone={r.balance < 0 ? 'success' : 'default'}>{inr(r.balance, 2)}</T>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )} />
    </Screen>
  )
}

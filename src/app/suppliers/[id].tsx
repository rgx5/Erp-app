import React, { useMemo, useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { dayLabel } from '@/domain/dates'
import { inr, inr0 } from '@/domain/money'
import { purchaseDue, supplierOwed } from '@/domain/stock'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { SupplierSheet } from '@/features/SupplierSheet'
import { whatsApp } from '@/features/share'
import { Button, IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group } from '@/ui/primitives'
import { KV, ListRow, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { HandCoins, Pencil, Phone, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** A supplier: what you owe, what you've bought, and every receipt from them. */
export default function SupplierDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const router = useRouter()
  const canBuy = useCan('purchases')
  const supplier = useApp((s) => s.data.suppliers[id])
  const all = useList('purchases')
  const [editing, setEditing] = useState(false)

  const mine = useMemo(() => all.filter((p) => p.supplierId === id).sort((a, b) => b.date - a.date), [all, id])

  if (!canBuy) return <Screen title="Supplier" back><T tone="mute">Suppliers are for the owner and managers.</T></Screen>
  if (!supplier) return <Screen title="Not found" back><T tone="mute">This supplier is no longer here.</T></Screen>

  const owed = supplierOwed(supplier, all)
  const bought = mine.reduce((s, p) => s + p.total, 0)
  const call = () => void Linking.openURL(`tel:${supplier.phone}`)
  const nudge = () => void whatsApp(`Hello ${supplier.name}, `, supplier.phone)

  return (
    <Screen title={supplier.name} subtitle={supplier.gstin || supplier.phone || 'Supplier'} back
      right={<IconButton label="Edit supplier" onPress={() => setEditing(true)}><Pencil size={19} color={c.ink} /></IconButton>}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label={owed < 0 ? 'Paid in advance' : 'You owe'} value={inr0(Math.abs(owed))} tone={owed > 0 ? 'warning' : 'success'} icon={<HandCoins size={16} color={owed > 0 ? c.warning : c.success} />} foot={owed > 0 ? 'Across unpaid receipts' : owed < 0 ? 'Credit with them' : 'Settled'} />
          <StatTile label="Bought in all" value={inr0(bought)} icon={<Truck size={16} color={c.primary} />} foot={`${mine.length} ${mine.length === 1 ? 'receipt' : 'receipts'}`} />
        </View>

        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={supplier.name} size={46} />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" numberOfLines={1}>{supplier.name}</T>
              <T v="caption" tone="mute" numberOfLines={2}>{supplier.address || 'No address saved'}</T>
            </View>
          </View>
          {supplier.phone ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label="Call" kind="soft" block icon={<Phone size={17} color={c.primary} />} onPress={call} /></View>
              <View style={{ flex: 1 }}><Button label="WhatsApp" kind="soft" block onPress={nudge} /></View>
            </View>
          ) : null}
          {supplier.openingBalance ? <KV k="Owed when you started" v={inr(supplier.openingBalance)} /> : null}
        </Card>

        <Button label="Receive stock from this supplier" icon={<Truck size={18} color={c.onPrimary} />} block onPress={() => router.push({ pathname: '/purchases/new', params: { supplierId: supplier.id } })} />

        <Section title={`Receipts · ${mine.length}`} style={{ marginTop: 6 }}>
          {mine.length ? (
            <Group>
              {mine.map((p) => {
                const due = purchaseDue(p)
                return (
                  <ListRow key={p.id} title={p.no} subtitle={[p.invoiceRef ? `Bill ${p.invoiceRef}` : '', dayLabel(p.date)].filter(Boolean).join(' · ')} value={inr0(p.total)}
                    badge={due > 0 ? <Badge tone="warning">Due {inr0(due)}</Badge> : <Badge tone="success">Paid</Badge>} onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: p.id } })} />
                )
              })}
            </Group>
          ) : <T tone="mute">Nothing received from {supplier.name} yet.</T>}
        </Section>
      </View>
      <SupplierSheet visible={editing} onClose={() => setEditing(false)} supplier={supplier} />
    </Screen>
  )
}

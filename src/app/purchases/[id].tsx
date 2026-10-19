import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtDateTime } from '@/domain/dates'
import { labelsHtml, type LabelItem } from '@/domain/labels'
import { inr, inr0, round2 } from '@/domain/money'
import { invoiceCheck } from '@/domain/purchasing'
import { fmtQty, fmtQtyUnit } from '@/domain/qty'
import { purchaseDue } from '@/domain/stock'
import { useList, useStore, useVariantViews } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { printHtml } from '@/features/share'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group } from '@/ui/primitives'
import { KV, ListRow, Notice, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Banknote, HandCoins, Printer, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** One goods receipt: what came in, at what cost, and what is still owed. */
export default function PurchaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const router = useRouter()
  const store = useStore()
  const canBuy = useCan('purchases')
  const purchase = useApp((s) => s.data.purchases[id])
  const supplier = useApp((s) => (purchase ? s.data.suppliers[purchase.supplierId] : undefined))
  const users = useList('users')
  const views = useVariantViews()
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])

  if (!canBuy) return <Screen title="Receipt" back><T tone="mute">Purchases are for the owner and managers.</T></Screen>
  if (!purchase) return <Screen title="Not found" back><T tone="mute">This receipt is no longer here.</T></Screen>

  const due = purchaseDue(purchase)
  const check = invoiceCheck(purchase.total, purchase.invoiceTotal)
  const by = users.find((u) => u.id === purchase.userId)?.name
  const qtyTotal = round2(purchase.items.reduce((s, i) => s + i.qty, 0))

  const printLabels = () => {
    const items: LabelItem[] = purchase.items.flatMap((i) => {
      const v = byId.get(i.variantId)
      return v ? [{ name: v.productName, variant: variantLabel(v.size, v.color), sku: v.sku, barcode: v.barcode, price: v.price, mrp: v.mrp, copies: Math.max(1, Math.round(i.qty)) }] : []
    })
    void printHtml(labelsHtml(items, { store: store.name, widthMm: 62, heightMm: 36, perRow: 3, showMrp: true, showStore: true }))
  }

  return (
    <Screen title={purchase.no} subtitle={[supplier?.name, fmtDateTime(purchase.date)].filter(Boolean).join(' · ')} back>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="Receipt total" value={inr0(purchase.total)} icon={<Truck size={16} color={c.primary} />} foot={`${purchase.items.length} ${purchase.items.length === 1 ? 'line' : 'lines'} · ${fmtQty(qtyTotal)} units`} />
          <StatTile label={due > 0 ? 'Still owed' : 'Paid'} value={inr0(due > 0 ? due : purchase.paid)} tone={due > 0 ? 'warning' : 'success'} icon={due > 0 ? <HandCoins size={16} color={c.warning} /> : <Banknote size={16} color={c.success} />} foot={due > 0 ? `${inr0(purchase.paid)} paid` : 'Settled in full'} />
        </View>

        {check ? (check.ok
          ? <Notice tone="success" title="Matched the supplier’s bill" body={`Their bill: ${inr(purchase.invoiceTotal ?? 0)}`} />
          : <Notice tone="warning" title={`${inr(Math.abs(check.diff))} ${check.diff > 0 ? 'more' : 'less'} than their bill`} body={`Their bill: ${inr(purchase.invoiceTotal ?? 0)} · this receipt: ${inr(purchase.total)}`} />) : null}

        {supplier ? (
          <Card onPress={() => router.push({ pathname: '/suppliers/[id]', params: { id: supplier.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={supplier.name} size={44} />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" numberOfLines={1}>{supplier.name}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{[supplier.phone, supplier.gstin].filter(Boolean).join(' · ') || 'Supplier'}</T>
            </View>
            <Badge tone="primary">View</Badge>
          </Card>
        ) : null}

        <Section title="Items received" style={{ marginTop: 6 }}>
          <Group>
            {purchase.items.map((i) => {
              const v = byId.get(i.variantId)
              const short = i.invoicedQty !== undefined && i.invoicedQty !== i.qty
              return (
                <ListRow key={i.variantId} title={v?.productName ?? 'Removed item'} subtitle={[v ? variantLabel(v.size, v.color) : '', v?.sku].filter(Boolean).join(' · ')}
                  meta={short ? `Billed ${fmtQty(i.invoicedQty ?? 0)}, received ${fmtQty(i.qty)}` : v?.trackStock ? `${fmtQtyUnit(v.stock, v)} in stock now` : undefined}
                  value={inr0(round2(i.qty * i.cost))} sub={`${fmtQty(i.qty)} × ${inr(i.cost, i.cost % 1 ? 2 : 0)}`}
                  onPress={v ? () => router.push({ pathname: '/items/[id]', params: { id: v.productId } }) : undefined} />
              )
            })}
          </Group>
        </Section>

        <Card flat>
          <KV k="Subtotal" v={inr(purchase.total)} strong />
          <KV k="Paid" v={inr(purchase.paid)} tone={purchase.paid ? 'success' : undefined} />
          <KV k="Owed to supplier" v={inr(Math.max(0, due))} tone={due > 0 ? 'warning' : undefined} />
          {purchase.invoiceRef ? <KV k="Supplier’s bill no." v={purchase.invoiceRef} /> : null}
          {by ? <KV k="Received by" v={by} /> : null}
        </Card>
        {purchase.notes ? <Card flat><T v="label" tone="soft" style={{ marginBottom: 4 }}>NOTES</T><T>{purchase.notes}</T></Card> : null}

        <Button label="Print labels for these items" kind="soft" block icon={<Printer size={18} color={c.primary} />} onPress={printLabels} />
      </View>
    </Screen>
  )
}

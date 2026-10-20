/**
 * Purchasing — registration of what this module adds to the app. The reference module: copy this shape.
 *   replication.ts  collections, permissions, effects (pure; the server loads it too)
 *   logic.ts / ops.ts  rules and operations (pure; tested)
 *   this file       where it appears: the Apps screen, supplier panel, Home notice, Reports hub
 *   src/app/m/purchasing/…  its screens (every module's routes live under /m/<module>/)
 */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { Section } from '@/ui/blocks'
import { Card, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ClipboardList, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { useApp } from '@/data/store'
import { registerModule, registerPanel } from '../registry'
import { isOpen, isOverdue, STATUS_LABEL } from './logic'
import './replication'

registerModule({
  id: 'purchasing', name: 'Purchasing', tagline: 'Orders, receipts, suppliers and payables', icon: Truck, tone: 'primary', order: 30,
  features: [
    { id: 'purchase-orders', label: 'Purchase orders', sub: 'Order from suppliers and track what is still to come', icon: ClipboardList, tone: 'primary', to: '/m/purchasing/orders', perm: 'purchases', section: 'Ordering',
      badge: (s) => listOf(s.purchaseOrders).filter(isOpen).length || null },
  ],
  reports: [
    { id: 'open-pos', label: 'Open purchase orders', sub: 'Still to arrive, by supplier', icon: ClipboardList, tone: 'primary', to: '/m/purchasing/orders', group: 'Purchasing', perm: 'purchases' },
  ],
  notices: [
    (s, now) => {
      const late = listOf(s.purchaseOrders).filter((o) => isOverdue(o, now))
      return late.length ? { id: 'po-overdue', tone: 'warning', title: `${late.length} purchase ${late.length === 1 ? 'order is' : 'orders are'} overdue`, body: 'Goods that were due have not arrived', action: 'Open', to: '/m/purchasing/orders' } : null
    },
  ],
})

/** On a supplier's page: the orders open with them. */
function SupplierOrders({ supplier }: { supplier: { id: string } }) {
  const { c } = useTheme()
  const router = useRouter()
  const orders = useApp((s) => listOf(s.data.purchaseOrders)).filter((o) => o.supplierId === supplier.id && isOpen(o))
  if (!orders.length) return null
  return (
    <Section title={`Open orders · ${orders.length}`} style={{ marginTop: 6 }}>
      <Card padded={false}>
        {orders.map((o, i) => (
          <Tap key={o.id} onPress={() => router.push({ pathname: '/m/purchasing/orders/[id]', params: { id: o.id } })} style={{ flexDirection: 'row', gap: 8, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
            <View style={{ flex: 1 }}><T v="bodyStrong">{o.no}</T><T v="caption" tone="mute">{STATUS_LABEL[o.status]}{o.expectedDate ? ` · due ${fmtDayShort(o.expectedDate)}` : ''}</T></View>
            <T v="num">{inr(o.total, 0)}</T>
          </Tap>
        ))}
      </Card>
    </Section>
  )
}
registerPanel({ id: 'purchasing.supplier-orders', slot: 'supplier', order: 20, perm: 'purchases', needsKosh: true, component: ({ supplier }) => <SupplierOrders supplier={supplier} /> })

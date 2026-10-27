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
import { Bell, ChartColumn, ClipboardCheck, ClipboardList, HandCoins, PackagePlus, PackageSearch, ReceiptText, Settings, Tags, Truck, Undo } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { useApp } from '@/data/store'
import { registerModule, registerPanel } from '../registry'
import { awaitingApproval } from './approvals'
import { isOpen, isOverdue, STATUS_LABEL } from './logic'
import { approvalsWaiting, dueNow, itcExpiring } from './notices'
import './replication'

registerModule({
  id: 'purchasing', name: 'Purchasing', tagline: 'Orders, receipts, suppliers and payables', icon: Truck, tone: 'primary', order: 30,
  features: [
    { id: 'purchase-orders', label: 'Purchase orders', sub: 'Order from suppliers and track what is still to come', icon: ClipboardList, tone: 'primary', to: '/m/purchasing/orders', perm: 'purchases', section: 'Ordering',
      badge: (s) => listOf(s.purchaseOrders).filter(isOpen).length || null },
    { id: 'purchase-approvals', label: 'Order approvals', sub: 'Big orders waiting for a yes', icon: ClipboardCheck, tone: 'warning', to: '/m/purchasing/approvals', perm: 'purchases', section: 'Ordering',
      badge: (s) => awaitingApproval(s).length || null },
    { id: 'purchase-quotes', label: 'Quotations', sub: 'Ask suppliers for prices and compare', icon: PackageSearch, tone: 'primary', to: '/m/purchasing/rfq', perm: 'purchases', section: 'Ordering' },
    { id: 'supplier-prices', label: 'Supplier prices', sub: 'Price lists and quantity breaks', icon: Tags, tone: 'primary', to: '/m/purchasing/prices', perm: 'purchases', section: 'Ordering' },
    { id: 'purchase-invoices', label: 'Supplier invoices', sub: 'Capture GST and claim input credit', icon: ReceiptText, tone: 'accent', to: '/m/purchasing/invoices', perm: 'purchases', section: 'Bills & returns' },
    { id: 'purchase-returns', label: 'Purchase returns', sub: 'Send goods back and raise a debit note', icon: Undo, tone: 'danger', to: '/m/purchasing/returns', perm: 'purchases', section: 'Bills & returns' },
    { id: 'landed-cost', label: 'Landed cost', sub: 'Spread freight and duty into item cost', icon: PackagePlus, tone: 'primary', to: '/m/purchasing/landed', perm: 'purchases', section: 'Bills & returns' },
    { id: 'payables', label: 'Payables', sub: 'What you owe, pay suppliers, statements', icon: HandCoins, tone: 'warning', to: '/m/purchasing/payables', perm: 'purchases', section: 'Paying suppliers',
      badge: (s) => dueNow(s, Date.now()).overdue.suppliers || null },
    { id: 'payment-reminders', label: 'What to pay', sub: 'Bills falling due, soonest first', icon: Bell, tone: 'warning', to: '/m/purchasing/payables/due', perm: 'purchases', section: 'Paying suppliers' },
    { id: 'purchasing-settings', label: 'Purchasing settings', sub: 'Approval limits, days to pay, reminders', icon: Settings, tone: 'primary', to: '/m/purchasing/settings', perm: 'settings', section: 'Paying suppliers' },
  ],
  reports: [
    { id: 'open-pos', label: 'Open purchase orders', sub: 'Still to arrive, by supplier', icon: ClipboardList, tone: 'primary', to: '/m/purchasing/orders', group: 'Purchasing', perm: 'purchases' },
    { id: 'payables-ageing', label: 'Payables ageing', sub: 'What you owe, by how late it is', icon: ChartColumn, tone: 'warning', to: '/m/purchasing/payables/ageing', group: 'Purchasing', perm: 'reports' },
    { id: 'input-credit', label: 'GST input credit', sub: 'Credit to claim, blocked and given back', icon: ReceiptText, tone: 'accent', to: '/m/purchasing/invoices', group: 'Purchasing', perm: 'reports' },
    { id: 'purchase-return-list', label: 'Debit notes', sub: 'Goods sent back to suppliers', icon: Undo, tone: 'danger', to: '/m/purchasing/returns', group: 'Purchasing', perm: 'reports' },
  ],
  notices: [
    (s, now) => {
      const late = listOf(s.purchaseOrders).filter((o) => isOverdue(o, now))
      return late.length ? { id: 'po-overdue', tone: 'warning', title: `${late.length} purchase ${late.length === 1 ? 'order is' : 'orders are'} overdue`, body: 'Goods that were due have not arrived', action: 'Open', to: '/m/purchasing/orders' } : null
    },
    (s) => {
      const n = approvalsWaiting(s)
      return n ? { id: 'po-approvals', tone: 'warning', title: `${n} purchase ${n === 1 ? 'order needs' : 'orders need'} approval`, body: 'They cannot be sent until someone approves', action: 'Review', to: '/m/purchasing/approvals' } : null
    },
    (s, now) => {
      const d = dueNow(s, now)
      if (d.overdue.suppliers) return { id: 'payables-overdue', tone: 'danger', title: `${inr(d.overdue.amount, 0)} is overdue to ${d.overdue.suppliers} ${d.overdue.suppliers === 1 ? 'supplier' : 'suppliers'}`, body: 'Pay them to keep your terms', action: 'Pay', to: '/m/purchasing/payables/due' }
      return d.soon.docs ? { id: 'payables-soon', tone: 'warning', title: `${inr(d.soon.amount, 0)} falls due soon`, body: `${d.soon.docs} ${d.soon.docs === 1 ? 'bill' : 'bills'} to pay`, action: 'See', to: '/m/purchasing/payables/due' } : null
    },
    (s, now) => {
      const n = itcExpiring(s, now)
      return n ? { id: 'itc-closing', tone: 'warning', title: `GST credit on ${n} ${n === 1 ? 'invoice' : 'invoices'} is about to lapse`, body: 'Claim it in your next return', action: 'Open', to: '/m/purchasing/invoices' } : null
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

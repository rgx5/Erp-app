/**
 * Sales documents — registration of what this module adds to the app. Quotations, orders / advance booking / layaway, delivery
 * challans, recurring invoices / AMC, commissions & targets, and shifts with cash in/out.
 *   replication.ts  collections, permission (pure; the server loads it)   logic/ ops.ts postings.ts  rules and operations (pure; tested)
 *   billhook.ts     what saving a bill means for quotations, orders and advances
 *   this file       where it appears: the Sales app, customer / item / bill panels, the 'advance' way to pay, Home notices, Reports hub
 *   src/app/m/sales-docs/…  its screens
 */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { listOf } from '@/data/state'
import { useApp } from '@/data/store'
import { Section } from '@/ui/blocks'
import { Card, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ClipboardList, FileText, PiggyBank, Repeat, ShoppingCart, Target, Truck, Wallet } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { registerBillHook, registerModule, registerPanel, registerPaymentMethod, registerReceiptExtra } from '../registry'
import { linkOf, receiptFooter, receiptHeader, salesDocsBillHook } from './billhook'
import { advanceOnHand, isOpenOrder, moneyOf, reservedByVariant } from './logic/orders'
import { orderBook, quotePipeline } from './logic/pipeline'
import { effectiveStatus, QUOTE_LABEL } from './logic/quotes'
import { dueSubscriptions } from './logic/subscriptions'
import './replication'

registerBillHook(salesDocsBillHook)
registerReceiptExtra({ id: 'sales-docs', header: receiptHeader, footer: (bill) => receiptFooter(bill) })

/** Advance paid on an order is spent at checkout like any other way to pay — offered only to a customer who holds some. */
registerPaymentMethod({ id: 'advance', label: 'Advance', icon: PiggyBank, order: 40, enabled: (state, cart) => advanceOnHand(state, cart.customerId) > 0 })

const openQuotes = (s: Parameters<typeof quotePipeline>[0], now: number) => quotePipeline(s, now).open.count

registerModule({
  id: 'sales', name: 'Sales', tagline: 'Billing, orders, credit and pricing', icon: ShoppingCart, tone: 'primary', order: 10,
  features: [
    { id: 'quotations', label: 'Quotations', sub: 'Send a price, then turn it into a bill', icon: FileText, tone: 'primary', to: '/m/sales-docs/quotations', perm: 'pos', section: 'Documents', badge: (s) => openQuotes(s, Date.now()) || null },
    { id: 'orders', label: 'Orders & layaway', sub: 'Advance booking and pay-over-time', icon: ClipboardList, tone: 'accent', to: '/m/sales-docs/orders', perm: 'pos', section: 'Documents', badge: (s) => listOf(s.salesOrders).filter(isOpenOrder).length || null },
    { id: 'challans', label: 'Delivery challans', sub: 'Dispatch and proof of delivery', icon: Truck, tone: 'success', to: '/m/sales-docs/challans', perm: 'pos', section: 'Documents', badge: (s) => listOf(s.challans).filter((x) => x.status !== 'delivered').length || null },
    { id: 'recurring', label: 'Recurring & AMC', sub: 'Bill on a schedule', icon: Repeat, tone: 'primary', to: '/m/sales-docs/recurring', perm: 'salesDocs', section: 'Documents', badge: (s) => dueSubscriptions(s, Date.now()).length || null },
    { id: 'shifts', label: 'Shifts & cash', sub: 'Open and close your till, cash in and out', icon: Wallet, tone: 'warning', to: '/m/sales-docs/shifts', perm: 'pos', section: 'Counter' },
    { id: 'commissions', label: 'Commissions & targets', sub: 'Who sold what, and what they earn', icon: Target, tone: 'success', to: '/m/sales-docs/commissions', perm: 'salesDocs', section: 'People' },
  ],
  reports: [
    { id: 'quote-pipeline', label: 'Quotation pipeline', sub: 'Open, lapsed and won, by value', icon: FileText, tone: 'primary', to: '/m/sales-docs/quotations', group: 'Sales', perm: 'pos' },
    { id: 'order-book', label: 'Order book & layaway', sub: 'Advance held, balance due, late orders', icon: ClipboardList, tone: 'accent', to: '/m/sales-docs/orders', group: 'Sales', perm: 'pos' },
    { id: 'commission-report', label: 'Commission & targets', sub: 'Sales, target achieved and commission per person', icon: Target, tone: 'success', to: '/m/sales-docs/commissions', group: 'People', perm: 'salesDocs' },
    { id: 'shift-reports', label: 'Shift reports', sub: 'Drawer count and differences per shift', icon: Wallet, tone: 'warning', to: '/m/sales-docs/shifts', group: 'Accounts', perm: 'pos' },
  ],
  notices: [
    (s, now) => {
      const p = quotePipeline(s, now)
      return p.expiringSoon ? { id: 'quotes-expiring', tone: 'warning', title: `${p.expiringSoon} quotation${p.expiringSoon === 1 ? '' : 's'} expire${p.expiringSoon === 1 ? 's' : ''} soon`, body: 'Follow up before the prices lapse', action: 'Open', to: '/m/sales-docs/quotations' } : null
    },
    (s, now) => {
      const b = orderBook(s, now)
      if (b.layawayOverdue.count) return { id: 'layaway-overdue', tone: 'danger', title: `${inr(b.layawayOverdue.amount, 0)} of layaway instalments overdue`, body: `${b.layawayOverdue.count} customer${b.layawayOverdue.count === 1 ? ' is' : 's are'} behind on their plan`, action: 'Open', to: '/m/sales-docs/orders' }
      return b.pastDue ? { id: 'orders-late', tone: 'warning', title: `${b.pastDue} order${b.pastDue === 1 ? ' is' : 's are'} past the delivery date`, action: 'Open', to: '/m/sales-docs/orders' } : null
    },
    (s, now) => {
      const d = dueSubscriptions(s, now)
      return d.length ? { id: 'recurring-due', tone: 'primary', title: `${d.length} recurring invoice${d.length === 1 ? '' : 's'} to make`, body: d.slice(0, 3).map((x) => x.sub.no).join(', '), action: 'Open', to: '/m/sales-docs/recurring' } : null
    },
    (s, now) => {
      // A till left open from an earlier day is usually a forgotten close.
      const stale = listOf(s.shifts).filter((x) => x.status === 'open' && now - x.openedAt > 16 * 3_600_000)
      return stale.length ? { id: 'shift-stale', tone: 'warning', title: `${stale.length === 1 ? 'A shift is' : `${stale.length} shifts are`} still open from before`, body: 'Count the drawer and close it', action: 'Open', to: '/m/sales-docs/shifts' } : null
    },
  ],
})

/** On a customer's page: advance held, open orders and quotations, recurring plans. */
function CustomerDocs({ customer }: { customer: { id: string } }) {
  const { c } = useTheme()
  const router = useRouter()
  const data = useApp((s) => s.data)
  const now = Date.now()
  const orders = listOf(data.salesOrders).filter((o) => o.customerId === customer.id && isOpenOrder(o))
  const quotes = listOf(data.quotations).filter((q) => q.customerId === customer.id).filter((q) => ['draft', 'sent', 'accepted'].includes(effectiveStatus(q, now)))
  const plans = listOf(data.subscriptions).filter((p) => p.customerId === customer.id && p.active)
  if (!orders.length && !quotes.length && !plans.length) return null
  const advance = advanceOnHand(data, customer.id)
  return (
    <Section title="Orders & quotations" style={{ marginTop: 6 }}>
      <Card padded={false}>
        {advance > 0 ? <View style={{ padding: 14 }}><T v="bodyStrong">Advance held</T><T v="caption" tone="success">{inr(advance)} can be used on the next bill</T></View> : null}
        {orders.map((o) => (
          <Tap key={o.id} onPress={() => router.push({ pathname: '/m/sales-docs/orders/[id]', params: { id: o.id } })} style={{ flexDirection: 'row', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ flex: 1 }}><T v="bodyStrong">{o.no}</T><T v="caption" tone="mute">{o.expectedDate ? `Due ${fmtDayShort(o.expectedDate)} · ` : ''}{inr(moneyOf(data, o).toPay, 0)} to pay</T></View>
            <T v="num">{inr(o.total, 0)}</T>
          </Tap>
        ))}
        {quotes.map((q) => (
          <Tap key={q.id} onPress={() => router.push({ pathname: '/m/sales-docs/quotations/[id]', params: { id: q.id } })} style={{ flexDirection: 'row', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ flex: 1 }}><T v="bodyStrong">{q.no}</T><T v="caption" tone="mute">{QUOTE_LABEL[effectiveStatus(q, now)]} · till {fmtDayShort(q.validUntil)}</T></View>
          </Tap>
        ))}
        {plans.map((p) => (
          <Tap key={p.id} onPress={() => router.push({ pathname: '/m/sales-docs/recurring/[id]', params: { id: p.id } })} style={{ flexDirection: 'row', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ flex: 1 }}><T v="bodyStrong">{p.no}</T><T v="caption" tone="mute">{p.kind === 'amc' ? 'AMC' : 'Subscription'} · next {fmtDayShort(p.nextDate)}</T></View>
          </Tap>
        ))}
      </Card>
    </Section>
  )
}
registerPanel({ id: 'sales-docs.customer', slot: 'customer', order: 30, perm: 'pos', needsKosh: true, component: ({ customer }) => <CustomerDocs customer={customer} /> })

/** On an item's page: how many are promised to customers on open orders. */
function ItemReserved({ variants }: { variants: Array<{ id: string }> }) {
  const data = useApp((s) => s.data)
  const map = reservedByVariant(data)
  const total = variants.reduce((s, v) => s + (map.get(v.id) ?? 0), 0)
  if (!total) return null
  return (
    <Section title="Reserved" style={{ marginTop: 6 }}>
      <Card><T v="bodyStrong">{fmtQty(total)} kept aside for customer orders</T><T v="caption" tone="mute">They are still counted in stock until the order is billed.</T></Card>
    </Section>
  )
}
registerPanel({ id: 'sales-docs.item', slot: 'item', order: 30, perm: 'pos', needsKosh: true, component: ({ variants }) => <ItemReserved variants={variants} /> })

/** On a bill: the quotation or order it came from. */
function BillOrigin({ bill }: { bill: Parameters<typeof linkOf>[0] }) {
  const router = useRouter()
  const data = useApp((s) => s.data)
  const link = linkOf(bill)
  const q = link.quotationId ? data.quotations[link.quotationId] : undefined
  const o = link.orderId ? data.salesOrders[link.orderId] : undefined
  const p = link.subscriptionId ? data.subscriptions[link.subscriptionId] : undefined
  if (!q && !o && !p) return null
  return (
    <Section title="Came from" style={{ marginTop: 6 }}>
      <Card padded={false}>
        {q ? <Tap onPress={() => router.push({ pathname: '/m/sales-docs/quotations/[id]', params: { id: q.id } })} style={{ padding: 14 }}><T v="bodyStrong">Quotation {q.no}</T></Tap> : null}
        {o ? <Tap onPress={() => router.push({ pathname: '/m/sales-docs/orders/[id]', params: { id: o.id } })} style={{ padding: 14 }}><T v="bodyStrong">Order {o.no}</T></Tap> : null}
        {p ? <Tap onPress={() => router.push({ pathname: '/m/sales-docs/recurring/[id]', params: { id: p.id } })} style={{ padding: 14 }}><T v="bodyStrong">{p.kind === 'amc' ? 'AMC' : 'Subscription'} {p.no}</T></Tap> : null}
      </Card>
    </Section>
  )
}
registerPanel({ id: 'sales-docs.bill', slot: 'bill', order: 30, perm: 'pos', needsKosh: true, component: ({ bill }) => <BillOrigin bill={bill} /> })

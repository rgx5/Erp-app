import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { orderHtml, orderText } from '@/modules/sales-docs/html'
import { isOpenOrder, layawayStatus, moneyOf, ORDER_LABEL, paymentsOf } from '@/modules/sales-docs/logic/orders'
import { undispatched } from '@/modules/sales-docs/logic/challans'
import { cancelOrder, deleteSalesOrder, refundOrderPayment, setOrderReady, takeOrderPayment, type PaymentInput } from '@/modules/sales-docs/ops'
import { loadIntoCart } from '@/modules/sales-docs/ui/billing'
import { ORDER_TONE } from '@/modules/sales-docs/ui/tones'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, ProgressBar } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { BanknoteDown, BanknoteUp, CheckCircle, Close, Pencil, Printer, Receipt, Send, Share, Trash, Truck } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'

type Mode = PaymentInput['mode']
const MODES: Array<{ value: Mode; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }]
const KIND_LABEL = { advance: 'Received', refund: 'Given back', applied: 'Used on a bill' } as const
const INSTALMENT_TONE: Record<string, Tone> = { paid: 'success', overdue: 'danger', due: 'warning', upcoming: 'default' }

type Sheeted = null | 'pay' | 'refund' | 'cancel'

/** One order: the goods, what has been paid, the layaway plan, and what happens next. */
export default function OrderPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pos')
  const store = useStore()
  const data = useApp((s) => s.data)
  const order = useList('salesOrders').find((o) => o.id === id)
  const customers = useList('customers')
  const challans = useList('challans')

  const [sheet, setSheet] = useState<Sheeted>(null)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<Mode>('cash')
  const [ref, setRef] = useState('')

  if (!can) return <Screen title="Order" back><T tone="mute">Orders are for people who use the billing counter.</T></Screen>
  if (!order) return <Screen title="Not found" back><T tone="mute">This order is no longer here.</T></Screen>
  const customer = customers.find((x) => x.id === order.customerId)
  const money = moneyOf(data, order)
  const open = isOpenOrder(order)
  const now = Date.now()
  const plan = order.instalments?.length ? layawayStatus(order, money.paidIn, now) : null
  const history = paymentsOf(data, order.id)
  const sent = challans.filter((x) => x.orderId === order.id)
  const toSend = undispatched(order, sent)
  const late = open && !!order.expectedDate && order.expectedDate < now - 86_400_000

  function openSheet(kind: Exclude<Sheeted, null>) {
    setAmount(kind === 'pay' ? String(plan?.next ? Math.max(0, Math.min(money.toPay, plan.next.cumulative - money.paidIn)) || money.toPay : money.toPay) : kind === 'refund' ? String(money.onHand) : '')
    setMode('cash'); setRef(''); setSheet(kind)
  }
  function run(label: string, fn: () => void) {
    try { fn(); setSheet(null); toast(label, 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  const take = () => run('Payment recorded', () => { perform((s, ctx) => takeOrderPayment(s, order!.id, { amount: Number(amount) || 0, mode, ref }, ctx)) })
  const giveBack = () => run('Refund recorded', () => { perform((s, ctx) => refundOrderPayment(s, order!.id, { amount: Number(amount) || 0, mode, ref }, ctx)) })
  const cancelIt = () => run('Order cancelled', () => { perform((s, ctx) => cancelOrder(s, order!.id, { mode, ref }, ctx)) })
  async function cancelAsk() {
    if (money.onHand > 0) { openSheet('cancel'); return }
    if (await ask({ title: `Cancel ${order!.no}?`, message: 'The goods set aside for it are released.', confirm: 'Cancel order', danger: true })) run('Order cancelled', () => { perform((s, ctx) => cancelOrder(s, order!.id, null, ctx)) })
  }
  function ready(on: boolean) { run(on ? 'Marked ready' : 'Back to open', () => { perform((s, ctx) => setOrderReady(s, order!.id, on, ctx)) }) }
  async function bill() {
    if (await loadIntoCart({ items: order!.items, customerId: order!.customerId, discountType: order!.billDiscountType, discountValue: order!.billDiscountValue, link: { orderId: order!.id } })) {
      if (money.onHand > 0) toast(`${inr(money.onHand)} advance is held — choose “Advance” to use it.`, 'info')
      router.push('/sell/checkout')
    }
  }
  async function remove() {
    if (!(await ask({ title: `Delete ${order!.no}?`, confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteSalesOrder(s, order!.id, ctx)); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }
  const party = { name: customer?.name ?? 'Customer', phone: customer?.phone, address: customer?.address, gstin: customer?.gstin }

  return (
    <Screen title={order.no} subtitle={customer?.name ?? 'Customer'} back
      footer={open ? <Button label="Bill it now" size="lg" block icon={<Receipt size={18} color={c.onPrimary} />} onPress={bill} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Badge tone={ORDER_TONE[order.status]}>{ORDER_LABEL[order.status]}</Badge>
          {plan ? <Badge tone="accent">Layaway</Badge> : null}
          {late ? <Badge tone="danger">Past delivery date</Badge> : null}
        </View>
        {plan && plan.overdue ? <Notice tone="danger" title={`${inr(plan.overdueAmount, 0)} overdue`} body={`${plan.overdue} instalment${plan.overdue === 1 ? ' is' : 's are'} past the date`} action="Take payment" onAction={() => openSheet('pay')} /> : null}
        {order.status === 'delivered' && order.billId ? <Notice tone="success" icon={<CheckCircle size={20} color={c.success} />} title="Delivered and billed" action="Open bill" onAction={() => router.push({ pathname: '/bills/[id]', params: { id: order.billId! } })} /> : null}

        <Card>
          <KV k="Order total" v={inr(order.total)} strong />
          <KV k="Paid in" v={inr(money.paidIn)} tone="success" />
          {money.applied > 0 ? <KV k="Used on bills" v={inr(money.applied)} /> : null}
          <KV k="Advance held" v={inr(money.onHand)} />
          <KV k="Still to pay" v={inr(money.toPay)} strong tone={money.toPay ? 'warning' : 'success'} />
          <View style={{ marginTop: 8 }}><ProgressBar value={order.total ? money.paidIn / order.total : 0} tone={money.toPay === 0 ? 'success' : 'primary'} /></View>
          {order.expectedDate ? <View style={{ marginTop: 8 }}><T v="caption" tone="mute">Delivery by {fmtDate(order.expectedDate)}</T></View> : null}
        </Card>

        <Section title="Items kept aside" style={{ marginTop: 6 }}>
          <Card padded={false}>
            {order.items.map((l, i) => {
              const v = data.variants[l.variantId]
              const sentQty = sent.reduce((s, ch) => s + ch.items.filter((x) => x.variantId === l.variantId).reduce((t, x) => t + x.qty, 0), 0)
              return (
                <View key={l.variantId} style={{ padding: 14, gap: 4, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                      <T v="caption" tone="mute">{[variantLabel(l.size, l.color), `${fmtQty(l.qty)}${l.unit && l.unit !== 'pc' ? ` ${l.unit}` : ''} × ${inr(l.price)}`].filter(Boolean).join(' · ')}</T>
                    </View>
                    <T v="num">{inr(l.price * l.qty, 0)}</T>
                  </View>
                  {open && v && v.stock < l.qty && !l.noStock ? <T v="caption" tone="warning">Only {fmtQty(v.stock)} in stock</T> : null}
                  {sentQty > 0 ? <T v="caption" tone="soft">{fmtQty(sentQty)} sent on delivery challans</T> : null}
                </View>
              )
            })}
          </Card>
        </Section>

        {plan ? (
          <Section title="Payment plan" style={{ marginTop: 6 }}>
            <Card padded={false}>
              {plan.rows.map((r, i) => (
                <View key={i} style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <T v="bodyStrong" style={{ flex: 1 }}>{fmtDate(r.dueDate)}</T>
                  <Badge tone={INSTALMENT_TONE[r.state]}>{r.state === 'paid' ? 'Paid' : r.state === 'overdue' ? 'Overdue' : r.state === 'due' ? 'Next' : 'Later'}</Badge>
                  <T v="num">{inr(r.amount, 0)}</T>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {history.length ? (
          <Section title="Money" style={{ marginTop: 6 }}>
            <Card padded={false}>
              {history.map((p, i) => (
                <View key={p.id} style={{ padding: 14, flexDirection: 'row', gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">{KIND_LABEL[p.kind]}{p.kind === 'applied' ? '' : ` · ${p.mode.toUpperCase()}`}</T>
                    <T v="caption" tone="mute">{fmtDateTime(p.date)}{p.ref ? ` · ${p.ref}` : ''}</T>
                  </View>
                  <T v="num" tone={p.kind === 'advance' ? 'success' : p.kind === 'refund' ? 'danger' : 'default'}>{p.kind === 'refund' ? '− ' : ''}{inr(p.amount, 0)}</T>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {sent.length ? (
          <Section title="Deliveries" style={{ marginTop: 6 }}>
            <Card padded={false}>
              {sent.map((ch, i) => (
                <Button key={ch.id} label={`${ch.no} · ${ch.status}`} kind="ghost" block style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.line }} onPress={() => router.push({ pathname: '/m/sales-docs/challans/[id]', params: { id: ch.id } })} />
              ))}
            </Card>
          </Section>
        ) : null}

        {order.notes ? <Card><T v="label" tone="soft">NOTES</T><T>{order.notes}</T></Card> : null}

        <View style={{ gap: 10, marginTop: 4 }}>
          {open && money.toPay > 0 ? <Button label="Take payment" kind="success" block icon={<BanknoteDown size={18} color={c.onPrimary} />} onPress={() => openSheet('pay')} /> : null}
          {open && money.onHand > 0 ? <Button label="Give advance back" kind="outline" block icon={<BanknoteUp size={18} color={c.ink} />} onPress={() => openSheet('refund')} /> : null}
          {open ? <Button label={order.status === 'ready' ? 'Not ready yet' : 'Mark ready for collection'} kind="outline" block icon={<CheckCircle size={18} color={c.ink} />} onPress={() => ready(order.status !== 'ready')} /> : null}
          {open && toSend.length ? <Button label="Make a delivery challan" kind="outline" block icon={<Truck size={18} color={c.ink} />} onPress={() => router.push({ pathname: '/m/sales-docs/challans/new', params: { orderId: order.id } })} /> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="WhatsApp" kind="soft" icon={<Send size={18} color={c.primary} />} style={{ flex: 1 }} onPress={() => whatsApp(orderText(order, store, party.name, money), party.phone)} />
            <Button label="PDF" kind="outline" icon={<Share size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => sharePdf(orderHtml(order, store, party, money), `${order.no}.pdf`)} />
            <Button label="Print" kind="outline" icon={<Printer size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => printHtml(orderHtml(order, store, party, money))} />
          </View>
          {open && money.applied === 0 ? <Button label="Edit order" kind="outline" block icon={<Pencil size={18} color={c.ink} />} onPress={() => router.push({ pathname: '/m/sales-docs/orders/new', params: { id: order.id } })} /> : null}
          {open ? <Button label="Cancel order" kind="danger" block icon={<Close size={18} color={c.danger} />} onPress={cancelAsk} /> : null}
          {history.length === 0 && order.status !== 'delivered' ? <Button label="Delete order" kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={remove} /> : null}
        </View>
      </View>

      <Sheet visible={sheet === 'pay' || sheet === 'refund'} onClose={() => setSheet(null)} title={sheet === 'refund' ? 'Give advance back' : 'Take payment'} subtitle={sheet === 'refund' ? `${inr(money.onHand)} held` : `${inr(money.toPay)} still to pay`}
        footer={<Button label={sheet === 'refund' ? 'Give back' : 'Receive'} size="lg" block onPress={sheet === 'refund' ? giveBack : take} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} />
          <Segmented<Mode> value={mode} options={MODES} onChange={setMode} />
          <Field label="Reference (optional)" value={ref} onChangeText={setRef} placeholder="UPI / cheque / receipt number" />
        </View>
      </Sheet>
      <Sheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} title="Cancel this order" subtitle={`${inr(money.onHand)} of advance goes back to the customer`}
        footer={<Button label="Cancel order and refund" kind="danger" size="lg" block onPress={cancelIt} />}>
        <View style={{ gap: 14 }}>
          <T tone="soft">How is the {inr(money.onHand)} given back?</T>
          <Segmented<Mode> value={mode} options={MODES} onChange={setMode} />
          <Field label="Reference (optional)" value={ref} onChangeText={setRef} />
        </View>
      </Sheet>
    </Screen>
  )
}

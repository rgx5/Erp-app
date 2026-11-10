import React from 'react'
import { ScrollView, View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import type { DataState } from '@/data/state'
import { layawayStatus, ORDER_LABEL, type OrderMoney } from '@/modules/sales-docs/logic/orders'
import { ORDER_TONE } from '@/modules/sales-docs/ui/tones'
import type { PaymentInput } from '@/modules/sales-docs/ops'
import type { Challan, OrderPayment, SalesOrder } from '@/modules/sales-docs/types'
import type { Customer } from '@/domain/types'
import { Field, MoneyField, Segmented } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { BanknoteDown, BanknoteUp, CheckCircle, Close, Pencil, Printer, Receipt, Send, Share, Trash, Truck } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, SplitPane, Toolbar, cellNum, dtext, type Column } from './kit'

type Mode = PaymentInput['mode']
const MODES: Array<{ value: Mode; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }]
const KIND_LABEL = { advance: 'Received', refund: 'Given back', applied: 'Used on a bill' } as const
const INSTALMENT_TONE: Record<string, Tone> = { paid: 'success', overdue: 'danger', due: 'warning', upcoming: 'default' }
type Sheeted = null | 'pay' | 'refund' | 'cancel'
type ItemRow = { id: string; name: string; sub: string; total: number; shortage: string; sentNote: string }

export interface DesktopOrderDetailProps {
  order: SalesOrder
  data: DataState
  customer: Customer | undefined
  money: OrderMoney
  open: boolean
  now: number
  plan: ReturnType<typeof layawayStatus> | null
  history: OrderPayment[]
  sent: Challan[]
  toSend: unknown[]
  late: boolean
  canEdit: boolean
  sheet: Sheeted
  amount: string
  setAmount: (v: string) => void
  mode: Mode
  setMode: (v: Mode) => void
  ref: string
  setRef: (v: string) => void
  onOpenSheet: (kind: Exclude<Sheeted, null>) => void
  onCloseSheet: () => void
  onTake: () => void
  onGiveBack: () => void
  onCancelIt: () => void
  onCancelAsk: () => void
  onReady: (on: boolean) => void
  onBill: () => void
  onDelete: () => void
  onOpenBill: () => void
  onOpenChallan: (id: string) => void
  onWhatsApp: () => void
  onPdf: () => void
  onPrint: () => void
  onEdit: () => void
  onNewChallan: () => void
}

/**
 * The desktop order screen: a toolbar with "Bill it now", a dense grid of the items kept aside, and a side panel
 * for status, the payment plan, money history, deliveries and every status-change action the phone screen stacks
 * as buttons. Every figure and handler comes from `src/app/m/sales-docs/orders/[id].tsx` unchanged.
 */
export function DesktopOrderDetail(p: DesktopOrderDetailProps) {
  const { c } = useTheme()
  const { order, data, customer, money, open, plan, history, sent, late } = p

  const rows: ItemRow[] = order.items.map((l) => {
    const v = data.variants[l.variantId]
    const sentQty = sent.reduce((s, ch) => s + ch.items.filter((x) => x.variantId === l.variantId).reduce((t, x) => t + x.qty, 0), 0)
    return {
      id: l.variantId, name: l.name, sub: [variantLabel(l.size, l.color), `${fmtQty(l.qty)}${l.unit && l.unit !== 'pc' ? ` ${l.unit}` : ''} × ${inr(l.price)}`].filter(Boolean).join(' · '),
      total: l.price * l.qty, shortage: open && v && v.stock < l.qty && !l.noStock ? `Only ${fmtQty(v.stock)} in stock` : '', sentNote: sentQty > 0 ? `${fmtQty(sentQty)} sent on delivery challans` : '',
    }
  })
  const columns: Array<Column<ItemRow>> = [
    { key: 'item', label: 'Item kept aside', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T>
        {r.shortage ? <T style={[dtext.tiny, { color: c.warning }]}>{r.shortage}</T> : null}
        {r.sentNote ? <T style={[dtext.tiny, { color: c.inkMute }]}>{r.sentNote}</T> : null}
      </View>
    ) },
    { key: 'total', label: 'Line total', width: 130, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={<Toolbar title={order.no} subtitle={customer?.name ?? 'Customer'} right={open ? <DeskButton label="Bill it now" tone="primary" icon={<Receipt size={14} color={c.onPrimary} />} onPress={p.onBill} /> : undefined} />}
    >
      {plan && plan.overdue ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="danger" title={`${inr(plan.overdueAmount, 0)} overdue`} body={`${plan.overdue} instalment${plan.overdue === 1 ? ' is' : 's are'} past the date`} action="Take payment" onAction={() => p.onOpenSheet('pay')} /></View>
      ) : null}
      {order.status === 'delivered' && order.billId ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="success" icon={<CheckCircle size={20} color={c.success} />} title="Delivered and billed" action="Open bill" onAction={p.onOpenBill} /></View>
      ) : null}

      <SplitPane widths={['flex', 330]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No items on this order" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill tone={ORDER_TONE[order.status]} label={ORDER_LABEL[order.status]} />
            {plan ? <Pill tone="accent" label="Layaway" /> : null}
            {late ? <Pill tone="danger" label="Past delivery date" /> : null}
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Money</T>
            <KV k="Order total" v={inr(order.total)} strong />
            <KV k="Paid in" v={inr(money.paidIn)} tone="success" />
            {money.applied > 0 ? <KV k="Used on bills" v={inr(money.applied)} /> : null}
            <KV k="Advance held" v={inr(money.onHand)} />
            <KV k="Still to pay" v={inr(money.toPay)} strong tone={money.toPay ? 'warning' : 'success'} />
            {order.expectedDate ? <KV k="Delivery by" v={fmtDate(order.expectedDate)} /> : null}
          </View>

          {plan ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 4 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>Payment plan</T>
              {plan.rows.map((r, i) => <KV key={i} k={fmtDate(r.dueDate)} v={inr(r.amount, 0)} tone={INSTALMENT_TONE[r.state]} sub={r.state === 'paid' ? 'Paid' : r.state === 'overdue' ? 'Overdue' : r.state === 'due' ? 'Next' : 'Later'} />)}
            </View>
          ) : null}

          {history.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 4 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>Money history</T>
              {history.map((pay) => (
                <KV key={pay.id} k={`${KIND_LABEL[pay.kind]}${pay.kind === 'applied' ? '' : ` · ${pay.mode.toUpperCase()}`}`} v={`${pay.kind === 'refund' ? '− ' : ''}${inr(pay.amount, 0)}`} tone={pay.kind === 'advance' ? 'success' : pay.kind === 'refund' ? 'danger' : undefined} sub={`${fmtDateTime(pay.date)}${pay.ref ? ` · ${pay.ref}` : ''}`} />
              ))}
            </View>
          ) : null}

          {sent.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 8 }}>
              <T style={[dtext.label, { color: c.inkMute }]}>Deliveries</T>
              {sent.map((ch) => <DeskButton key={ch.id} label={`${ch.no} · ${ch.status}`} onPress={() => p.onOpenChallan(ch.id)} />)}
            </View>
          ) : null}

          {order.notes ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Notes</T><T style={dtext.cell}>{order.notes}</T></View> : null}

          <View style={{ gap: 8 }}>
            {open && money.toPay > 0 ? <DeskButton label="Take payment" tone="primary" icon={<BanknoteDown size={14} color={c.onPrimary} />} onPress={() => p.onOpenSheet('pay')} /> : null}
            {open && money.onHand > 0 ? <DeskButton label="Give advance back" icon={<BanknoteUp size={14} color={c.ink} />} onPress={() => p.onOpenSheet('refund')} /> : null}
            {open ? <DeskButton label={order.status === 'ready' ? 'Not ready yet' : 'Mark ready for collection'} icon={<CheckCircle size={14} color={c.ink} />} onPress={() => p.onReady(order.status !== 'ready')} /> : null}
            {open && p.toSend.length ? <DeskButton label="Make a delivery challan" icon={<Truck size={14} color={c.ink} />} onPress={p.onNewChallan} /> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <DeskButton label="WhatsApp" icon={<Send size={14} color={c.primary} />} onPress={p.onWhatsApp} />
              <DeskButton label="PDF" icon={<Share size={14} color={c.ink} />} onPress={p.onPdf} />
              <DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={p.onPrint} />
            </View>
            {open && money.applied === 0 ? <DeskButton label="Edit order" icon={<Pencil size={14} color={c.ink} />} onPress={p.onEdit} /> : null}
            {open ? <DeskButton label="Cancel order" tone="danger" icon={<Close size={14} color={c.danger} />} onPress={p.onCancelAsk} /> : null}
            {history.length === 0 && order.status !== 'delivered' ? <DeskButton label="Delete order" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={p.onDelete} /> : null}
          </View>
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.sheet === 'pay' || p.sheet === 'refund'} onClose={p.onCloseSheet} title={p.sheet === 'refund' ? 'Give advance back' : 'Take payment'} subtitle={p.sheet === 'refund' ? `${inr(money.onHand)} held` : `${inr(money.toPay)} still to pay`}
        footer={<DeskButton label={p.sheet === 'refund' ? 'Give back' : 'Receive'} tone="primary" onPress={p.sheet === 'refund' ? p.onGiveBack : p.onTake} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} />
          <Segmented<Mode> value={p.mode} options={MODES} onChange={p.setMode} />
          <Field label="Reference (optional)" value={p.ref} onChangeText={p.setRef} placeholder="UPI / cheque / receipt number" />
        </View>
      </Sheet>
      <Sheet visible={p.sheet === 'cancel'} onClose={p.onCloseSheet} title="Cancel this order" subtitle={`${inr(money.onHand)} of advance goes back to the customer`}
        footer={<DeskButton label="Cancel order and refund" tone="danger" onPress={p.onCancelIt} />}>
        <View style={{ gap: 14 }}>
          <T tone="soft">How is the {inr(money.onHand)} given back?</T>
          <Segmented<Mode> value={p.mode} options={MODES} onChange={p.setMode} />
          <Field label="Reference (optional)" value={p.ref} onChangeText={p.setRef} />
        </View>
      </Sheet>
    </DeskPage>
  )
}

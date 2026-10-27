import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan, useUser } from '@/data/store'
import { approvalRefusal, approvalState, approvalsFor, approverHint, canSend, settingsOf } from '@/modules/purchasing/approvals'
import { decidePurchaseOrder } from '@/modules/purchasing/ops-approvals'
import { isOverdue, remaining, STATUS_LABEL } from '@/modules/purchasing/logic'
import { deletePurchaseOrder, setPoStatus } from '@/modules/purchasing/ops'
import { usePurchaseDraft } from '@/features/purchaseDraft'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, ProgressBar } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, Pencil, Send, Trash, Truck, Close } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One purchase order: its lines with how much has arrived, and what you can do next. */
export default function PurchaseOrderPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const canBuy = useCan('purchases')
  const order = useList('purchaseOrders').find((o) => o.id === id)
  const suppliers = useList('suppliers')
  const receipts = useList('purchases').filter((p) => p.poId === id)
  const views = useVariantViews()
  const data = useApp((s) => s.data)
  const user = useUser()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  if (!canBuy) return <Screen title="Purchase order" back><T tone="mute">Purchase orders are for the owner and managers.</T></Screen>
  if (!order) return <Screen title="Not found" back><T tone="mute">This purchase order is no longer here.</T></Screen>
  const supplier = suppliers.find((s) => s.id === order.supplierId)
  const byId = new Map(views.map((v) => [v.id, v]))
  const open = order.status === 'sent' || order.status === 'partial'
  const late = isOverdue(order, Date.now())
  const settings = settingsOf(data)
  const aState = approvalState(settings, order)
  const sendCheck = canSend(settings, order, user?.role)
  const mayDecide = order.status === 'draft' && aState === 'pending' && approvalRefusal(settings, order, user?.role) === null
  const log = approvalsFor(data, order.id)
  const got = order.items.reduce((s, i) => s + i.receivedQty, 0)
  const want = order.items.reduce((s, i) => s + i.qty, 0)

  function change(to: 'sent' | 'draft' | 'cancelled') {
    try { perform((s, ctx) => setPoStatus(s, order!.id, to, ctx)); toast(to === 'sent' ? 'Marked as sent' : to === 'draft' ? 'Back to draft' : 'Order cancelled', 'ok') }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not change the order', 'err') }
  }
  function decide(decision: 'approved' | 'rejected', note = '') {
    try { perform((s, ctx) => decidePurchaseOrder(s, order!.id, decision, note, ctx)); toast(decision === 'approved' ? 'Order approved' : 'Order turned down', 'ok') }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not record the decision', 'err') }
  }
  function turnDown() {
    if (!reason.trim()) { toast('Say why the order is turned down', 'err'); return }
    decide('rejected', reason); setRejecting(false)
  }
  async function cancel() { if (await ask({ title: `Cancel ${order!.no}?`, message: 'What has not arrived will no longer be expected.', confirm: 'Cancel order', danger: true })) change('cancelled') }
  async function remove() {
    if (!(await ask({ title: `Delete ${order!.no}?`, confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deletePurchaseOrder(s, order!.id, ctx)); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }
  function receive() {
    usePurchaseDraft.getState().set({ supplierId: order!.supplierId, poId: order!.id, lines: order!.items.filter((i) => remaining(i) > 0).map((i) => ({ variantId: i.variantId, qty: remaining(i), cost: i.cost })) })
    router.push({ pathname: '/purchases/new', params: { draft: '1' } })
  }

  return (
    <Screen title={order.no} subtitle={supplier?.name ?? 'Supplier'} back
      footer={order.status === 'draft' ? (mayDecide && !sendCheck.ok
          ? <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label="Turn down" kind="outline" size="lg" block onPress={() => setRejecting(true)} /></View>
              <View style={{ flex: 1 }}><Button label="Approve" size="lg" block icon={<Check size={18} color={c.onPrimary} />} onPress={() => decide('approved')} /></View>
            </View>
          : <Button label="Send to supplier" size="lg" block disabled={!sendCheck.ok} icon={<Send size={18} color={c.onPrimary} />} onPress={() => change('sent')} />)
        : open ? <Button label="Receive goods" size="lg" block icon={<Truck size={18} color={c.onPrimary} />} onPress={receive} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Badge tone={order.status === 'received' ? 'success' : order.status === 'cancelled' ? 'danger' : order.status === 'partial' ? 'warning' : order.status === 'sent' ? 'primary' : 'default'}>{STATUS_LABEL[order.status]}</Badge>
          {late ? <Badge tone="danger">Overdue</Badge> : null}
          {aState === 'pending' ? <Badge tone="warning">Needs approval</Badge> : aState === 'approved' ? <Badge tone="success">Approved</Badge> : aState === 'rejected' ? <Badge tone="danger">Turned down</Badge> : null}
        </View>
        {order.status === 'draft' && aState === 'pending' ? <Notice tone="warning" title="Waiting for approval" body={sendCheck.ok ? 'Your limit covers this order, so you can send it without asking.' : `Orders of ${inr(order.total, 0)} need approval${approverHint(settings, order.total)}.`} /> : null}
        {order.status === 'draft' && aState === 'rejected' ? <Notice tone="danger" title="Turned down" body={sendCheck.reason} /> : null}
        {late ? <Notice tone="danger" title="Past its expected date" body={`Expected ${fmtDayShort(order.expectedDate!)} — ${fmtQty(want - got)} still to arrive.`} /> : null}

        <Card>
          <KV k="Total" v={inr(order.total)} strong />
          <KV k="Ordered" v={fmtDayShort(order.date)} />
          {order.expectedDate ? <KV k="Expected" v={fmtDayShort(order.expectedDate)} /> : null}
          <View style={{ marginTop: 8, gap: 6 }}>
            <T v="caption" tone="mute">{fmtQty(got)} of {fmtQty(want)} received</T>
            <ProgressBar value={want ? got / want : 0} tone={order.status === 'received' ? 'success' : 'primary'} />
          </View>
        </Card>

        <Section title="Items" style={{ marginTop: 6 }}>
          <Card padded={false}>
            {order.items.map((l, i) => {
              const v = byId.get(l.variantId)
              return (
                <View key={l.variantId} style={{ padding: 14, gap: 6, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{v?.productName ?? 'Item'}</T>
                      <T v="caption" tone="mute">{v ? [variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ') : ''}</T>
                    </View>
                    <T v="num">{inr(l.qty * l.cost, 0)}</T>
                  </View>
                  <T v="caption" tone={l.receivedQty >= l.qty ? 'success' : 'soft'}>{fmtQty(l.receivedQty)} / {fmtQty(l.qty)} received · {inr(l.cost)} each</T>
                </View>
              )
            })}
          </Card>
        </Section>

        {receipts.length ? (
          <Section title="Receipts" style={{ marginTop: 6 }}>
            <Card padded={false}>
              {receipts.map((p, i) => (
                <View key={p.id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, flexDirection: 'row', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: p.id } })}>{p.no}</T>
                  <T v="caption" tone="mute">{fmtDayShort(p.date)}</T>
                  <T v="num">{inr(p.total, 0)}</T>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {log.length ? (
          <Section title="Approval history" style={{ marginTop: 6 }}>
            <Card padded={false}>
              {log.map((a, i) => (
                <View key={a.id} style={{ padding: 14, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <T v="bodyStrong">{a.decision === 'approved' ? 'Approved' : 'Turned down'} · {inr(a.amount, 0)}</T>
                  <T v="caption" tone="mute">{data.users[a.userId]?.name ?? a.role} · {fmtDayShort(a.date)}{a.note ? ` · ${a.note}` : ''}</T>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {order.notes ? <Card><T v="label" tone="soft">NOTES</T><T>{order.notes}</T></Card> : null}

        <View style={{ gap: 10, marginTop: 4 }}>
          {order.status === 'draft' || order.status === 'sent' ? <Button label="Edit order" kind="outline" block icon={<Pencil size={18} color={c.ink} />} disabled={got > 0} onPress={() => router.push({ pathname: '/m/purchasing/orders/new', params: { id: order.id } })} /> : null}
          {order.status === 'sent' && got === 0 ? <Button label="Back to draft" kind="outline" block onPress={() => change('draft')} /> : null}
          {order.status === 'draft' ? <Button label="Delete draft" kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={remove} /> : null}
          {open ? <Button label="Cancel order" kind="danger" block icon={<Close size={18} color={c.danger} />} onPress={cancel} /> : null}
        </View>
      </View>
      <Sheet visible={rejecting} onClose={() => setRejecting(false)} title={`Turn down ${order.no}?`} footer={<Button label="Turn down" kind="danger" size="lg" block onPress={turnDown} />}>
        <Field label="Why?" value={reason} onChangeText={setReason} placeholder="So whoever made it knows what to change" multiline />
      </Sheet>
    </Screen>
  )
}

import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import type { DataState } from '@/data/state'
import type { ApprovalState, SendCheck } from '@/modules/purchasing/approvals'
import { STATUS_LABEL } from '@/modules/purchasing/logic'
import type { PoApproval, PurchaseOrder, PurchaseSettings } from '@/modules/purchasing/types'
import type { Purchase, Supplier } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { ProgressBar } from '@/ui/primitives'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, Close, Pencil, Send, Trash, Truck } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

export interface DesktopPurchaseOrderDetailProps {
  order: PurchaseOrder
  supplier: Supplier | undefined
  receipts: Purchase[]
  byId: Map<string, VariantView>
  data: DataState
  open: boolean
  late: boolean
  settings: PurchaseSettings
  aState: ApprovalState
  sendCheck: SendCheck
  mayDecide: boolean
  log: PoApproval[]
  got: number
  want: number
  rejecting: boolean
  setRejecting: (v: boolean) => void
  reason: string
  setReason: (v: string) => void
  onChange: (to: 'sent' | 'draft' | 'cancelled') => void
  onApprove: () => void
  onOpenReject: () => void
  onTurnDown: () => void
  onCancel: () => void
  onRemove: () => void
  onReceive: () => void
  onEdit: () => void
}

type ItemRow = { id: string; name: string; sub: string; qty: number; receivedQty: number; cost: number; line: number }

const STATUS_TONE = (s: PurchaseOrder['status']): Tone => (s === 'received' ? 'success' : s === 'cancelled' ? 'danger' : s === 'partial' ? 'warning' : s === 'sent' ? 'primary' : 'default')

/**
 * The desktop purchase-order screen: a toolbar with the phone footer's actions made visible (approve/turn down,
 * send, receive, edit, cancel, delete), a KPI strip for the total and how much has arrived, a dense grid of the
 * ordered lines, and a side panel for the supplier, receipts against this order and the approval history. Every
 * value and handler is passed down from `src/app/m/purchasing/orders/[id].tsx` exactly as the phone screen computes
 * it; this file only lays it out as a grid + side panel instead of stacked cards.
 */
export function DesktopPurchaseOrderDetail({ order, supplier, receipts, byId, data, open, late, settings, aState, sendCheck, mayDecide, log, got, want, rejecting, setRejecting, reason, setReason, onChange, onApprove, onOpenReject, onTurnDown, onCancel, onRemove, onReceive, onEdit }: DesktopPurchaseOrderDetailProps) {
  const { c } = useTheme()
  const router = useRouter()

  const rows: ItemRow[] = order.items.map((l) => {
    const v = byId.get(l.variantId)
    return { id: l.variantId, name: v?.productName ?? 'Item', sub: v ? [variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ') : '', qty: l.qty, receivedQty: l.receivedQty, cost: l.cost, line: Math.round(l.qty * l.cost * 100) / 100 }
  })

  const columns: Array<Column<ItemRow>> = [
    { key: 'item', label: 'Item ordered', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        {r.sub ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T> : null}
      </View>
    ) },
    { key: 'qty', label: 'Ordered', width: 90, align: 'right', sortValue: (r) => r.qty, render: (r) => cellNum(fmtQty(r.qty)) },
    { key: 'received', label: 'Received', width: 100, align: 'right', sortValue: (r) => r.receivedQty, render: (r) => cellText(fmtQty(r.receivedQty), r.receivedQty >= r.qty) },
    { key: 'cost', label: 'Cost each', width: 100, align: 'right', sortValue: (r) => r.cost, render: (r) => cellNum(inr(r.cost)) },
    { key: 'line', label: 'Line total', width: 110, align: 'right', sortValue: (r) => r.line, render: (r) => cellNum(inr(r.line, 0), true) },
  ]

  const primaryAction = order.status === 'draft'
    ? (mayDecide && !sendCheck.ok
        ? <><DeskButton label="Turn down" onPress={onOpenReject} /><DeskButton label="Approve" tone="primary" icon={<Check size={14} color={c.onPrimary} />} onPress={onApprove} /></>
        : <DeskButton label="Send to supplier" tone="primary" disabled={!sendCheck.ok} icon={<Send size={14} color={c.onPrimary} />} onPress={() => onChange('sent')} />)
    : open ? <DeskButton label="Receive goods" tone="primary" icon={<Truck size={14} color={c.onPrimary} />} onPress={onReceive} /> : null

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={order.no}
          subtitle={supplier?.name ?? 'Supplier'}
          right={
            <>
              {(order.status === 'draft' || order.status === 'sent') && got === 0 ? <DeskButton label="Edit" icon={<Pencil size={14} color={c.ink} />} onPress={onEdit} /> : null}
              {order.status === 'sent' && got === 0 ? <DeskButton label="Back to draft" onPress={() => onChange('draft')} /> : null}
              {order.status === 'draft' ? <DeskButton label="Delete draft" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={onRemove} /> : null}
              {open ? <DeskButton label="Cancel order" tone="danger" icon={<Close size={14} color={c.danger} />} onPress={onCancel} /> : null}
              {primaryAction}
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Order total" value={inr(order.total, 0)} tone="primary" delta={`${order.items.length} ${order.items.length === 1 ? 'line' : 'lines'}`} />
        <KpiTile label="Received" value={`${fmtQty(got)} / ${fmtQty(want)}`} tone={want > 0 && got >= want ? 'success' : 'warning'} delta={order.status === 'received' ? 'Fully received' : 'Still coming'} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Pill tone={STATUS_TONE(order.status)} label={STATUS_LABEL[order.status]} />
        {late ? <Pill tone="danger" label="Overdue" /> : null}
        {aState === 'pending' ? <Pill tone="warning" label="Needs approval" /> : aState === 'approved' ? <Pill tone="success" label="Approved" /> : aState === 'rejected' ? <Pill tone="danger" label="Turned down" /> : null}
      </View>

      {order.status === 'draft' && aState === 'pending' ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone="warning" title="Waiting for approval" body={sendCheck.ok ? 'Your limit covers this order, so you can send it without asking.' : `Orders of ${inr(order.total, 0)} need approval above ${inr(settings.approvalAbove, 0)}.`} />
        </View>
      ) : null}
      {order.status === 'draft' && aState === 'rejected' ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone="danger" title="Turned down" body={sendCheck.reason} />
        </View>
      ) : null}
      {late ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone="danger" title="Past its expected date" body={`Expected ${order.expectedDate ? fmtDayShort(order.expectedDate) : ''} — ${fmtQty(want - got)} still to arrive.`} />
        </View>
      ) : null}

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ padding: 14, gap: 6, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <T style={[dtext.tiny, { color: c.inkMute }]}>{fmtQty(got)} of {fmtQty(want)} received</T>
            <ProgressBar value={want ? got / want : 0} tone={order.status === 'received' ? 'success' : 'primary'} />
          </View>
          <DataTable rows={rows} columns={columns} emptyLabel="No items on this order" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          {supplier ? (
            <Pressable
              onPress={() => router.push({ pathname: '/suppliers/[id]', params: { id: supplier.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <T style={dtext.cellStrong} numberOfLines={1}>{supplier.name}</T>
                <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[supplier.phone, supplier.gstin].filter(Boolean).join(' · ') || 'Supplier'}</T>
              </View>
              <Pill tone="primary" label="View" />
            </Pressable>
          ) : null}

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="Total" v={inr(order.total)} strong />
            <KV k="Ordered" v={fmtDayShort(order.date)} />
            {order.expectedDate ? <KV k="Expected" v={fmtDayShort(order.expectedDate)} /> : null}
          </View>

          {receipts.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
              <View style={{ padding: 14, paddingBottom: 6 }}><T style={[dtext.label, { color: c.inkMute }]}>Receipts</T></View>
              {receipts.map((p, i) => (
                <Pressable key={p.id} onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: p.id } })} style={{ flexDirection: 'row', gap: 8, padding: 14, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <T style={[dtext.cellStrong, { flex: 1 }]} numberOfLines={1}>{p.no}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]}>{fmtDayShort(p.date)}</T>
                  <T style={dtext.num}>{inr(p.total, 0)}</T>
                </Pressable>
              ))}
            </View>
          ) : null}

          {log.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
              <View style={{ padding: 14, paddingBottom: 6 }}><T style={[dtext.label, { color: c.inkMute }]}>Approval history</T></View>
              {log.map((a, i) => (
                <View key={a.id} style={{ padding: 14, paddingTop: i ? 10 : 0, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <T style={dtext.cellStrong}>{a.decision === 'approved' ? 'Approved' : 'Turned down'} · {inr(a.amount, 0)}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]}>{data.users[a.userId]?.name ?? a.role} · {fmtDayShort(a.date)}{a.note ? ` · ${a.note}` : ''}</T>
                </View>
              ))}
            </View>
          ) : null}

          {order.notes ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Notes</T>
              <T style={dtext.cell}>{order.notes}</T>
            </View>
          ) : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={rejecting} onClose={() => setRejecting(false)} title={`Turn down ${order.no}?`} footer={<Button label="Turn down" kind="danger" size="lg" block onPress={onTurnDown} />}>
        <Field label="Why?" value={reason} onChangeText={setReason} placeholder="So whoever made it knows what to change" multiline />
      </Sheet>
    </DeskPage>
  )
}

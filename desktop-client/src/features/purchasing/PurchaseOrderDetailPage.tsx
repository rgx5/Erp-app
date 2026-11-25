import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel'
import { Link, useParams } from '@tanstack/react-router'
import { Fragment, useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { PurchaseOrder } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { sum } from '@/domain/money'
import { isPositiveQty, showQty, subQty } from '@/domain/quantity'
import { netValue } from '@/domain/orders'
import { useItemsById, useParty } from '@/features/masterdata/queries'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, Spinner, TextField } from '@/ui/primitives'
import { ORDER_STATUS } from './PurchaseOrdersPage'
import { useCancelOrder, useCloseOrder, usePostReceipt, usePurchaseOrder } from './queries'

const remaining = (l: PurchaseOrder['lines'][number]): string => subQty(l.quantity, l.quantityReceived)

function ReceiveDrawer({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const post = usePostReceipt()
  const flash = useFlash()
  const items = useItemsById(order.lines.map((l) => l.itemId))
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.filter((l) => isPositiveQty(remaining(l))).map((l) => [l.id, showQty(remaining(l))])))
  const [track, setTrack] = useState<Record<string, { batchNo: string; expiry: string; serials: string }>>({})
  const tr = (id: string) => track[id] ?? { batchNo: '', expiry: '', serials: '' }
  const [problem, setProblem] = useState<string | null>(null)
  const key = useMemo(() => crypto.randomUUID(), [date, note, qty, JSON.stringify(track)])  // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setProblem(null)
    const lines: Record<string, unknown>[] = []
    for (const l of order.lines) {
      const q = (qty[l.id] ?? '').trim()
      if (!q || Number(q) <= 0) continue
      const it = items.data?.get(l.itemId); const t = tr(l.id)
      if (it?.tracking === 'batch') { if (!t.batchNo.trim()) { setProblem(`${it.code}: enter the batch number received.`); return } lines.push({ orderLineId: l.id, quantity: q, batch: { batchNo: t.batchNo.trim(), ...(t.expiry ? { expiryDate: t.expiry } : {}) } }) }
      else if (it?.tracking === 'serial') { const list = t.serials.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean); if (list.length !== Number(q) || new Set(list).size !== list.length) { setProblem(`${it.code}: enter exactly ${q} different serial numbers.`); return } lines.push({ orderLineId: l.id, quantity: q, serialNos: list }) }
      else lines.push({ orderLineId: l.id, quantity: q })
    }
    if (lines.length === 0) { setProblem('Enter the quantity received on at least one line.'); return }
    try {
      const r = await post.mutateAsync({ key, body: { companyId: order.companyId, purchaseOrderId: order.id, receiptDate: date, ...(note.trim() ? { supplierDeliveryNote: note.trim() } : {}), lines } as never })
      flash.show(`${r.grnNo} recorded. The stock is in.`)
      onClose()
    } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not record the receipt.') }
  }
  return (
    <Drawer title={`Receive goods for ${order.poNo}`} onClose={onClose} width={640}>
      <div className="flex flex-col gap-4">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="num py-1 text-right">Ordered</th><th className="num py-1 text-right">Received</th><th className="py-1 pl-3">Receiving now</th></tr></thead>
          <tbody>
            {order.lines.map((l) => (
              <Fragment key={l.id}>
              <tr className="border-t border-line/60">
                <td className="py-1.5">{items.data?.get(l.itemId)?.code ?? ''} {l.description}</td><td className="num py-1.5 text-right">{Number(l.quantity)}</td><td className="num py-1.5 text-right">{Number(l.quantityReceived)}</td>
                <td className="py-1.5 pl-3"><input aria-label={`Receiving ${l.description}`} inputMode="decimal" className="h-8 w-24 rounded border border-line bg-surface px-2 text-right text-sm" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} disabled={!isPositiveQty(remaining(l))} /></td>
              </tr>
              {items.data?.get(l.itemId)?.tracking !== 'none' && items.data?.get(l.itemId) && Number(qty[l.id] ?? 0) > 0 ? (
                <tr><td colSpan={4} className="pb-2">
                  {items.data?.get(l.itemId)?.tracking === 'batch' ? (
                    <div className="grid grid-cols-2 gap-2"><input aria-label={`Batch number for ${items.data?.get(l.itemId)?.code}`} placeholder="Batch number received" className="h-8 rounded border border-line bg-surface px-2 text-sm" value={tr(l.id).batchNo} onChange={(e) => setTrack({ ...track, [l.id]: { ...tr(l.id), batchNo: e.target.value } })} /><input type="date" aria-label={`Expiry for ${items.data?.get(l.itemId)?.code}`} className="h-8 rounded border border-line bg-surface px-2 text-sm" value={tr(l.id).expiry} onChange={(e) => setTrack({ ...track, [l.id]: { ...tr(l.id), expiry: e.target.value } })} /></div>
                  ) : <textarea aria-label={`Serial numbers for ${items.data?.get(l.itemId)?.code}`} rows={2} placeholder="Serial numbers received (one per line)" className="w-full rounded border border-line bg-surface px-2 py-1 text-sm" value={tr(l.id).serials} onChange={(e) => setTrack({ ...track, [l.id]: { ...tr(l.id), serials: e.target.value } })} />}
                </td></tr>) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        <TextField label="Received on" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextField label="Supplier's delivery note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-xs text-muted">Stock goes in at the order price. The cost is held as "goods received, not invoiced" until the supplier's bill is booked.</p>
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={post.isPending} onClick={() => void submit()}>Record receipt</Button>
      </div>
    </Drawer>
  )
}

export function PurchaseOrderDetailPage() {
  const { orderId } = useParams({ from: '/app/purchasing/orders/$orderId' })
  return <OrderDetail key={orderId} orderId={orderId} />
}

function OrderDetail({ orderId }: { orderId: string }) {
  const q = usePurchaseOrder(orderId)
  const perms = useSession((s) => s.me?.permissions ?? [])
  const supplier = useParty(q.data?.supplierId)
  const items = useItemsById((q.data?.lines ?? []).map((l) => l.itemId))
  const cancel = useCancelOrder(orderId)
  const close = useCloseOrder(orderId)
  const flash = useFlash()
  const [receiving, setReceiving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (q.isPending) return <Spinner />
  if (q.error || !q.data) return <Alert>{q.error?.message ?? 'Not found.'}</Alert>
  const o = q.data
  const live = o.status === 'open' || o.status === 'partially_received'
  const act = async (what: 'cancel' | 'close') => { setProblem(null); try { await (what === 'cancel' ? cancel : close).mutateAsync(undefined as never); flash.show(`${o.poNo} ${what === 'cancel' ? 'cancelled' : 'closed'}.`) } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not do that.') } }
  const total = sum(o.lines.map((l) => netValue(l.quantity, l.unitPrice, l.discountPercent)))
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted"><Link to="/purchasing/orders" className="underline">Purchase orders</Link></p>
          <h1 className="page-title">Purchase order {o.poNo} <span className="ml-2 rounded bg-canvas px-2 py-0.5 text-xs font-medium">{ORDER_STATUS[o.status] ?? o.status}</span></h1>
          <p className="text-sm text-muted">{formatDate(o.orderDate)} · {supplier.data?.legalName ?? '…'}{o.expectedDate ? ` · expected ${formatDate(o.expectedDate)}` : ''}</p>
        </div>
        <div className="flex gap-2">
          {live && can(perms, 'purchasing:post') ? <Button onClick={() => setReceiving(true)}>Receive goods</Button> : null}
          {o.status !== 'cancelled' && can(perms, 'purchasing:post') ? <Link to="/purchasing/bills/new" search={{ supplierId: o.supplierId } as never} className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium hover:bg-canvas">Enter bill</Link> : null}
          {live && can(perms, 'purchasing:post') ? <Button variant="secondary" onClick={() => void act('close')}>Close</Button> : null}
          {live && can(perms, 'purchasing:cancel') ? <Button variant="secondary" onClick={() => void act('cancel')}>Cancel</Button> : null}
        </div>
      </div>
      {problem ? <Alert>{problem}</Alert> : null}
      {o.notes ? <Alert tone="info">{o.notes}</Alert> : null}
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">#</th><th className="py-1">Item</th><th className="num py-1 text-right">Ordered</th><th className="num py-1 text-right">Received</th><th className="num py-1 text-right">Billed</th><th className="num py-1 text-right">Price</th><th className="num py-1 text-right">Disc.</th><th className="num py-1 text-right">Value</th></tr></thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{l.lineNo}</td><td className="py-1.5">{items.data?.get(l.itemId)?.code} · {l.description}</td><td className="num py-1.5 text-right">{Number(l.quantity)}</td><td className="num py-1.5 text-right">{Number(l.quantityReceived)}</td><td className="num py-1.5 text-right">{Number(l.quantityBilled)}</td><td className="num py-1.5 text-right">{formatInr(l.unitPrice, { symbol: false })}</td><td className="num py-1.5 text-right">{Number(l.discountPercent) ? `${Number(l.discountPercent)}%` : ''}</td><td className="num py-1.5 text-right">{formatInr(netValue(l.quantity, l.unitPrice, l.discountPercent), { symbol: false })}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-right text-sm text-muted">Order value before GST <b className="num ml-2 text-ink">{formatInr(total)}</b></p>
      </Card>
      <Card><AttachmentsPanel entityType="purchase_order" entityId={o.id} canWrite={can(useSession.getState().me?.permissions ?? [], 'purchasing:post')} /></Card>
      {receiving ? <ReceiveDrawer order={o} onClose={() => setReceiving(false)} /> : null}
    </div>
  )
}

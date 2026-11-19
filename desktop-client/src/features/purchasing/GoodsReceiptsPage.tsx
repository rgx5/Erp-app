import type { ColumnDef } from '@tanstack/react-table'
import { Fragment, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ApiError } from '@/api/errors'
import type { GoodsReceiptHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useItemsById, usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Spinner, TextField } from '@/ui/primitives'
import { useBatches } from '@/features/inventory/trackingQueries'
import { useGoodsReceipt, useGoodsReceipts } from './queries'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { currentApi } from '@/auth/session'
import { z } from 'zod'

function useReturn(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { returnDate: string; reason: string; lines: { receiptLineId: string; quantity: string; batchId?: string; serialNos?: string[] }[] }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/receipts/{id}/return', { params: { path: { id } }, body, headers: { 'idempotency-key': crypto.randomUUID() } }), z.object({ id: z.string() }).passthrough()) },
    onSuccess: () => Promise.all(['goods-receipts', 'goods-receipt', 'grni', 'purchase-order'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}

function ReceiptDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useGoodsReceipt(id)
  const items = useItemsById((q.data?.lines ?? []).map((l) => l.itemId))
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'purchasing:post')
  const ret = useReturn(id)
  const flash = useFlash()
  const [returning, setReturning] = useState(false)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayIso())
  const [track, setTrack] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  if (q.isPending) return <Drawer title="Goods receipt" onClose={onClose}><Spinner /></Drawer>
  if (!q.data) return <Drawer title="Goods receipt" onClose={onClose}><Alert>{q.error?.message ?? 'Not found.'}</Alert></Drawer>
  const r = q.data
  async function submit() {
    setProblem(null)
    const lines: { receiptLineId: string; quantity: string; batchId?: string; serialNos?: string[] }[] = []
    for (const l of r.lines) {
      const v = (qty[l.id] ?? '').trim()
      if (!v || Number(v) <= 0) continue
      const it = items.data?.get(l.itemId); const t = (track[l.id] ?? '').trim()
      if (it?.tracking === 'batch') { if (!t) { setProblem(`${it.code}: choose the batch being returned.`); return } lines.push({ receiptLineId: l.id, quantity: v, batchId: t }) }
      else if (it?.tracking === 'serial') { const list = t.split(/[\n,;\s]+/).filter(Boolean); if (list.length !== Number(v) || new Set(list).size !== list.length) { setProblem(`${it.code}: enter exactly ${v} different serial numbers.`); return } lines.push({ receiptLineId: l.id, quantity: v, serialNos: list }) }
      else lines.push({ receiptLineId: l.id, quantity: v })
    }
    if (lines.length === 0) { setProblem('Enter a quantity to return on at least one line.'); return }
    if (!reason.trim()) { setProblem('A reason is required.'); return }
    try { await ret.mutateAsync({ returnDate: date, reason: reason.trim(), lines }); flash.show(`Goods from ${r.grnNo} returned to the supplier.`); setReturning(false); setQty({}); setReason('') } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not return the goods.') }
  }
  return (
    <Drawer title={r.grnNo} onClose={onClose} width={680}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{formatDate(r.receiptDate)}{r.supplierDeliveryNote ? ` · delivery note ${r.supplierDeliveryNote}` : ''}{r.purchaseOrderId ? <> · <Link to="/purchasing/orders/$orderId" params={{ orderId: r.purchaseOrderId }} className="underline">purchase order</Link></> : null}</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="num py-1 text-right">Received</th><th className="num py-1 text-right">Billed</th><th className="num py-1 text-right">Returned</th><th className="num py-1 text-right">Cost</th><th className="num py-1 text-right">Value</th>{returning ? <th className="py-1 pl-3">Return</th> : null}</tr></thead>
          <tbody>
            {r.lines.map((l) => (
              <Fragment key={l.id}>
              <tr className="border-t border-line/60"><td className="py-1.5">{items.data?.get(l.itemId)?.code} · {items.data?.get(l.itemId)?.name}</td><td className="num py-1.5 text-right">{Number(l.quantity)}</td><td className="num py-1.5 text-right">{Number(l.quantityBilled)}</td><td className="num py-1.5 text-right">{Number(l.quantityReturned)}</td><td className="num py-1.5 text-right">{formatInr(l.unitCost, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(l.value, { symbol: false })}</td>
                {returning ? <td className="py-1.5 pl-3"><input aria-label={`Return ${items.data?.get(l.itemId)?.code ?? ''}`} inputMode="decimal" className="h-8 w-20 rounded border border-line bg-surface px-2 text-right text-sm" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td> : null}</tr>
              {returning && items.data?.get(l.itemId) && items.data.get(l.itemId)?.tracking !== 'none' && Number(qty[l.id] ?? 0) > 0 ? <tr><td colSpan={7} className="pb-2"><ReturnTracking itemId={l.itemId} code={items.data.get(l.itemId)?.code ?? ''} kind={items.data.get(l.itemId)?.tracking ?? 'none'} value={track[l.id] ?? ''} onChange={(v) => setTrack({ ...track, [l.id]: v })} /></td></tr> : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {canPost && !returning ? <Button variant="secondary" className="self-start" onClick={() => setReturning(true)}>Return goods to the supplier</Button> : null}
        {returning ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <TextField label="Return date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            {problem ? <Alert>{problem}</Alert> : null}
            <div className="flex gap-2"><Button busy={ret.isPending} onClick={() => void submit()}>Return goods</Button><Button variant="ghost" onClick={() => setReturning(false)}>Cancel</Button></div>
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

export function GoodsReceiptsPage() {
  const ws = useWorkspace()
  const list = useGoodsReceipts(ws.company?.id)
  const names = usePartiesById(list.rows.map((r) => r.supplierId))
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<GoodsReceiptHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'grnNo', size: 150 }, { header: 'Date', accessorFn: (r) => formatDate(r.receiptDate), size: 100 },
    { header: 'Supplier', accessorFn: (r) => names.data?.get(r.supplierId)?.legalName ?? '…', size: 280 }, { header: 'Delivery note', accessorFn: (r) => r.supplierDeliveryNote ?? '', size: 140 }, { header: 'Status', accessorKey: 'status', size: 90 },
  ], [names.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Goods receipts</h1>
      <p className="text-sm text-muted">Goods are received against a purchase order: open the order and choose "Receive goods".</p>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(r) => r.id} onOpen={(r) => setOpen(r.id)} empty="Nothing received yet." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? <ReceiptDetail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

function ReturnTracking({ itemId, code, kind, value, onChange }: { itemId: string; code: string; kind: string; value: string; onChange: (v: string) => void }) {
  const batches = useBatches(kind === 'batch' ? itemId : undefined)
  if (kind === 'serial') return <textarea aria-label={`Serial numbers returned for ${code}`} rows={2} placeholder="Serial numbers being returned (one per line)" className="w-full rounded border border-line bg-surface px-2 py-1 text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
  return <select aria-label={`Batch returned for ${code}`} className="h-8 w-full rounded border border-line bg-surface px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose the batch being returned…</option>{(batches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.batchNo}</option>)}</select>
}

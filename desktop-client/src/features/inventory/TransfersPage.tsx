import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { TransferHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, todayIso } from '@/domain/format'
import { showQty } from '@/domain/quantity'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { isBlankStock, newStockLine, StockLines, trackingPayload, trackingProblem, type StockLine } from './StockLines'
import { useCancelTransfer, usePostTransfer, useReceiveTransfer, useTransfer, useTransfers } from './queries'

const STATUS: Record<string, string> = { completed: 'Completed', in_transit: 'In transit', partially_received: 'Partly received', cancelled: 'Cancelled' }
const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0

function NewTransfer({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const post = usePostTransfer()
  const flash = useFlash()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [transit, setTransit] = useState('')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<StockLine[]>([newStockLine()])
  const [problem, setProblem] = useState<string | null>(null)
  const fromId = from || ws.warehouses[0]?.id || ''
  const toId = to || ws.warehouses.find((w) => w.id !== fromId)?.id || ''
  const filled = lines.filter((l) => !isBlankStock(l))
  const ready = ws.company && fromId && toId && fromId !== toId && note.trim() && filled.length > 0 && filled.every((l) => l.item && qtyOk(l.quantity) && !trackingProblem(l, false))
  const key = useMemo(() => crypto.randomUUID(), [fromId, toId, transit, date, note, JSON.stringify(lines.map((l) => [l.item?.id, l.quantity, l.batchId, l.serials]))]) // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    if (!ready || !ws.company) return
    setProblem(null)
    try {
      const t = await post.mutateAsync({ key, body: { companyId: ws.company.id, fromWarehouseId: fromId, toWarehouseId: toId, ...(transit ? { transitWarehouseId: transit } : {}), postingDate: date, description: note.trim(), lines: filled.map((l) => ({ itemId: (l.item as { id: string }).id, quantity: l.quantity, ...trackingPayload(l, false) })) as never } })
      flash.show(`${t.transferNo} ${t.status === 'in_transit' ? 'sent; receive it at the other end' : 'completed'}.`)
      onClose()
    } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not post the transfer.') }
  }
  const options = ws.warehouses.map((w) => ({ value: w.id, label: w.name }))
  return (
    <Drawer title="New stock transfer" onClose={onClose} width={680}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="From" value={fromId} onChange={(e) => setFrom(e.target.value)} options={options} />
          <SelectField label="To" value={toId} onChange={(e) => setTo(e.target.value)} options={options} />
          <SelectField label="Via an in-transit warehouse (optional)" value={transit} onChange={(e) => setTransit(e.target.value)} options={[{ value: '', label: 'No: move it straight across' }, ...ws.warehouses.filter((w) => w.kind === 'in_transit').map((w) => ({ value: w.id, label: w.name }))]} />
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} hint="For example: restock the shop floor" />
        <StockLines lines={lines} onChange={setLines} />
        {fromId === toId ? <Alert>Choose two different warehouses.</Alert> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={post.isPending} disabled={!ready} onClick={() => void submit()}>Transfer stock</Button>
      </div>
    </Drawer>
  )
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace()
  const q = useTransfer(id)
  const items = useItemsById((q.data?.lines ?? []).map((l) => l.itemId))
  const perms = useSession((s) => s.me?.permissions ?? [])
  const receive = useReceiveTransfer(id)
  const cancel = useCancelTransfer(id)
  const flash = useFlash()
  const [problem, setProblem] = useState<string | null>(null)
  const name = (wid: string | null | undefined): string => ws.warehouses.find((w) => w.id === wid)?.name ?? ''
  const run = async (fn: () => Promise<unknown>, done: string) => { setProblem(null); try { await fn(); flash.show(done); onClose() } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not do that.') } }
  const t = q.data
  return (
    <Drawer title={t?.transferNo ?? 'Transfer'} onClose={onClose} width={640}>
      {q.isPending ? <Spinner /> : !t ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{name(t.fromWarehouseId)} to {name(t.toWarehouseId)}{t.transitWarehouseId ? ` via ${name(t.transitWarehouseId)}` : ''} · {formatDate(t.postingDate)} · {STATUS[t.status] ?? t.status}<br />{t.description}</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="num py-1 text-right">Sent</th><th className="num py-1 text-right">Received</th></tr></thead>
            <tbody>{t.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(l.itemId)?.code} · {items.data?.get(l.itemId)?.name}</td><td className="num py-1.5 text-right">{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{showQty(l.receivedQuantity)}</td></tr>)}</tbody>
          </table>
          {problem ? <Alert>{problem}</Alert> : null}
          {can(perms, 'stock:post') && (t.status === 'in_transit' || t.status === 'partially_received') ? (
            <div className="flex gap-2">
              <Button busy={receive.isPending} onClick={() => void run(() => receive.mutateAsync({ postingDate: todayIso() }), `${t.transferNo}: everything outstanding is received.`)}>Receive everything outstanding</Button>
              {t.status === 'in_transit' ? <Button variant="secondary" busy={cancel.isPending} onClick={() => void run(() => cancel.mutateAsync({ postingDate: todayIso(), reason: 'Cancelled before receipt' }), `${t.transferNo} cancelled.`)}>Cancel transfer</Button> : null}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  )
}

export function TransfersPage() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'stock:post')
  const [status, setStatus] = useState('')
  const list = useTransfers(ws.company?.id, status || undefined)
  const [open, setOpen] = useState<string | 'new' | null>(null)
  const columns = useMemo<ColumnDef<TransferHeader, unknown>[]>(() => {
    const name = (id: string): string => ws.warehouses.find((w) => w.id === id)?.name ?? ''
    return [{ header: 'Number', accessorKey: 'transferNo', size: 150 }, { header: 'Date', accessorFn: (t) => formatDate(t.postingDate), size: 100 }, { header: 'From', accessorFn: (t) => name(t.fromWarehouseId), size: 160 }, { header: 'To', accessorFn: (t) => name(t.toWarehouseId), size: 160 }, { header: 'Note', accessorKey: 'description', size: 260 }, { header: 'Status', accessorFn: (t) => STATUS[t.status] ?? t.status, size: 130 }]
  }, [ws.warehouses])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Stock transfers</h1>{canPost && ws.warehouses.length > 1 ? <Button onClick={() => setOpen('new')}><Plus className="size-4" aria-hidden /> New transfer</Button> : null}</div>
      {ws.warehouses.length < 2 ? <Alert tone="info">Transfers move stock between warehouses. Add a second warehouse under Organization to use them.</Alert> : null}
      <Toolbar><div className="w-48"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(t) => t.id} onOpen={(t) => setOpen(t.id)} empty="No transfers yet." height={520} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open === 'new' ? <NewTransfer onClose={() => setOpen(null)} /> : open ? <Detail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

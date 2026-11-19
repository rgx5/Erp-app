import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Item, Party, SubcontractHeader, SubcontractOrder } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { fromMicro, showQty, toMicro } from '@/domain/quantity'
import { ItemPicker } from '@/features/masterdata/ItemPicker'
import { useItemsById, usePartiesById } from '@/features/masterdata/queries'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useCreateSubcontract, useSubAction, useSubcontract, useSubcontractPending, useSubcontracts, type SubAction } from './queries'

const STATUS: Record<string, string> = { open: 'Open', closed: 'Closed', cancelled: 'Cancelled' }
const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0
const msg = (e: unknown, fallback: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : fallback)

function NewOrder({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const flash = useFlash()
  const create = useCreateSubcontract()
  const [item, setItem] = useState<Item | null>(null)
  const [worker, setWorker] = useState<Party | null>(null)
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(todayIso())
  const [jw, setJw] = useState('')
  const [src, setSrc] = useState('')
  const [out, setOut] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const kinds = ws.warehouses.filter((w) => w.kind === 'subcontractor')
  const others = ws.warehouses.filter((w) => w.kind !== 'subcontractor')
  const jwId = jw || kinds[0]?.id || ''; const srcId = src || others[0]?.id || ''; const outId = out || others[0]?.id || ''
  const body = ws.company && item && worker && qtyOk(qty) && /^\d{1,14}(\.\d{1,4})?$/.test(rate) && jwId && srcId && outId ? { companyId: ws.company.id, itemId: item.id, orderDate: date, plannedQuantity: qty, outputWarehouseId: outId, subcontractorId: worker.id, jobWorkerWarehouseId: jwId, sourceWarehouseId: srcId, ratePerUnit: rate } : null
  const key = useMemo(() => crypto.randomUUID(), [JSON.stringify(body)]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Drawer title="New job-work order" onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <PartyPicker label="Job worker" role="subcontractor" value={worker} onPick={setWorker} />
        <ItemPicker label="Item to be made" onPick={setItem} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} /><TextField label="Charge per unit" value={rate} onChange={(e) => setRate(e.target.value)} hint="Before tax" />
          <TextField label="Order date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label="Job worker's location" value={jwId} onChange={(e) => setJw(e.target.value)} options={kinds.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField label="Send materials from" value={srcId} onChange={(e) => setSrc(e.target.value)} options={others.map((w) => ({ value: w.id, label: w.name }))} /><SelectField label="Receive finished goods into" value={outId} onChange={(e) => setOut(e.target.value)} options={others.map((w) => ({ value: w.id, label: w.name }))} />
        </div>
        {kinds.length === 0 ? <Alert tone="info">Add a warehouse of kind &ldquo;subcontractor&rdquo; for the job worker first. It holds your materials while they work on them.</Alert> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={create.isPending} disabled={!body} onClick={async () => { if (!body) return; setProblem(null); try { const o = await create.mutateAsync({ body, key }); flash.show(`${o.workOrder.woNo} created for the job worker.`); onClose() } catch (e) { setProblem(msg(e, 'Could not create the order.')) } }}>Create order</Button>
      </div>
    </Drawer>
  )
}

function ActionDrawer({ order, kind, onClose }: { order: SubcontractOrder; kind: 'send' | 'return' | 'receive'; onClose: () => void }) {
  const items = useItemsById([...order.workOrder.materials.map((m) => m.itemId), ...order.pending.map((p) => p.itemId)])
  const act = useSubAction(order.id)
  const flash = useFlash()
  const [date, setDate] = useState(todayIso())
  const rows = kind === 'send' ? order.workOrder.materials.map((m) => ({ itemId: m.itemId, hint: `needed ${showQty(m.requiredQuantity)}`, start: (() => { const left = toMicro(m.requiredQuantity) - toMicro(m.issuedQuantity); return left > 0n ? fromMicro(left) : '' })() })) : order.pending.map((p) => ({ itemId: p.itemId, hint: `with the job worker ${showQty(p.quantity)}`, start: '' }))
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.itemId, r.start])))
  const [vehicle, setVehicle] = useState('')
  const [eway, setEway] = useState('')
  const [good, setGood] = useState('')
  const [scrap, setScrap] = useState('0')
  const [charge, setCharge] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const title = { send: 'Send materials (delivery challan)', return: 'Take materials back', receive: 'Receive finished goods' }[kind]
  async function submit() {
    setProblem(null)
    try {
      if (kind === 'receive') {
        if (!qtyOk(good)) { setProblem('Enter the good quantity received.'); return }
        await act.mutateAsync({ action: 'receive', body: { date, quantity: good, scrapQuantity: scrap || '0', ...(charge ? { chargeAmount: charge } : {}) } })
      } else {
        const lines = rows.filter((r) => qtyOk(qty[r.itemId] ?? '')).map((r) => ({ itemId: r.itemId, quantity: qty[r.itemId] as string }))
        if (!lines.length) { setProblem('Enter a quantity for at least one item.'); return }
        await act.mutateAsync({ action: kind, body: { date, ...(vehicle.trim() ? { vehicleNo: vehicle.trim() } : {}), ...(eway.trim() ? { ewayBillNo: eway.trim() } : {}), lines } })
      }
      flash.show(kind === 'send' ? 'Materials sent.' : kind === 'return' ? 'Materials taken back.' : 'Goods received.'); onClose()
    } catch (e) { setProblem(msg(e, 'That did not go through.')) }
  }
  return (
    <Drawer title={title} onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <div className="w-44"><TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {kind !== 'receive' ? (
          <>
            <table className="w-full text-sm" aria-label="Challan lines"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="py-1" /><th className="w-28 py-1 text-right">Quantity</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.itemId} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(r.itemId)?.code ?? ''}</td><td className="py-1.5 text-xs text-muted">{r.hint}</td>
                <td className="py-1"><input aria-label={`Quantity of ${items.data?.get(r.itemId)?.code ?? ''}`} className="h-8 w-full rounded border border-line bg-surface px-2 text-right text-sm" value={qty[r.itemId] ?? ''} onChange={(e) => setQty({ ...qty, [r.itemId]: e.target.value })} /></td></tr>)}</tbody></table>
            <div className="grid grid-cols-2 gap-4"><TextField label="Vehicle number (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value)} /><TextField label="E-way bill number (optional)" value={eway} onChange={(e) => setEway(e.target.value)} /></div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4"><TextField label="Good units received" value={good} onChange={(e) => setGood(e.target.value)} hint={`Ordered ${showQty(order.workOrder.plannedQuantity)}, received ${showQty(order.workOrder.producedQuantity)}`} /><TextField label="Spoiled units" value={scrap} onChange={(e) => setScrap(e.target.value)} />
            <TextField label="Job-work charge (optional)" value={charge} onChange={(e) => setCharge(e.target.value)} hint={`Defaults to ${formatInr(order.ratePerUnit)} a unit`} /></div>
        )}
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={act.isPending} onClick={() => void submit()}>{title}</Button>
      </div>
    </Drawer>
  )
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useSubcontract(id)
  const o = q.data
  const perms = useSession((s) => s.me?.permissions ?? [])
  const items = useItemsById(o ? [o.workOrder.itemId, ...o.challans.flatMap((c) => c.lines.map((l) => l.itemId))] : [])
  const parties = usePartiesById(o ? [o.subcontractorId] : [])
  const act = useSubAction(id)
  const flash = useFlash()
  const [dialog, setDialog] = useState<null | 'send' | 'return' | 'receive'>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (action: SubAction, done: string) => { setProblem(null); try { await act.mutateAsync({ action, ...(action === 'complete' ? { body: { date: todayIso() } } : {}) }); flash.show(done) } catch (e) { setProblem(msg(e, 'That did not go through.')) } }
  const canProduce = can(perms, 'manufacturing:produce')
  const wo = o?.workOrder
  return (
    <Drawer title={wo ? `${wo.woNo} · job work` : 'Job-work order'} onClose={onClose} width={680}>
      {q.isPending ? <Spinner /> : !o || !wo ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{parties.data?.get(o.subcontractorId)?.legalName ?? ''} · {items.data?.get(wo.itemId)?.name ?? ''} · ordered {showQty(wo.plannedQuantity)}, received {showQty(wo.producedQuantity)} · {formatInr(o.ratePerUnit)} a unit · {STATUS[o.status] ?? o.status} / {wo.status.replaceAll('_', ' ')}</p>
          {o.returnDueDate ? <p className="text-xs text-muted">Materials due back by {formatDate(o.returnDueDate)}.</p> : null}
          {problem ? <Alert>{problem}</Alert> : null}
          {canProduce && o.status === 'open' ? (
            <div className="flex flex-wrap gap-2">
              {wo.status === 'planned' ? <Button busy={act.isPending} onClick={() => void run('release', 'Released.')}>Release</Button> : <><Button variant="secondary" onClick={() => setDialog('send')}>Send materials</Button><Button variant="secondary" onClick={() => setDialog('receive')}>Receive goods</Button><Button variant="secondary" disabled={o.pending.length === 0} onClick={() => setDialog('return')}>Take materials back</Button><Button onClick={() => void run('complete', 'Order completed.')}>Complete</Button></>}
              {can(perms, 'manufacturing:cancel') ? <Button variant="ghost" onClick={() => void run('cancel', 'Order cancelled.')}>Cancel</Button> : null}
            </div>
          ) : null}
          <Card title="Challans">{o.challans.length === 0 ? <p className="text-sm text-muted">Nothing sent yet.</p> : (
            <table className="w-full text-sm" aria-label="Challans"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Number</th><th className="py-1">Date</th><th className="py-1">Kind</th><th className="py-1">Items</th></tr></thead>
              <tbody>{o.challans.map((c) => <tr key={c.id} className="border-t border-line/60"><td className="py-1.5">{c.challanNo}</td><td className="py-1.5">{formatDate(c.challanDate)}</td><td className="py-1.5">{c.kind === 'send' ? 'Sent' : 'Returned'}</td><td className="py-1.5">{c.lines.map((l) => `${items.data?.get(l.itemId)?.code ?? ''} ${showQty(l.quantity)}`).join(', ')}</td></tr>)}</tbody></table>)}</Card>
          <Card title="Cost"><dl className="grid grid-cols-2 gap-x-6 text-sm" aria-label="Job work cost"><div className="flex justify-between"><dt className="text-muted">Materials</dt><dd className="num">{formatInr(wo.cost.materials)}</dd></div><div className="flex justify-between"><dt className="text-muted">Job-work charges</dt><dd className="num">{formatInr(wo.cost.subcontract)}</dd></div><div className="flex justify-between"><dt className="text-muted">Finished goods value</dt><dd className="num">{formatInr(wo.cost.finishedGoods)}</dd></div></dl></Card>
          {dialog ? <ActionDrawer order={o} kind={dialog} onClose={() => setDialog(null)} /> : null}
        </div>
      )}
    </Drawer>
  )
}

export function SubcontractingPage() {
  const ws = useWorkspace()
  const canProduce = can(useSession((s) => s.me?.permissions ?? []), 'manufacturing:produce')
  const [status, setStatus] = useState('open')
  const list = useSubcontracts(ws.company?.id, status || undefined)
  const pending = useSubcontractPending(ws.company?.id, todayIso())
  const parties = usePartiesById(list.rows.map((s) => s.subcontractorId))
  const wos = useMemo(() => new Map((pending.data?.orders ?? []).map((p) => [p.orderId, p])), [pending.data])
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = useMemo<ColumnDef<SubcontractHeader, unknown>[]>(() => [
    { header: 'Job worker', accessorFn: (s) => parties.data?.get(s.subcontractorId)?.legalName ?? '', size: 260 }, { header: 'Charge / unit', accessorFn: (s) => formatInr(s.ratePerUnit), size: 120, meta: { align: 'right' } },
    { header: 'First sent', accessorFn: (s) => (s.firstSentOn ? formatDate(s.firstSentOn) : ''), size: 110 }, { header: 'Due back', accessorFn: (s) => (s.returnDueDate ? formatDate(s.returnDueDate) : ''), size: 110 },
    { header: 'Late?', accessorFn: (s) => (wos.get(s.id)?.overdue ? 'Overdue' : ''), size: 80 }, { header: 'Status', accessorFn: (s) => STATUS[s.status] ?? s.status, size: 90 },
  ], [parties.data, wos])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Job work</h1>{canProduce ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New job-work order</Button> : null}</div>
      {pending.data && pending.data.overdueCount > 0 ? <Alert>{pending.data.overdueCount} order(s) have materials still with the job worker past the return date.</Alert> : null}
      <Toolbar><div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' }, { value: '', label: 'All' }]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(s) => s.id} onOpen={(s) => setOpen(s.id)} empty="No job-work orders yet." height={480} />}
      {open ? <Detail id={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <NewOrder onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

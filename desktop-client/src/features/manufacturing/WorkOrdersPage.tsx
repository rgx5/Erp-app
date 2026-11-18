import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ApiError } from '@/api/errors'
import type { Item, WorkOrder, WorkOrderHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { fromMicro, showQty, subQty, toMicro } from '@/domain/quantity'
import { ItemPicker } from '@/features/masterdata/ItemPicker'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useBoms, useCreateWorkOrder, useWoAction, useWoVariance, useWorkCentres, useWorkOrder, useWorkOrders, type WoAction } from './queries'

export const WO_STATUS: Record<string, string> = { planned: 'Planned', released: 'Released', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }
const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0
const msg = (e: unknown, fallback: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : fallback)

function NewWorkOrder({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const flash = useFlash()
  const navigate = useNavigate()
  const create = useCreateWorkOrder()
  const [item, setItem] = useState<Item | null>(null)
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(todayIso())
  const [due, setDue] = useState('')
  const [bomId, setBomId] = useState('')
  const [out, setOut] = useState('')
  const [mat, setMat] = useState('')
  const [notes, setNotes] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const boms = useBoms(ws.company?.id, 'active')
  const options = boms.rows.filter((b) => b.itemId === item?.id)
  const outId = out || ws.warehouses[0]?.id || ''; const matId = mat || ws.warehouses[0]?.id || ''
  const body = ws.company && item && qtyOk(qty) && outId && matId ? { companyId: ws.company.id, itemId: item.id, orderDate: date, plannedQuantity: qty, outputWarehouseId: outId, materialsWarehouseId: matId, ...(bomId ? { bomId } : {}), ...(due ? { dueDate: due } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) } : null
  const key = useMemo(() => crypto.randomUUID(), [JSON.stringify(body)]) // eslint-disable-line react-hooks/exhaustive-deps
  const wh = ws.warehouses.map((w) => ({ value: w.id, label: w.name }))
  return (
    <Drawer title="New work order" onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <ItemPicker label="Item to make" onPick={(i) => { setItem(i); setBomId('') }} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} /><TextField label="Order date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label="Bill of materials" value={bomId} onChange={(e) => setBomId(e.target.value)} options={[{ value: '', label: 'The one in force on the date' }, ...options.map((b) => ({ value: b.id, label: b.bomNo }))]} />
          <TextField label="Due date (optional)" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <SelectField label="Take materials from" value={matId} onChange={(e) => setMat(e.target.value)} options={wh} /><SelectField label="Put finished goods in" value={outId} onChange={(e) => setOut(e.target.value)} options={wh} />
        </div>
        <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={create.isPending} disabled={!body} onClick={async () => { if (!body) return; setProblem(null); try { const w = await create.mutateAsync({ body, key }); flash.show(`${w.woNo} created.`); onClose(); await navigate({ to: '/manufacturing/orders/$orderId', params: { orderId: w.id } }) } catch (e) { setProblem(msg(e, 'Could not create the work order.')) } }}>Create work order</Button>
      </div>
    </Drawer>
  )
}

export function WorkOrdersPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const canProduce = can(useSession((s) => s.me?.permissions ?? []), 'manufacturing:produce')
  const [status, setStatus] = useState('')
  const list = useWorkOrders(ws.company?.id, status || undefined)
  const items = useItemsById(list.rows.map((w) => w.itemId))
  const [adding, setAdding] = useState(false)
  const columns = useMemo<ColumnDef<WorkOrderHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'woNo', size: 150 }, { header: 'Item', accessorFn: (w) => { const it = items.data?.get(w.itemId); return it ? `${it.code} · ${it.name}` : '' }, size: 280 },
    { header: 'Planned', accessorFn: (w) => showQty(w.plannedQuantity), size: 90, meta: { align: 'right' } }, { header: 'Made', accessorFn: (w) => showQty(w.producedQuantity), size: 90, meta: { align: 'right' } },
    { header: 'Due', accessorFn: (w) => (w.dueDate ? formatDate(w.dueDate) : ''), size: 100 }, { header: 'Status', accessorFn: (w) => WO_STATUS[w.status] ?? w.status, size: 110 },
  ], [items.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Work orders</h1>{canProduce ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New work order</Button> : null}</div>
      <Toolbar><div className="w-48"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, ...Object.entries(WO_STATUS).map(([value, label]) => ({ value, label }))]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(w) => w.id} onOpen={(w) => void navigate({ to: '/manufacturing/orders/$orderId', params: { orderId: w.id } })} empty="No work orders yet." height={520} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {adding ? <NewWorkOrder onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

// ---- one work order ---------------------------------------------------------------------------------------------------------
type Dialog = null | 'issue' | 'return' | 'time' | 'output' | 'complete'

function ActionDrawer({ wo, kind, onClose }: { wo: WorkOrder; kind: Exclude<Dialog, null>; onClose: () => void }) {
  const items = useItemsById(wo.materials.map((m) => m.itemId))
  const act = useWoAction(wo.id)
  const flash = useFlash()
  const [date, setDate] = useState(todayIso())
  const remaining = (m: WorkOrder['materials'][number]): string => { if (kind !== 'issue') return ''; const left = toMicro(m.requiredQuantity) - (toMicro(m.issuedQuantity) - toMicro(m.returnedQuantity)); return left > 0n ? fromMicro(left) : '' }
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(wo.materials.map((m) => [m.itemId, remaining(m)])))
  const [hours, setHours] = useState<Record<number, string>>({})
  const [good, setGood] = useState('')
  const [scrap, setScrap] = useState('0')
  const [problem, setProblem] = useState<string | null>(null)
  const titles = { issue: 'Issue materials', return: 'Return materials', time: 'Report time', output: 'Report output', complete: 'Complete work order' } as const
  async function submit() {
    setProblem(null)
    try {
      if (kind === 'issue' || kind === 'return') {
        const lines = wo.materials.filter((m) => qtyOk(qty[m.itemId] ?? '')).map((m) => ({ itemId: m.itemId, quantity: qty[m.itemId] as string }))
        if (!lines.length) { setProblem('Enter a quantity for at least one material.'); return }
        await act.mutateAsync({ action: kind === 'issue' ? 'issue-materials' : 'return-materials', body: { date, lines } })
      } else if (kind === 'time') {
        const lines = wo.operations.filter((o) => Number(hours[o.opNo] ?? 0) > 0).map((o) => ({ opNo: o.opNo, hours: hours[o.opNo] as string }))
        if (!lines.length) { setProblem('Enter hours for at least one operation.'); return }
        await act.mutateAsync({ action: 'report-time', body: { date, lines } })
      } else if (kind === 'output') {
        if (!qtyOk(good)) { setProblem('Enter the good quantity made.'); return }
        await act.mutateAsync({ action: 'report-output', body: { date, quantity: good, scrapQuantity: scrap || '0' } })
      } else await act.mutateAsync({ action: 'complete', body: { date } })
      flash.show(`${titles[kind]}: done.`); onClose()
    } catch (e) { setProblem(msg(e, 'That did not go through.')) }
  }
  return (
    <Drawer title={titles[kind]} onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <div className="w-44"><TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {kind === 'issue' || kind === 'return' ? (
          <table className="w-full text-sm" aria-label="Materials"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Material</th><th className="py-1 text-right">Needed</th><th className="py-1 text-right">Issued</th><th className="w-28 py-1 text-right">{kind === 'issue' ? 'Issue now' : 'Return'}</th></tr></thead>
            <tbody>{wo.materials.map((m) => <tr key={m.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(m.itemId)?.code ?? ''}</td><td className="num py-1.5 text-right">{showQty(m.requiredQuantity)}</td><td className="num py-1.5 text-right">{showQty(subQty(m.issuedQuantity, m.returnedQuantity))}</td>
              <td className="py-1"><input aria-label={`${kind === 'issue' ? 'Issue' : 'Return'} ${items.data?.get(m.itemId)?.code ?? ''}`} className="h-8 w-full rounded border border-line bg-surface px-2 text-right text-sm" value={qty[m.itemId] ?? ''} onChange={(e) => setQty({ ...qty, [m.itemId]: e.target.value })} /></td></tr>)}</tbody></table>
        ) : null}
        {kind === 'time' ? (
          wo.operations.length === 0 ? <Alert tone="info">This work order has no operations.</Alert> : (
            <table className="w-full text-sm" aria-label="Operations"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Operation</th><th className="py-1 text-right">Planned hrs</th><th className="py-1 text-right">Done hrs</th><th className="w-28 py-1 text-right">Add hours</th></tr></thead>
              <tbody>{wo.operations.map((o) => <tr key={o.id} className="border-t border-line/60"><td className="py-1.5">{o.opNo} · {o.name}</td><td className="num py-1.5 text-right">{o.plannedHours}</td><td className="num py-1.5 text-right">{o.actualHours}</td>
                <td className="py-1"><input aria-label={`Hours for ${o.name}`} className="h-8 w-full rounded border border-line bg-surface px-2 text-right text-sm" value={hours[o.opNo] ?? ''} onChange={(e) => setHours({ ...hours, [o.opNo]: e.target.value })} /></td></tr>)}</tbody></table>)
        ) : null}
        {kind === 'output' ? (
          <div className="grid grid-cols-2 gap-4"><TextField label="Good units made" value={good} onChange={(e) => setGood(e.target.value)} hint={`Planned ${showQty(wo.plannedQuantity)}, made so far ${showQty(wo.producedQuantity)}`} /><TextField label="Spoiled units" value={scrap} onChange={(e) => setScrap(e.target.value)} hint="Their cost stays with the good units" /></div>
        ) : null}
        {kind === 'complete' ? <p className="text-sm text-muted">Completing closes the order: any cost left over after the finished goods are valued goes to the production variance account. It cannot be reopened.</p> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={act.isPending} onClick={() => void submit()}>{titles[kind]}</Button>
      </div>
    </Drawer>
  )
}

export function WorkOrderDetailPage() {
  const { orderId } = useParams({ from: '/app/manufacturing/orders/$orderId' })
  return <WorkOrderDetail key={orderId} id={orderId} />
}

function WorkOrderDetail({ id }: { id: string }) {
  const q = useWorkOrder(id)
  const wo = q.data
  const perms = useSession((s) => s.me?.permissions ?? [])
  const items = useItemsById(wo ? [wo.itemId, ...wo.materials.map((m) => m.itemId), ...wo.transactions.flatMap((t) => (t.itemId ? [t.itemId] : []))] : [])
  const centres = useWorkCentres(useWorkspace().company?.id)
  const act = useWoAction(id)
  const flash = useFlash()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const variance = useWoVariance(id, wo?.status === 'completed' || (wo?.status === 'in_progress'))
  if (q.isPending) return <Spinner />
  if (!wo) return <Alert>{q.error?.message ?? 'Not found.'}</Alert>
  const live = wo.status === 'released' || wo.status === 'in_progress'
  const canProduce = can(perms, 'manufacturing:produce'); const canCancel = can(perms, 'manufacturing:cancel')
  const name = (i: string | null): string => (i ? items.data?.get(i)?.code ?? '' : '')
  const run = async (action: WoAction, done: string) => { setProblem(null); try { await act.mutateAsync({ action }); flash.show(done) } catch (e) { setProblem(msg(e, 'That did not go through.')) } }
  const c = wo.cost
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div><Link to="/manufacturing/orders" className="text-xs text-muted hover:underline">← Work orders</Link><h1 className="text-lg font-semibold">{wo.woNo} · {items.data?.get(wo.itemId)?.name ?? ''}</h1>
          <p className="text-sm text-muted">{WO_STATUS[wo.status] ?? wo.status} · planned {showQty(wo.plannedQuantity)}, made {showQty(wo.producedQuantity)}{Number(wo.scrapQuantity) ? `, spoiled ${showQty(wo.scrapQuantity)}` : ''}{wo.dueDate ? ` · due ${formatDate(wo.dueDate)}` : ''}</p></div>
        {canProduce ? (
          <div className="flex flex-wrap justify-end gap-2">
            {wo.status === 'planned' ? <Button busy={act.isPending} onClick={() => void run('release', `${wo.woNo} released.`)}>Release</Button> : null}
            {live ? <><Button variant="secondary" onClick={() => setDialog('issue')}>Issue materials</Button><Button variant="secondary" onClick={() => setDialog('return')}>Return materials</Button><Button variant="secondary" onClick={() => setDialog('time')}>Report time</Button><Button variant="secondary" onClick={() => setDialog('output')}>Report output</Button><Button onClick={() => setDialog('complete')}>Complete</Button></> : null}
            {canCancel && (wo.status === 'planned' || live) ? <Button variant="ghost" onClick={() => void run('cancel', `${wo.woNo} cancelled.`)}>Cancel</Button> : null}
          </div>
        ) : null}
      </div>
      {problem ? <Alert>{problem}</Alert> : null}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Materials"><table className="w-full text-sm" aria-label="Work order materials"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="py-1 text-right">Needed</th><th className="py-1 text-right">Issued</th><th className="py-1 text-right">Returned</th></tr></thead>
          <tbody>{wo.materials.map((m) => <tr key={m.id} className="border-t border-line/60"><td className="py-1.5">{name(m.itemId)}</td><td className="num py-1.5 text-right">{showQty(m.requiredQuantity)}</td><td className="num py-1.5 text-right">{showQty(m.issuedQuantity)}</td><td className="num py-1.5 text-right">{showQty(m.returnedQuantity)}</td></tr>)}</tbody></table></Card>
        <Card title="Operations">{wo.operations.length === 0 ? <p className="text-sm text-muted">No operations.</p> : <table className="w-full text-sm" aria-label="Work order operations"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Operation</th><th className="py-1">Centre</th><th className="py-1 text-right">Planned</th><th className="py-1 text-right">Actual</th></tr></thead>
          <tbody>{wo.operations.map((o) => <tr key={o.id} className="border-t border-line/60"><td className="py-1.5">{o.opNo} · {o.name}</td><td className="py-1.5">{centres.data?.find((x) => x.id === o.workCentreId)?.code ?? ''}</td><td className="num py-1.5 text-right">{o.plannedHours}</td><td className="num py-1.5 text-right">{o.actualHours}</td></tr>)}</tbody></table>}</Card>
      </div>
      <Card title="Cost so far">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm" aria-label="Work order cost">
          {([['Materials', c.materials], ['Labour and machine', c.labour], ['Overhead', c.overhead], ['Job work charges', c.subcontract], ['Finished goods value', c.finishedGoods], ['Still in work in progress', c.wip]] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="num">{formatInr(v)}</dd></div>)}
        </dl>
      </Card>
      {variance.data ? (
        <Card title="Plan against actual">
          <table className="w-full text-sm" aria-label="Variance"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Line</th><th className="py-1 text-right">Planned</th><th className="py-1 text-right">Actual</th><th className="py-1 text-right">Variance</th></tr></thead>
            <tbody>
              {variance.data.materials.map((m) => <tr key={m.itemCode} className="border-t border-line/60"><td className="py-1.5">{m.itemCode} <span className="text-muted">({showQty(m.netIssuedQuantity)} of {showQty(m.requiredQuantity)})</span></td><td className="num py-1.5 text-right">{formatInr(m.plannedValue)}</td><td className="num py-1.5 text-right">{formatInr(m.actualValue)}</td><td className="num py-1.5 text-right">{formatInr(m.usageVariance)}</td></tr>)}
              {variance.data.operations.map((o) => <tr key={o.opNo} className="border-t border-line/60"><td className="py-1.5">{o.name} <span className="text-muted">({o.actualHours} of {o.plannedHours} h)</span></td><td className="num py-1.5 text-right">{formatInr(o.plannedValue)}</td><td className="num py-1.5 text-right">{formatInr(o.actualValue)}</td><td className="num py-1.5 text-right">{formatInr(o.efficiencyVariance)}</td></tr>)}
              <tr className="border-t border-line font-semibold"><td className="py-1.5">Total</td><td className="num py-1.5 text-right">{formatInr(variance.data.totals.planned)}</td><td className="num py-1.5 text-right">{formatInr(variance.data.totals.actual)}</td><td className="num py-1.5 text-right">{formatInr(variance.data.totals.variance)}</td></tr>
            </tbody></table>
          <p className="mt-2 text-xs text-muted">Negative is cheaper than planned. Yield {variance.data.yield.percent ?? '–'}%, scrap rate {variance.data.yield.scrapRatePercent ?? '–'}%.</p>
        </Card>
      ) : null}
      <Card title="History"><table className="w-full text-sm" aria-label="Work order history"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Date</th><th className="py-1">What</th><th className="py-1">Item</th><th className="py-1 text-right">Qty / hours</th><th className="py-1 text-right">Value</th></tr></thead>
        <tbody>{wo.transactions.map((t) => <tr key={t.id} className="border-t border-line/60"><td className="py-1.5">{formatDate(t.txnDate)}</td><td className="py-1.5">{t.kind.replaceAll('_', ' ')}</td><td className="py-1.5">{name(t.itemId)}</td><td className="num py-1.5 text-right">{t.hours ?? (t.quantity ? showQty(t.quantity) : '')}</td><td className="num py-1.5 text-right">{formatInr(t.value)}</td></tr>)}</tbody></table></Card>
      {dialog ? <ActionDrawer wo={wo} kind={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

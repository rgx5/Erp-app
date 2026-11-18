import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { CountHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, todayIso } from '@/domain/format'
import { showQty, subQty } from '@/domain/quantity'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useCancelCount, useCount, useCounts, useCreateCount, usePostCount, useRecordCounts } from './queries'

const STATUS: Record<string, string> = { open: 'Counting', posted: 'Posted', cancelled: 'Cancelled' }
const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v)

function NewCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const ws = useWorkspace()
  const create = useCreateCount()
  const [warehouseId, setWarehouseId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const wh = warehouseId || ws.warehouses[0]?.id || ''
  const key = useMemo(() => crypto.randomUUID(), [wh, date, note]) // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    if (!ws.company || !wh || !note.trim()) return
    setProblem(null)
    try { const c = await create.mutateAsync({ key, body: { companyId: ws.company.id, warehouseId: wh, countDate: date, description: note.trim() } }); onCreated(c.id) } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not start the count.') }
  }
  return (
    <Drawer title="Start a stock count" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Alert tone="info">A count freezes what the system believes is in the warehouse today. You then enter what you really counted; posting turns the differences into stock adjustments.</Alert>
        <SelectField label="Warehouse" value={wh} onChange={(e) => setWarehouseId(e.target.value)} options={ws.warehouses.map((w) => ({ value: w.id, label: w.name }))} />
        <TextField label="Count date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextField label="Description" value={note} onChange={(e) => setNote(e.target.value)} hint="For example: November cycle count" />
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={create.isPending} disabled={!wh || !note.trim()} onClick={() => void submit()}>Start counting</Button>
      </div>
    </Drawer>
  )
}

function Sheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useCount(id)
  const items = useItemsById((q.data?.lines ?? []).map((l) => l.itemId))
  const perms = useSession((s) => s.me?.permissions ?? [])
  const record = useRecordCounts(id)
  const post = usePostCount(id)
  const cancel = useCancelCount(id)
  const flash = useFlash()
  const [entered, setEntered] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const c = q.data
  const open = c?.status === 'open'
  const shown = (lineId: string, saved: string | null): string => entered[lineId] ?? (saved === null ? '' : showQty(saved))
  async function save(): Promise<boolean> {
    if (!c) return false
    const lines = c.lines.flatMap((l) => { const v = entered[l.id]; return v !== undefined && v.trim() !== '' ? [{ lineId: l.id, countedQuantity: v.trim() }] : [] })
    if (lines.some((l) => !qtyOk(l.countedQuantity))) { setProblem('Counted quantities must be numbers, 0 or more.'); return false }
    if (lines.length === 0) return true
    try { await record.mutateAsync({ lines }); setEntered({}); return true } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not save the counts.'); return false }
  }
  const run = async (fn: () => Promise<unknown>, done: string) => { setProblem(null); try { await fn(); flash.show(done); onClose() } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not do that.') } }
  return (
    <Drawer title={c?.countNo ?? 'Stock count'} onClose={onClose} width={760}>
      {q.isPending ? <Spinner /> : !c ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{formatDate(c.countDate)} · {c.description} · {STATUS[c.status] ?? c.status}</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="num py-1 text-right">System</th><th className="py-1 pl-3">Counted</th><th className="num py-1 text-right">Difference</th></tr></thead>
            <tbody>
              {c.lines.map((l) => {
                const val = shown(l.id, l.countedQuantity)
                const diff = l.variance ?? (qtyOk(val) ? subQty(val, l.snapshotQuantity) : null)
                return (
                  <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(l.itemId)?.code} · {items.data?.get(l.itemId)?.name}</td><td className="num py-1.5 text-right">{showQty(l.snapshotQuantity)}</td>
                    <td className="py-1.5 pl-3"><input aria-label={`Counted ${items.data?.get(l.itemId)?.code ?? ''}`} inputMode="decimal" disabled={!open} className="h-8 w-24 rounded border border-line bg-surface px-2 text-right text-sm disabled:opacity-60" value={val} onChange={(e) => setEntered({ ...entered, [l.id]: e.target.value })} /></td>
                    <td className={`num py-1.5 text-right ${diff && Number(diff) < 0 ? 'text-bad' : diff && Number(diff) > 0 ? 'text-good' : ''}`}>{diff === null ? '' : Number(diff) === 0 ? 'matches' : `${Number(diff) > 0 ? '+' : ''}${showQty(diff)}`}</td></tr>
                )
              })}
            </tbody>
          </table>
          {problem ? <Alert>{problem}</Alert> : null}
          {open && can(perms, 'stock:post') ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" busy={record.isPending} onClick={() => void save().then((ok) => { if (ok) flash.show('Counts saved.') })}>Save counts</Button>
              <Button busy={post.isPending} onClick={() => void run(async () => { if (await save()) await post.mutateAsync({ postingDate: todayIso() }); else throw new ApiError(422, 'validation_failed', 'Fix the counts first.') }, `${c.countNo} posted. The differences were adjusted.`)}>Post differences</Button>
              <Button variant="ghost" busy={cancel.isPending} onClick={() => void run(() => cancel.mutateAsync(undefined as never), `${c.countNo} cancelled.`)}>Cancel count</Button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  )
}

export function CountsPage() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'stock:post')
  const list = useCounts(ws.company?.id)
  const [open, setOpen] = useState<string | 'new' | null>(null)
  const columns = useMemo<ColumnDef<CountHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'countNo', size: 150 }, { header: 'Date', accessorFn: (c) => formatDate(c.countDate), size: 100 },
    { header: 'Warehouse', accessorFn: (c) => ws.warehouses.find((w) => w.id === c.warehouseId)?.name ?? '', size: 170 }, { header: 'Description', accessorKey: 'description', size: 300 }, { header: 'Status', accessorFn: (c) => STATUS[c.status] ?? c.status, size: 110 },
  ], [ws.warehouses])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Stock counts</h1>{canPost ? <Button onClick={() => setOpen('new')}><Plus className="size-4" aria-hidden /> New count</Button> : null}</div>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(c) => c.id} onOpen={(c) => setOpen(c.id)} empty="No counts yet." height={520} />}
      {open === 'new' ? <NewCount onClose={() => setOpen(null)} onCreated={(id) => setOpen(id)} /> : open ? <Sheet id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

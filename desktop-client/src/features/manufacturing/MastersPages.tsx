import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { BomHeader, Item, WorkCentre } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { showQty } from '@/domain/quantity'
import { ItemPicker } from '@/features/masterdata/ItemPicker'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useBom, useBoms, useCreateBom, useCreateWorkCentre, useExplosion, useObsoleteBom, useRollup, useUpdateWorkCentre, useWorkCentres } from './queries'

const rate = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'A rate such as 150 or 150.50')

export function WorkCentresPage() {
  const ws = useWorkspace()
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'manufacturing:manage')
  const list = useWorkCentres(ws.company?.id)
  const create = useCreateWorkCentre(); const update = useUpdateWorkCentre()
  const flash = useFlash()
  const [editing, setEditing] = useState<WorkCentre | 'new' | null>(null)
  const columns = useMemo<ColumnDef<WorkCentre, unknown>[]>(() => [
    { header: 'Code', accessorKey: 'code', size: 100 }, { header: 'Name', accessorKey: 'name', size: 260 },
    { header: 'Labour / hour', accessorFn: (w) => formatInr(w.labourRatePerHour), size: 130, meta: { align: 'right' } }, { header: 'Machine / hour', accessorFn: (w) => formatInr(w.machineRatePerHour), size: 130, meta: { align: 'right' } },
    { header: 'Overhead / hour', accessorFn: (w) => formatInr(w.overheadRatePerHour), size: 130, meta: { align: 'right' } }, { header: 'Status', accessorKey: 'status', size: 90 },
  ], [])
  const schema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/, 'Letters, digits and . _ -'), name: z.string().trim().min(1, 'Required').max(120), labour: rate, machine: rate, overhead: rate, status: z.string() })
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const company = ws.company
  const wc = editing && editing !== 'new' ? editing : null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Work centres</h1>{canManage ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New work centre</Button> : null}</div>
      <p className="max-w-3xl text-sm text-muted">A work centre is a machine, line or bench. Its hourly rates cost the time reported against it in a work order.</p>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(w) => w.id} onOpen={(w) => canManage && setEditing(w)} empty="No work centres yet." height={420} />}
      {editing ? (
        <Drawer title={wc ? `Edit ${wc.code}` : 'New work centre'} onClose={() => setEditing(null)}>
          <SimpleForm schema={schema} defaults={{ code: wc?.code ?? '', name: wc?.name ?? '', labour: wc ? wc.labourRatePerHour : '0', machine: wc ? wc.machineRatePerHour : '0', overhead: wc ? wc.overheadRatePerHour : '0', status: wc?.status ?? 'active' }} fields={['code', 'name', 'labour', 'machine', 'overhead', 'status']} label={wc ? 'Save' : 'Create'}
            submit={async (v) => {
              if (wc) await update.mutateAsync({ id: wc.id, body: { name: v.name, labourRatePerHour: v.labour, machineRatePerHour: v.machine, overheadRatePerHour: v.overhead, status: v.status as 'active' } })
              else await create.mutateAsync({ companyId: company.id, code: v.code, name: v.name, labourRatePerHour: v.labour, machineRatePerHour: v.machine, overheadRatePerHour: v.overhead })
              flash.show(wc ? 'Work centre saved.' : 'Work centre created.'); setEditing(null)
            }}>
            {({ register, errors }) => (<>
              <TextField label="Code" disabled={Boolean(wc)} error={errors.code?.message as string | undefined} {...register('code')} /><TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
              <TextField label="Labour rate per hour" error={errors.labour?.message as string | undefined} {...register('labour')} /><TextField label="Machine rate per hour" error={errors.machine?.message as string | undefined} {...register('machine')} /><TextField label="Overhead rate per hour" error={errors.overhead?.message as string | undefined} {...register('overhead')} />
              {wc ? <SelectField label="Status" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} {...register('status')} /> : null}
            </>)}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}

// ---- bills of material -----------------------------------------------------------------------------------------------------
interface CLine { key: string; item: Item | null; quantity: string; scrap: string }
interface OLine { key: string; name: string; workCentreId: string; setup: string; run: string }
let n = 0
const newC = (): CLine => ({ key: `c${++n}`, item: null, quantity: '', scrap: '0' })
const newO = (): OLine => ({ key: `o${++n}`, name: '', workCentreId: '', setup: '0', run: '0' })
const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0
const hrsOk = (v: string): boolean => /^\d{1,8}(\.\d{1,4})?$/.test(v)

function NewBom({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const flash = useFlash()
  const create = useCreateBom()
  const centres = useWorkCentres(ws.company?.id)
  const [finished, setFinished] = useState<Item | null>(null)
  const [base, setBase] = useState('1')
  const [from, setFrom] = useState(todayIso())
  const [desc, setDesc] = useState('')
  const [lines, setLines] = useState<CLine[]>([newC()])
  const [ops, setOps] = useState<OLine[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const filled = lines.filter((l) => l.item || l.quantity)
  const ready = ws.company && finished && qtyOk(base) && filled.length > 0 && filled.every((l) => l.item && qtyOk(l.quantity) && /^\d{1,2}(\.\d{1,4})?$/.test(l.scrap)) && ops.every((o) => o.name.trim() && (o.workCentreId || centres.data?.[0]) && hrsOk(o.setup) && hrsOk(o.run))
  const body = ready && ws.company && finished ? {
    companyId: ws.company.id, itemId: finished.id, baseQuantity: base, effectiveFrom: from, ...(desc.trim() ? { description: desc.trim() } : {}),
    lines: filled.map((l) => ({ itemId: (l.item as Item).id, quantity: l.quantity, scrapPercent: l.scrap })),
    operations: ops.map((o, i) => ({ opNo: (i + 1) * 10, name: o.name.trim(), workCentreId: o.workCentreId || (centres.data?.[0]?.id as string), setupHours: o.setup, runHours: o.run })),
  } : null
  const key = useMemo(() => crypto.randomUUID(), [JSON.stringify(body)]) // eslint-disable-line react-hooks/exhaustive-deps
  const cell = 'h-9 rounded-md border border-line bg-surface px-2 text-sm'
  return (
    <Drawer title="New bill of materials" onClose={onClose} width={760}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <ItemPicker label="Finished item" onPick={setFinished} />
          <TextField label="Makes (quantity)" value={base} onChange={(e) => setBase(e.target.value)} hint="The lines below produce this many" />
          <TextField label="Effective from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <h3 className="text-sm font-semibold">Materials</h3>
        {lines.map((l) => (
          <div key={l.key} className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 100px 100px 32px' }}>
            <ItemPicker label="Component" onPick={(item) => setLines(lines.map((x) => (x.key === l.key ? { ...x, item } : x)))} />
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">Quantity<input aria-label="Quantity" className={`${cell} text-right`} value={l.quantity} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))} /></label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">Scrap %<input aria-label="Scrap percent" className={`${cell} text-right`} value={l.scrap} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, scrap: e.target.value } : x)))} /></label>
            <button type="button" aria-label="Remove component" className="mb-1 grid size-7 place-items-center rounded text-muted hover:text-bad" onClick={() => lines.length > 1 && setLines(lines.filter((x) => x.key !== l.key))}><Trash2 className="size-4" /></button>
          </div>
        ))}
        <Button variant="ghost" className="self-start" onClick={() => setLines([...lines, newC()])}>+ Add component</Button>
        <h3 className="text-sm font-semibold">Operations (optional)</h3>
        {ops.map((o, i) => (
          <div key={o.key} className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 1fr 90px 90px 32px' }}>
            <TextField label={`Operation ${(i + 1) * 10}`} value={o.name} onChange={(e) => setOps(ops.map((x) => (x.key === o.key ? { ...x, name: e.target.value } : x)))} />
            <SelectField label="Work centre" value={o.workCentreId || centres.data?.[0]?.id || ''} onChange={(e) => setOps(ops.map((x) => (x.key === o.key ? { ...x, workCentreId: e.target.value } : x)))} options={(centres.data ?? []).filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
            <TextField label="Setup hrs" value={o.setup} onChange={(e) => setOps(ops.map((x) => (x.key === o.key ? { ...x, setup: e.target.value } : x)))} /><TextField label="Run hrs" value={o.run} onChange={(e) => setOps(ops.map((x) => (x.key === o.key ? { ...x, run: e.target.value } : x)))} />
            <button type="button" aria-label="Remove operation" className="mb-1 grid size-7 place-items-center rounded text-muted hover:text-bad" onClick={() => setOps(ops.filter((x) => x.key !== o.key))}><Trash2 className="size-4" /></button>
          </div>
        ))}
        <Button variant="ghost" className="self-start" disabled={!centres.data?.length} onClick={() => setOps([...ops, newO()])}>+ Add operation</Button>
        {!centres.data?.length ? <p className="text-xs text-muted">Add a work centre first to cost operations.</p> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={create.isPending} disabled={!body} onClick={async () => { if (!body) return; setProblem(null); try { const b = await create.mutateAsync({ body, key }); flash.show(`${b.bomNo} created.`); onClose() } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not save the bill of materials.') } }}>Create bill of materials</Button>
      </div>
    </Drawer>
  )
}

function BomDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace()
  const q = useBom(id)
  const b = q.data
  const items = useItemsById(b ? [b.itemId, ...b.lines.map((l) => l.itemId)] : [])
  const centres = useWorkCentres(ws.company?.id)
  const obsolete = useObsoleteBom()
  const flash = useFlash()
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'manufacturing:manage')
  const [qty, setQty] = useState('1')
  const roll = useRollup(ws.company?.id, b?.itemId, qty, todayIso())
  const explode = useExplosion(ws.company?.id, b?.itemId, qty, todayIso())
  const name = (i: string): string => { const it = items.data?.get(i); return it ? `${it.code} · ${it.name}` : '' }
  return (
    <Drawer title={b ? `${b.bomNo} · ${items.data?.get(b.itemId)?.code ?? ''}` : 'Bill of materials'} onClose={onClose} width={720}>
      {q.isPending ? <Spinner /> : !b ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Makes {showQty(b.baseQuantity)} · from {formatDate(b.effectiveFrom)}{b.effectiveTo ? ` to ${formatDate(b.effectiveTo)}` : ''} · {b.status}{b.description ? ` · ${b.description}` : ''}</p>
          <table className="w-full text-sm" aria-label="Components"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Component</th><th className="py-1 text-right">Quantity</th><th className="py-1 text-right">Scrap %</th></tr></thead>
            <tbody>{b.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{name(l.itemId)}</td><td className="num py-1.5 text-right">{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{l.scrapPercent}</td></tr>)}</tbody></table>
          {b.operations.length ? <table className="w-full text-sm" aria-label="Operations"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Operation</th><th className="py-1">Work centre</th><th className="py-1 text-right">Setup hrs</th><th className="py-1 text-right">Run hrs</th></tr></thead>
            <tbody>{b.operations.map((o) => <tr key={o.id} className="border-t border-line/60"><td className="py-1.5">{o.opNo} · {o.name}</td><td className="py-1.5">{centres.data?.find((c) => c.id === o.workCentreId)?.name ?? ''}</td><td className="num py-1.5 text-right">{o.setupHours}</td><td className="num py-1.5 text-right">{o.runHours}</td></tr>)}</tbody></table> : null}
          <section className="rounded-lg border border-line p-3" aria-label="What it needs and costs">
            <div className="mb-2 flex items-end gap-3"><div className="w-32"><TextField label="For quantity" value={qty} onChange={(e) => setQty(e.target.value)} /></div><span className="pb-2 text-xs text-muted">Materials needed (with scrap) and the cost at today&apos;s stock costs and work-centre rates. Nothing is posted.</span></div>
            {explode.data ? <ul className="mb-2 text-sm">{explode.data.rawRequirements.map((r) => <li key={r.itemId} className="flex justify-between"><span>{r.itemCode}</span><span className="num">{showQty(r.quantity)}</span></li>)}</ul> : null}
            {roll.data ? (
              <dl className="text-sm" aria-label="Cost roll-up">
                <div className="flex justify-between"><dt>Materials</dt><dd className="num">{formatInr(roll.data.material)}</dd></div><div className="flex justify-between"><dt>Labour and machine</dt><dd className="num">{formatInr(roll.data.labour)}</dd></div><div className="flex justify-between"><dt>Overhead</dt><dd className="num">{formatInr(roll.data.overhead)}</dd></div>
                <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total</dt><dd className="num">{formatInr(roll.data.total)}</dd></div><div className="flex justify-between"><dt>Per unit</dt><dd className="num">{formatInr(roll.data.unitCost)}</dd></div>
                {roll.data.complete ? null : <p className="mt-1 text-xs text-bad">Some components have no cost yet, so this is understated.</p>}
              </dl>) : roll.error ? <Alert>{roll.error.message}</Alert> : null}
          </section>
          {canManage && b.status === 'active' ? <Button variant="secondary" className="self-start" busy={obsolete.isPending} onClick={async () => { await obsolete.mutateAsync(b.id); flash.show(`${b.bomNo} marked obsolete.`); onClose() }}>Mark obsolete</Button> : null}
        </div>
      )}
    </Drawer>
  )
}

export function BomsPage() {
  const ws = useWorkspace()
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'manufacturing:manage')
  const [status, setStatus] = useState('active')
  const list = useBoms(ws.company?.id, status || undefined)
  const items = useItemsById(list.rows.map((b) => b.itemId))
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = useMemo<ColumnDef<BomHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'bomNo', size: 150 }, { header: 'Item', accessorFn: (b) => { const it = items.data?.get(b.itemId); return it ? `${it.code} · ${it.name}` : '' }, size: 300 },
    { header: 'Makes', accessorFn: (b) => showQty(b.baseQuantity), size: 90, meta: { align: 'right' } }, { header: 'From', accessorFn: (b) => formatDate(b.effectiveFrom), size: 100 }, { header: 'Status', accessorKey: 'status', size: 90 },
  ], [items.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Bills of material</h1>{canManage ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New bill of materials</Button> : null}</div>
      <Toolbar><div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'In use' }, { value: 'obsolete', label: 'Obsolete' }, { value: '', label: 'All' }]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(b) => b.id} onOpen={(b) => setOpen(b.id)} empty="No bills of material yet." height={480} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? <BomDetail id={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <NewBom onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

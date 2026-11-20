import { useQueryClient } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Item } from '@/api/schemas'
import { bridge } from '@/bridge'
import { useCategories, useItems } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { useDebounced } from '@/ui/hooks'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { barcodeForLabel } from './barcodeGen'
import { LABEL_SIZES, labelsHtml, type LabelItem } from './labels'

const MAX_LABELS = 5000
const clampCopies = (v: string | undefined, fallback: number): number => Math.max(1, Math.min(500, Math.floor(Number(v ?? fallback)) || fallback))

/** Price labels for many items at once: pick items, set how many of each, make missing barcodes, print one sheet. */
export function LabelsPage() {
  const ws = useWorkspace(); const flash = useFlash(); const qc = useQueryClient()
  const canWrite = can(useSession((s) => s.me?.permissions ?? []), 'masterdata:write')
  const [search, setSearch] = useState(''); const [categoryId, setCategoryId] = useState('')
  const q = useDebounced(search.trim())
  const categories = useCategories()
  const list = useItems({ ...(q ? { q } : {}), status: 'active' })
  const rows = useMemo(() => (categoryId ? list.rows.filter((i) => i.categoryId === categoryId) : list.rows).filter((i) => i.isSellable), [list.rows, categoryId])
  const [picked, setPicked] = useState<Map<string, Item>>(new Map())
  const [copies, setCopies] = useState<Record<string, string>>({})
  const [every, setEvery] = useState('1')
  const [size, setSize] = useState(LABEL_SIZES[0]?.id ?? '')
  const [generate, setGenerate] = useState(true)
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null)

  const toggle = (i: Item) => setPicked((m) => { const n = new Map(m); if (n.has(i.id)) n.delete(i.id); else n.set(i.id, i); return n })
  const allShown = rows.length > 0 && rows.every((i) => picked.has(i.id))
  const toggleAll = () => setPicked((m) => { const n = new Map(m); if (allShown) rows.forEach((i) => n.delete(i.id)); else rows.forEach((i) => n.set(i.id, i)); return n })
  const chosen = [...picked.values()]
  const copiesOf = (i: Item): number => clampCopies(copies[i.id], clampCopies(every, 1))
  const total = chosen.reduce((s, i) => s + copiesOf(i), 0)

  async function print() {
    setProblem(null)
    if (total > MAX_LABELS) { setProblem(`That is ${total.toLocaleString('en-IN')} labels. Print up to ${MAX_LABELS.toLocaleString('en-IN')} at a time.`); return }
    setBusy(true)
    try {
      const out: LabelItem[] = []; let made = 0
      // a few items at a time, so a big pick does not flood the server
      for (let k = 0; k < chosen.length; k += 5) {
        const part = await Promise.all(chosen.slice(k, k + 5).map(async (i) => ({ i, r: await barcodeForLabel(i.id, generate && canWrite) })))
        for (const { i, r } of part) { if (r.made) made++; out.push({ code: i.code, name: i.name, barcode: r.barcode ?? i.code, price: i.mrp ?? null, copies: copiesOf(i) }) }
      }
      const sz = LABEL_SIZES.find((x) => x.id === size) ?? (LABEL_SIZES[0] as (typeof LABEL_SIZES)[number])
      await bridge.document.savePdf(labelsHtml(out, sz, ws.company?.legalName ?? ''), 'labels')
      if (made > 0) { void qc.invalidateQueries({ queryKey: ['barcodes'] }); flash.show(`${made} new barcode${made === 1 ? '' : 's'} created.`) }
    } catch (e) { setProblem(e instanceof ApiError || e instanceof Error ? e.message : 'Could not make the labels.') } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Print labels</h1>
      <p className="text-sm text-muted">Tick the items, set how many labels of each, and print them all in one go. Items with no barcode can be given one automatically.</p>
      <Toolbar>
        <div className="w-72"><TextField label="Search" placeholder="Code or name" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></div>
        <div className="w-56"><SelectField label="Label size" value={size} onChange={(e) => setSize(e.target.value)} options={LABEL_SIZES.map((x) => ({ value: x.id, label: x.name }))} /></div>
        <div className="w-28"><TextField label="Copies each" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} /></div>
      </Toolbar>
      {canWrite ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} /> Create a barcode for items that do not have one</label> : null}
      {problem ? <Alert>{problem}</Alert> : null}
      {list.isPending ? <Spinner /> : (
        <div className="max-h-[52vh] overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-sunken text-left"><tr>
              <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={toggleAll} /></th>
              <th className="px-2 py-2">Code</th><th className="px-2 py-2">Name</th><th className="px-2 py-2 text-right">MRP</th><th className="w-24 px-2 py-2">Copies</th></tr></thead>
            <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No items match.</td></tr> : rows.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Select ${i.name}`} checked={picked.has(i.id)} onChange={() => toggle(i)} /></td>
                <td className="px-2 py-1.5">{i.code}</td><td className="px-2 py-1.5">{i.name}</td><td className="px-2 py-1.5 text-right">{i.mrp ?? ''}</td>
                <td className="px-2 py-1"><input aria-label={`Copies of ${i.name}`} inputMode="numeric" className="w-16 rounded border border-line px-2 py-1" disabled={!picked.has(i.id)} value={copies[i.id] ?? ''} placeholder={String(clampCopies(every, 1))} onChange={(e) => setCopies((c) => ({ ...c, [i.id]: e.target.value }))} /></td>
              </tr>))}</tbody>
          </table>
        </div>)}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more items</Button> : null}
      <div className="flex items-center gap-3">
        <Button busy={busy} disabled={chosen.length === 0} onClick={() => void print()}><Printer className="size-4" aria-hidden /> {window.onesync ? 'Save labels as PDF' : 'Print labels'}</Button>
        <span className="text-sm text-muted">{chosen.length} item{chosen.length === 1 ? '' : 's'} · {total.toLocaleString('en-IN')} label{total === 1 ? '' : 's'}</span>
        {chosen.length ? <Button variant="ghost" onClick={() => setPicked(new Map())}>Clear</Button> : null}
      </div>
    </div>
  )
}

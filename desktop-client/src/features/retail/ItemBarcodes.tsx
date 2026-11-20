import { useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Item } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { bridge } from '@/bridge'
import { useAddBarcode, useBarcodes, useBarcodeStatus } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, TextField } from '@/ui/primitives'
import { useQueryClient } from '@tanstack/react-query'
import { generateBarcode } from './barcodeGen'
import { LABEL_SIZES, labelsHtml } from './labels'

/** The barcodes of one item and its price label. A barcode is only ever switched on or off, never edited. */
export function ItemBarcodes({ item }: { item: Item }) {
  const ws = useWorkspace()
  const canWrite = can(useSession((s) => s.me?.permissions ?? []), 'masterdata:write')
  const list = useBarcodes(item.id)
  const add = useAddBarcode(item.id); const status = useBarcodeStatus()
  const flash = useFlash()
  const [code, setCode] = useState('')
  const qc = useQueryClient()
  const [making, setMaking] = useState(false)
  const [copies, setCopies] = useState('1')
  const [size, setSize] = useState(LABEL_SIZES[0]?.id ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const active = (list.data ?? []).filter((b) => b.status === 'active')
  const printable = active[0]?.barcode ?? item.code
  async function print() {
    const sz = LABEL_SIZES.find((x) => x.id === size) ?? (LABEL_SIZES[0] as (typeof LABEL_SIZES)[number])
    try { await bridge.document.savePdf(labelsHtml([{ code: item.code, name: item.name, barcode: printable, price: item.mrp ?? null, copies: Math.max(1, Math.min(500, Number(copies) || 1)) }], sz, ws.company?.legalName ?? ''), `labels-${item.code}`) } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not make the labels.') }
  }
  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-line pt-4" aria-label="Barcodes">
      <h3 className="text-sm font-semibold">Barcodes and labels</h3>
      <p className="text-xs text-muted">Scan any of these at the counter. With none, the item code itself is what the scanner reads.</p>
      {list.data?.length ? (
        <ul className="flex flex-col gap-1">{list.data.map((b) => (
          <li key={b.id} className="flex items-center justify-between rounded border border-line px-3 py-1.5 text-sm"><span className={b.status === 'active' ? '' : 'text-muted line-through'}>{b.barcode}</span>
            {canWrite ? <Button variant="ghost" aria-label={`${b.status === 'active' ? 'Switch off' : 'Switch on'} ${b.barcode}`} onClick={async () => { try { await status.mutateAsync({ id: b.id, status: b.status === 'active' ? 'inactive' : 'active' }) } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not change it.') } }}>{b.status === 'active' ? 'Switch off' : 'Switch on'}</Button> : null}</li>))}</ul>
      ) : null}
      {canWrite ? (
        <div className="flex items-end gap-2"><div className="flex-1"><TextField label="Add a barcode" value={code} onChange={(e) => setCode(e.target.value)} hint="Scan it here, or type it" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-barcode')?.click() } }} /></div>
          <Button id="add-barcode" variant="secondary" disabled={code.trim().length < 4} busy={add.isPending} onClick={async () => { setProblem(null); try { await add.mutateAsync(code.trim()); flash.show(`Barcode ${code.trim()} added.`); setCode('') } catch (e) { setProblem(e instanceof ApiError ? (e.code === 'barcode_in_use' ? 'That barcode already belongs to another item.' : e.message) : 'Could not add it.') } }}>Add</Button></div>
      ) : null}
      {canWrite ? <Button variant="secondary" className="self-start" busy={making} onClick={async () => { setProblem(null); setMaking(true); try { const b = await generateBarcode(item.id); await qc.invalidateQueries({ queryKey: ['barcodes'] }); flash.show(`Barcode ${b} created.`) } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not create a barcode.') } finally { setMaking(false) } }}>Generate a barcode</Button> : null}
      {problem ? <Alert>{problem}</Alert> : null}
      <div className="grid grid-cols-[1fr_90px_auto] items-end gap-2">
        <SelectField label="Label size" value={size} onChange={(e) => setSize(e.target.value)} options={LABEL_SIZES.map((x) => ({ value: x.id, label: x.name }))} />
        <TextField label="Copies" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} />
        <Button variant="secondary" onClick={() => void print()}>{window.onesync ? 'Save labels as PDF' : 'Print labels'}</Button>
      </div>
      <p className="text-xs text-muted">The label shows the name, the MRP{item.mrp ? '' : ' (none set yet)'} and the barcode {printable}.</p>
    </section>
  )
}

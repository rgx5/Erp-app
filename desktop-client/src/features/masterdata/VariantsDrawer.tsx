import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import { generateBarcode } from '@/features/retail/barcodeGen'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, CheckField, SelectField, TextField } from '@/ui/primitives'
import { ITEM_TYPES } from './ItemForm'
import { planVariants } from './variantPlan'
import { createItemRequest, useCategories, useTaxCodes, useUnits } from './queries'

/** Makes every size and colour of a style in one go: each becomes an ordinary item with its own stock, price and barcode. */
export function VariantsDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const units = useUnits(); const taxes = useTaxCodes(); const categories = useCategories()
  const [style, setStyle] = useState(''); const [name, setName] = useState(''); const [sizes, setSizes] = useState(''); const [colours, setColours] = useState('')
  const [uomId, setUomId] = useState(''); const [taxCodeId, setTaxCodeId] = useState(''); const [hsn, setHsn] = useState(''); const [categoryId, setCategoryId] = useState('')
  const [brand, setBrand] = useState(''); const [mrp, setMrp] = useState(''); const [type, setType] = useState('trading_good'); const [barcodes, setBarcodes] = useState(true)
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null); const [result, setResult] = useState<{ made: number; existed: string[]; failed: string[] } | null>(null)
  const { plan, tooMany } = useMemo(() => planVariants(style, name, sizes, colours), [style, name, sizes, colours])
  const unit = uomId || (units.data ?? []).find((u) => u.code === 'NOS')?.id || (units.data ?? [])[0]?.id || ''
  const mrpOk = mrp === '' || /^\d{1,14}(\.\d{1,4})?$/.test(mrp)
  const ready = style.trim() !== '' && name.trim() !== '' && plan.length > 0 && !tooMany && mrpOk && unit !== '' && (sizes.trim() !== '' || colours.trim() !== '')

  async function run() {
    setBusy(true); setProblem(null); const made: string[] = []; const existed: string[] = []; const failed: string[] = []
    for (const v of plan) {
      try {
        const it = await createItemRequest({ code: v.code, name: v.name, itemType: type as 'service', baseUomId: unit, styleCode: style.trim(), ...(v.size ? { size: v.size } : {}), ...(v.colour ? { colour: v.colour } : {}),
          ...(hsn.trim() ? { hsnSacCode: hsn.trim() } : {}), ...(taxCodeId ? { taxCodeId } : {}), ...(categoryId ? { categoryId } : {}), ...(brand.trim() ? { brand: brand.trim() } : {}), ...(mrp ? { mrp } : {}), isStocked: type !== 'service' }, crypto.randomUUID())
        made.push(v.code)
        if (barcodes) { try { await generateBarcode(it.id) } catch { failed.push(`${v.code} (barcode)`) } }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) existed.push(v.code)
        else { failed.push(`${v.code}: ${e instanceof ApiError ? e.message : 'failed'}`); if (e instanceof ApiError && e.status === 422) break }
      }
    }
    await qc.invalidateQueries({ queryKey: ['items'] }); await qc.invalidateQueries({ queryKey: ['barcodes'] })
    setResult({ made: made.length, existed, failed }); setBusy(false)
  }

  return (
    <Drawer title="New variants" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Enter the sizes and colours and every combination becomes its own item, with its own stock and barcode.</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Style code" placeholder="POLO" value={style} onChange={(e) => setStyle(e.target.value)} hint="Starts every item code" />
          <TextField label="Product name" placeholder="Polo shirt" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Sizes" placeholder="S, M, L, XL" value={sizes} onChange={(e) => setSizes(e.target.value)} hint="Separate with commas" />
          <TextField label="Colours" placeholder="Red, Blue" value={colours} onChange={(e) => setColours(e.target.value)} hint="Separate with commas" />
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={ITEM_TYPES.filter((t) => t.value !== 'service').map((t) => ({ value: t.value, label: t.label }))} />
          <SelectField label="Unit" value={unit} onChange={(e) => setUomId(e.target.value)} options={(units.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))} />
          <SelectField label="GST tax code" value={taxCodeId} onChange={(e) => setTaxCodeId(e.target.value)} options={[{ value: '', label: 'None' }, ...(taxes.data ?? []).map((t) => ({ value: t.id, label: t.code }))]} />
          <TextField label="HSN code" value={hsn} onChange={(e) => setHsn(e.target.value)} />
          <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: 'None' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <TextField label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <TextField label="MRP (each)" inputMode="decimal" value={mrp} onChange={(e) => setMrp(e.target.value)} error={mrpOk ? undefined : 'An amount such as 999'} />
        </div>
        <CheckField label="Create a barcode for each" checked={barcodes} onChange={(e) => setBarcodes(e.target.checked)} />
        {plan.length > 0 && (sizes.trim() || colours.trim()) ? (
          <div className="rounded-lg border border-line bg-sunken p-3 text-sm" aria-label="Preview"><div className="mb-1 font-medium">{plan.length} item{plan.length === 1 ? '' : 's'} will be created</div>
            <ul className="max-h-40 overflow-auto text-xs text-muted">{plan.map((v) => <li key={v.code}>{v.code} · {v.name}</li>)}</ul></div>) : null}
        {tooMany ? <Alert>That is too many combinations. Create up to 150 at a time.</Alert> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        {result ? <Alert tone={result.failed.length ? 'error' : 'info'}>{result.made} created{result.existed.length ? `, ${result.existed.length} already existed (${result.existed.slice(0, 5).join(', ')})` : ''}{result.failed.length ? `. Problems: ${result.failed.slice(0, 3).join('; ')}` : '.'}</Alert> : null}
        <div className="flex gap-2"><Button busy={busy} disabled={!ready} onClick={() => void run()}>Create items</Button><Button variant="ghost" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button></div>
      </div>
    </Drawer>
  )
}

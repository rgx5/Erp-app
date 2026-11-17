import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Party } from '@/api/schemas'
import { isValid } from '@/domain/money'
import { formatInr, todayIso } from '@/domain/format'
import { stateName } from '@/domain/india'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useWorkspace } from '@/features/organization/workspace'
import { useFlash } from '@/ui/flash'
import { useDebounced } from '@/ui/hooks'
import { Alert, Button, Card, CheckField, SelectField, Spinner, TextField } from '@/ui/primitives'
import { emptyLine, isBlank, LineGrid, type Line } from './LineGrid'
import { useCalculation, usePostInvoice, type InvoiceInput } from './queries'

const REGISTERED_SPECIAL = new Set(['sez', 'overseas', 'deemed_export'])
const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0
const pctOk = (v: string): boolean => /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/.test(v)

/** Builds the request from the screen, or null while it is not complete (a half-typed line is never sent). */
export function buildInvoiceBody(h: { companyId: string; registrationId: string; locationId: string; date: string; documentType: string; customer: Party | null; reverseCharge: boolean; taxPayment: string; placeOfSupply: string }, lines: Line[]): InvoiceInput | null {
  const filled = lines.filter((l) => !isBlank(l))
  if (!h.customer || !h.registrationId || filled.length === 0) return null
  for (const l of filled) if (!l.item || !qtyOk(l.quantity) || !isValid(l.unitPrice) || !pctOk(l.discountPercent)) return null
  const special = REGISTERED_SPECIAL.has(h.customer.gstTreatment)
  return {
    companyId: h.companyId, gstRegistrationId: h.registrationId, ...(h.locationId ? { businessLocationId: h.locationId } : {}), documentType: h.documentType as 'tax_invoice', invoiceDate: h.date, customerId: h.customer.id,
    reverseCharge: h.reverseCharge, ...(special && h.taxPayment ? { taxPayment: h.taxPayment as 'with_payment' } : {}), ...(h.placeOfSupply ? { placeOfSupplyState: h.placeOfSupply } : {}),
    lines: filled.map((l) => ({ itemId: (l.item as { id: string }).id, description: l.description || undefined, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, ...(l.item?.isStocked && l.warehouseId ? { warehouseId: l.warehouseId } : {}) })) as InvoiceInput['lines'],
  }
}

export function InvoiceEditorPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const flash = useFlash()
  const [customer, setCustomer] = useState<Party | null>(null)
  const [date, setDate] = useState(todayIso())
  const [documentType, setDocumentType] = useState('tax_invoice')
  const [registrationId, setRegistrationId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [reverseCharge, setReverseCharge] = useState(false)
  const [taxPayment, setTaxPayment] = useState('')
  const placeOfSupply = '' // the server works the place of supply out from the customer's addresses
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [problem, setProblem] = useState<string | null>(null)
  const post = usePostInvoice()

  const regId = registrationId || ws.registrations[0]?.id || ''
  const whId = warehouseId || ws.warehouses[0]?.id || ''
  const body = useMemo(() => (ws.company ? buildInvoiceBody({ companyId: ws.company.id, registrationId: regId, locationId, date, documentType, customer, reverseCharge, taxPayment, placeOfSupply }, lines.map((l) => ({ ...l, warehouseId: l.warehouseId || whId }))) : null), [ws.company, regId, locationId, date, documentType, customer, reverseCharge, taxPayment, placeOfSupply, lines, whId])
  const settled = useDebounced(body, 350)
  const calc = useCalculation(settled)
  const stale = JSON.stringify(settled) !== JSON.stringify(body)
  const bodyJson = JSON.stringify(body)
  const key = useMemo(() => crypto.randomUUID(), [bodyJson]) // eslint-disable-line react-hooks/exhaustive-deps

  // lines that are filled in map, in order, to the lines the server priced
  const computed = useMemo(() => {
    let n = 0
    return lines.map((l) => (isBlank(l) ? undefined : calc.data?.lines[n++]))
  }, [lines, calc.data])
  const special = customer ? REGISTERED_SPECIAL.has(customer.gstTreatment) : false
  const submitRef = useRef<() => void>(() => undefined)

  async function submit() {
    if (!body) return
    setProblem(null)
    try {
      const inv = await post.mutateAsync({ body, key })
      flash.show(`${inv.invoiceNo} posted for ${formatInr(inv.grandTotal)}.${inv.warnings?.length ? ` ${inv.warnings.map((w) => w.message).join(' ')}` : ''}`)
      await navigate({ to: '/sales/invoices/$invoiceId', params: { invoiceId: inv.id } })
    } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : e instanceof Error ? e.message : 'Could not post the invoice.') }
  }
  submitRef.current = () => { void submit() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); submitRef.current() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const t = calc.data?.totals
  const calcError = calc.error instanceof ApiError ? calc.error.message : calc.error ? 'Could not work out the totals.' : null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">New invoice</h1><span className="text-xs text-muted">Ctrl+S posts · Enter moves to the next field</span></div>
      <Card>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2"><PartyPicker role="customer" value={customer} onPick={(p) => { setCustomer(p); setTaxPayment('') }} autoFocus /></div>
          <TextField label="Invoice date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <SelectField label="Document" value={documentType} onChange={(e) => setDocumentType(e.target.value)} options={[{ value: 'tax_invoice', label: 'Tax invoice' }, { value: 'bill_of_supply', label: 'Bill of supply' }]} />
          {ws.registrations.length > 1 ? <SelectField label="GST registration" value={regId} onChange={(e) => setRegistrationId(e.target.value)} options={ws.registrations.map((r) => ({ value: r.id, label: `${r.gstin} · ${stateName(r.stateCode)}` }))} /> : null}
          {ws.locations.length > 1 ? <SelectField label="Place of business" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={[{ value: '', label: 'Default' }, ...ws.locations.map((l) => ({ value: l.id, label: l.name }))]} /> : null}
          {ws.warehouses.length > 1 ? <SelectField label="Ship from" value={whId} onChange={(e) => setWarehouseId(e.target.value)} options={ws.warehouses.map((w) => ({ value: w.id, label: w.name }))} /> : null}
          {special ? <SelectField label="Tax on this supply" value={taxPayment} onChange={(e) => setTaxPayment(e.target.value)} options={[{ value: '', label: 'Choose…' }, { value: 'with_payment', label: 'With payment of IGST' }, { value: 'without_payment', label: 'Without payment (LUT / bond)' }]} /> : null}
          <div className="flex items-end"><CheckField label="Reverse charge" hint="Tax is payable by the customer" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} /></div>
        </div>
      </Card>

      <LineGrid lines={lines} onChange={setLines} warehouses={ws.warehouses} computed={computed as { taxableValue: string; lineTotal: string }[]} />
      <Button variant="ghost" className="self-start" onClick={() => setLines([...lines, emptyLine(whId)])}>+ Add line</Button>

      <div className="grid grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-2">
          {calc.data ? <p className="text-sm text-muted">Place of supply {stateName(calc.data.placeOfSupply)} · {calc.data.taxRegime === 'intra' ? 'CGST + SGST' : 'IGST'}{calc.data.dueDate ? ` · due ${calc.data.dueDate.split('-').reverse().join('/')}` : ''}</p> : <p className="text-sm text-muted">{body ? 'Working out the totals…' : 'Choose a customer and fill in at least one line to see the totals.'}</p>}
          {calcError ? <Alert>{calcError}</Alert> : null}
          {problem ? <Alert>{problem}</Alert> : null}
        </div>
        <Card>
          <dl className="flex flex-col gap-1 text-sm" aria-label="Totals" aria-busy={calc.isFetching || stale}>
            {t ? (
              <>
                <Row label="Taxable value" value={t.taxable} />
                {calc.data?.taxRegime === 'intra' ? <><Row label="CGST" value={t.cgst} /><Row label="SGST" value={t.sgst} /></> : <Row label="IGST" value={t.igst} />}
                {Number(t.cess) ? <Row label="Cess" value={t.cess} /> : null}
                {Number(t.roundOff) ? <Row label="Round off" value={t.roundOff} /> : null}
                <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-base font-semibold"><dt>Grand total</dt><dd className={`num ${calc.isFetching || stale ? 'opacity-50' : ''}`}>{formatInr(t.grandTotal)}</dd></div>
              </>
            ) : <p className="text-muted">No totals yet.</p>}
          </dl>
          <Button className="mt-4 w-full" busy={post.isPending} disabled={!body || stale || calc.isError || !calc.data} onClick={() => void submit()}>Post invoice</Button>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><dt className="text-muted">{label}</dt><dd className="num">{formatInr(value)}</dd></div>
}

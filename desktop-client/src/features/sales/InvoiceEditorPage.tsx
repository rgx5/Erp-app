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
import { Alert, Button, Card, CheckField, PageHeader, SelectField, Spinner, TextField } from '@/ui/primitives'
import { emptyLine, isBlank, LineGrid, serialsOf, trackingIssue, type Line } from './LineGrid'
import { useCreateOrder, useCreateQuote } from './orderQueries'
import { useCalculation, usePostInvoice, type InvoiceInput } from './queries'

const REGISTERED_SPECIAL = new Set(['sez', 'overseas', 'deemed_export'])
const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0
const pctOk = (v: string): boolean => /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/.test(v)

/** Builds the request from the screen, or null while it is not complete (a half-typed line is never sent). */
export function buildInvoiceBody(h: { companyId: string; registrationId: string; locationId: string; date: string; documentType: string; customer: Party | null; reverseCharge: boolean; taxPayment: string; placeOfSupply: string }, lines: Line[]): InvoiceInput | null {
  const filled = lines.filter((l) => !isBlank(l))
  if (!h.customer || !h.registrationId || filled.length === 0) return null
  for (const l of filled) if (!l.item || !qtyOk(l.quantity) || !isValid(l.unitPrice) || !pctOk(l.discountPercent) || trackingIssue(l)) return null
  const special = REGISTERED_SPECIAL.has(h.customer.gstTreatment)
  return {
    companyId: h.companyId, gstRegistrationId: h.registrationId, ...(h.locationId ? { businessLocationId: h.locationId } : {}), documentType: h.documentType as 'tax_invoice', invoiceDate: h.date, customerId: h.customer.id,
    reverseCharge: h.reverseCharge, ...(special && h.taxPayment ? { taxPayment: h.taxPayment as 'with_payment' } : {}), ...(h.placeOfSupply ? { placeOfSupplyState: h.placeOfSupply } : {}),
    lines: filled.map((l) => ({ itemId: (l.item as { id: string }).id, description: l.description || undefined, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, ...(l.item?.isStocked && l.warehouseId ? { warehouseId: l.warehouseId } : {}), ...(l.item?.isStocked && l.item.tracking === 'batch' ? { batchId: l.batchId } : {}), ...(l.item?.isStocked && l.item.tracking === 'serial' ? { serialNos: serialsOf(l.serials) } : {}) })) as InvoiceInput['lines'],
  }
}

export type DocKind = 'invoice' | 'quote' | 'order'
const addDays = (iso: string, n: number): string => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const WORDS: Record<DocKind, { title: string; date: string; action: string }> = { invoice: { title: 'New invoice', date: 'Invoice date', action: 'Post invoice' }, quote: { title: 'New quote', date: 'Quote date', action: 'Save quote' }, order: { title: 'New sales order', date: 'Order date', action: 'Save order' } }

export const InvoiceEditorPage = () => <SalesDocEditor kind="invoice" />
export const QuoteEditorPage = () => <SalesDocEditor kind="quote" />
export const OrderEditorPage = () => <SalesDocEditor kind="order" />

function SalesDocEditor({ kind }: { kind: DocKind }) {
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
  const createQuote = useCreateQuote(); const createOrder = useCreateOrder()
  const [validUntil, setValidUntil] = useState(addDays(todayIso(), 30))
  const [notes, setNotes] = useState('')
  const [reference, setReference] = useState('')
  const [reserve, setReserve] = useState(false)
  const words = WORDS[kind]

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
      if (kind === 'invoice') {
        const inv = await post.mutateAsync({ body, key })
        flash.show(`${inv.invoiceNo} posted for ${formatInr(inv.grandTotal)}.${inv.warnings?.length ? ` ${inv.warnings.map((w) => w.message).join(' ')}` : ''}`)
        await navigate({ to: '/sales/invoices/$invoiceId', params: { invoiceId: inv.id } })
        return
      }
      const { invoiceDate, ...rest } = body as InvoiceInput & { invoiceDate: string }
      if (kind === 'quote') {
        const q = await createQuote.mutateAsync({ key, body: { ...rest, quoteDate: invoiceDate, validUntil, ...(notes.trim() ? { notes: notes.trim() } : {}), lines: (rest.lines as { batchId?: string }[]).map(({ batchId: _b, ...l }) => l) } })
        flash.show(`${q.quoteNo} saved for ${formatInr(q.estimatedTotal)}.`)
        await navigate({ to: '/sales/quotes' })
      } else {
        const o = await createOrder.mutateAsync({ key, body: { ...rest, orderDate: invoiceDate, reserveStock: reserve, ...(reference.trim() ? { customerReference: reference.trim() } : {}) } })
        flash.show(`${o.orderNo} saved.`)
        await navigate({ to: '/sales/orders' })
      }
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
    <div className="flex flex-col gap-4">
      <PageHeader title={words.title} sub={<><kbd>Ctrl</kbd> <kbd>S</kbd> saves · <kbd>Enter</kbd> moves to the next field</>} />
      <Card>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2"><PartyPicker role="customer" value={customer} onPick={(p) => { setCustomer(p); setTaxPayment('') }} autoFocus /></div>
          <TextField label={words.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {kind === 'invoice' ? <SelectField label="Document" value={documentType} onChange={(e) => setDocumentType(e.target.value)} options={[{ value: 'tax_invoice', label: 'Tax invoice' }, { value: 'bill_of_supply', label: 'Bill of supply' }]} /> : null}
          {kind === 'quote' ? <TextField label="Valid until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /> : null}
          {kind === 'order' ? <TextField label="Customer reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} /> : null}
          {kind === 'order' ? <div className="flex items-end"><CheckField label="Hold the stock" hint="Reserve it for this order" checked={reserve} onChange={(e) => setReserve(e.target.checked)} /></div> : null}
          {kind === 'quote' ? <div className="col-span-2"><TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} /></div> : null}
          {ws.registrations.length > 1 ? <SelectField label="GST registration" value={regId} onChange={(e) => setRegistrationId(e.target.value)} options={ws.registrations.map((r) => ({ value: r.id, label: `${r.gstin} · ${stateName(r.stateCode)}` }))} /> : null}
          {ws.locations.length > 1 ? <SelectField label="Place of business" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={[{ value: '', label: 'Default' }, ...ws.locations.map((l) => ({ value: l.id, label: l.name }))]} /> : null}
          {ws.warehouses.length > 1 ? <SelectField label="Ship from" value={whId} onChange={(e) => setWarehouseId(e.target.value)} options={ws.warehouses.map((w) => ({ value: w.id, label: w.name }))} /> : null}
          {special ? <SelectField label="Tax on this supply" value={taxPayment} onChange={(e) => setTaxPayment(e.target.value)} options={[{ value: '', label: 'Choose…' }, { value: 'with_payment', label: 'With payment of IGST' }, { value: 'without_payment', label: 'Without payment (LUT / bond)' }]} /> : null}
          <div className="flex items-end"><CheckField label="Reverse charge" hint="Tax is payable by the customer" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} /></div>
        </div>
      </Card>

      <LineGrid lines={lines} onChange={setLines} warehouses={ws.warehouses} computed={computed as { taxableValue: string; lineTotal: string }[]} />
      <Button variant="ghost" className="self-start" onClick={() => setLines([...lines, emptyLine(whId)])}>+ Add line</Button>

      <div className="sticky bottom-0 z-10 -mx-6 -mb-5 mt-2 flex items-center gap-6 border-t border-line-strong bg-surface px-6 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {calc.data ? <p className="truncate text-[12.5px] text-muted">Place of supply {stateName(calc.data.placeOfSupply)} · {calc.data.taxRegime === 'intra' ? 'CGST + SGST' : 'IGST'}{calc.data.dueDate ? ` · due ${calc.data.dueDate.split('-').reverse().join('/')}` : ''}</p> : <p className="text-[12.5px] text-muted">Choose a customer and fill in at least one line to see the totals.</p>}
          {calcError ? <Alert>{calcError}</Alert> : null}
          {problem ? <Alert>{problem}</Alert> : null}
        </div>
        <dl className="flex items-center gap-5 text-[13px]" aria-label="Totals" aria-busy={calc.isFetching || stale}>
          {t ? (
            <>
              <Row label="Taxable value" value={t.taxable} />
              {calc.data?.taxRegime === 'intra' ? <><Row label="CGST" value={t.cgst} /><Row label="SGST" value={t.sgst} /></> : <Row label="IGST" value={t.igst} />}
              {Number(t.cess) ? <Row label="Cess" value={t.cess} /> : null}
              {Number(t.roundOff) ? <Row label="Round off" value={t.roundOff} /> : null}
              <div className="border-l border-line pl-5 text-right"><dt className="eyebrow">Grand total</dt><dd className={`num text-[20px] font-semibold leading-tight ${calc.isFetching || stale ? 'opacity-50' : ''}`}>{formatInr(t.grandTotal)}</dd></div>
            </>
          ) : <p className="text-muted">No totals yet.</p>}
        </dl>
        <Button className="h-9 px-5" busy={post.isPending || createQuote.isPending || createOrder.isPending} disabled={!body || stale || calc.isError || !calc.data} onClick={() => void submit()}>{words.action}</Button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="text-right"><dt className="eyebrow">{label}</dt><dd className="num text-[13px]">{formatInr(value)}</dd></div>
}

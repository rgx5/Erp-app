import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Bill, GrniLine, Party } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { isValid } from '@/domain/money'
import { STATES, stateName } from '@/domain/india'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useItemsById, useParty } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { emptyLine, isBlank, LineGrid, type Line } from '@/features/sales/LineGrid'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, CheckField, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useBillableLines, usePostBill, usePreviewBill, type BillInput } from './queries'

const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0
const pctOk = (v: string): boolean => /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/.test(v)

interface Pick { qty: string; price: string }
export interface MatchIssue { lineNo: number; kind: string; expected: string; actual: string; deviationPercent: string; tolerancePercent: string }

export function buildBillBody(h: { companyId: string; registrationId: string; supplier: Party | null; invoiceNo: string; invoiceDate: string; billDate: string; reverseCharge: boolean; supplierState: string; override: string }, billable: GrniLine[], picks: Record<string, Pick>, extra: Line[]): BillInput | null {
  if (!h.supplier || !h.registrationId || !h.invoiceNo.trim() || !h.invoiceDate || !h.billDate || h.billDate < h.invoiceDate) return null
  const goods = billable.flatMap((g) => {
    const p = picks[g.lineId]
    if (!p || (p.qty.trim() === '' && p.price.trim() === '')) return []
    return [{ g, p }]
  })
  for (const { p } of goods) if (!qtyOk(p.qty) || !isValid(p.price)) return null
  const services = extra.filter((l) => !isBlank(l))
  for (const l of services) if (!l.item || !qtyOk(l.quantity) || !isValid(l.unitPrice) || !pctOk(l.discountPercent)) return null
  if (goods.length + services.length === 0) return null
  const unregistered = h.supplier.gstTreatment === 'unregistered' || h.supplier.gstTreatment === 'consumer'
  return {
    companyId: h.companyId, gstRegistrationId: h.registrationId, supplierId: h.supplier.id, supplierInvoiceNo: h.invoiceNo.trim(), supplierInvoiceDate: h.invoiceDate, billDate: h.billDate, reverseCharge: h.reverseCharge,
    ...(unregistered && h.supplierState ? { supplierStateCode: h.supplierState } : {}), ...(h.override.trim() ? { overrideMatch: { reason: h.override.trim() } } : {}),
    lines: [
      ...goods.map(({ g, p }) => ({ itemId: g.itemId, quantity: p.qty, unitPrice: p.price, grnLineId: g.lineId })),
      ...services.map((l) => ({ itemId: (l.item as { id: string }).id, description: l.description || undefined, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent })),
    ] as BillInput['lines'],
  }
}

export function BillTotals({ bill }: { bill: Bill }) {
  const intra = bill.taxRegime === 'intra'
  const row = (label: string, value: string, strong = false) => <div className={`flex justify-between ${strong ? 'mt-1 border-t border-line pt-2 text-base font-semibold' : ''}`}><dt className={strong ? '' : 'text-muted'}>{label}</dt><dd className="num">{formatInr(value)}</dd></div>
  return (
    <dl className="flex flex-col gap-1 text-sm" aria-label="Bill totals">
      {row('Taxable value', bill.taxableTotal)}
      {intra ? <>{row('CGST', bill.cgstTotal)}{row('SGST', bill.sgstTotal)}</> : row('IGST', bill.igstTotal)}
      {Number(bill.cessTotal) ? row('Cess', bill.cessTotal) : null}
      {Number(bill.roundOff) ? row('Round off', bill.roundOff) : null}
      {row('Grand total', bill.grandTotal, true)}
      <div className="flex justify-between text-xs text-muted"><dt>Input tax credit</dt><dd className="num">{formatInr(bill.itcTotal)}</dd></div>
    </dl>
  )
}

export function MatchBadge({ status }: { status: string }) {
  const tone = status === 'matched' ? 'bg-good/15 text-good' : status === 'overridden' ? 'bg-warn/20 text-warn' : 'bg-canvas text-muted'
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{status === 'matched' ? 'Matched to receipt' : status === 'overridden' ? 'Approved outside tolerance' : status === 'not_applicable' ? 'No receipt to match' : status}</span>
}

export function BillEditorPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const flash = useFlash()
  const search = useSearch({ strict: false }) as { supplierId?: string }
  const canApprove = can(useSession((s) => s.me?.permissions ?? []), 'purchasing:approve')
  const prefill = useParty(search.supplierId)
  const [chosen, setChosen] = useState<Party | null | undefined>(undefined)
  const supplier = chosen === undefined ? prefill.data ?? null : chosen
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const [billDate, setBillDate] = useState(todayIso())
  const [registrationId, setRegistrationId] = useState('')
  const [reverseCharge, setReverseCharge] = useState(false)
  const [supplierState, setSupplierState] = useState('')
  const [override, setOverride] = useState('')
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [extra, setExtra] = useState<Line[]>([emptyLine()])
  const [problem, setProblem] = useState<unknown>(null)
  const [checked, setChecked] = useState<{ body: string; bill: Bill } | null>(null)
  const preview = usePreviewBill()
  const post = usePostBill()
  const billable = useBillableLines(ws.company?.id, supplier?.id, billDate)
  const items = useItemsById((billable.data ?? []).map((g) => g.itemId))
  const regId = registrationId || ws.registrations[0]?.id || ''
  const body = useMemo(() => (ws.company ? buildBillBody({ companyId: ws.company.id, registrationId: regId, supplier, invoiceNo, invoiceDate, billDate, reverseCharge, supplierState, override }, billable.data ?? [], picks, extra) : null), [ws.company, regId, supplier, invoiceNo, invoiceDate, billDate, reverseCharge, supplierState, override, billable.data, picks, extra])
  const bodyJson = JSON.stringify(body)
  const key = useMemo(() => crypto.randomUUID(), [bodyJson]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = checked && checked.body === bodyJson ? checked.bill : null
  const submitRef = useRef<() => void>(() => undefined)
  const unregistered = supplier ? supplier.gstTreatment === 'unregistered' || supplier.gstTreatment === 'consumer' : false

  async function check() {
    if (!body) return
    setProblem(null)
    try { const bill = await preview.mutateAsync(body); setChecked({ body: bodyJson, bill }) } catch (e) { setChecked(null); setProblem(e) }
  }
  async function submit() {
    if (!body || !current) return
    setProblem(null)
    try {
      const b = await post.mutateAsync({ body, key })
      flash.show(`${b.billNo} booked for ${formatInr(b.grandTotal)}.`)
      await navigate({ to: '/purchasing/bills/$billId', params: { billId: b.id } })
    } catch (e) { setProblem(e) }
  }
  submitRef.current = () => { void (current ? submit() : check()) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); submitRef.current() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const apiError = problem instanceof ApiError ? problem : null
  const issues = (apiError?.code === 'match_failed' ? (apiError.extra['issues'] as MatchIssue[] | undefined) : undefined) ?? []
  const message = apiError && apiError.code !== 'match_failed' ? `${apiError.message}${apiError.requestId ? ` (reference ${apiError.requestId})` : ''}` : problem instanceof Error && !apiError ? problem.message : null

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Enter a supplier bill</h1><span className="text-xs text-muted">Ctrl+S checks, then posts</span></div>
      <Card>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2"><PartyPicker label="Supplier" role="supplier" value={supplier} onPick={(p) => { setChosen(p); setPicks({}) }} autoFocus={!search.supplierId} /></div>
          <TextField label="Supplier's invoice number" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          <TextField label="Supplier's invoice date" type="date" value={invoiceDate} onChange={(e) => { setInvoiceDate(e.target.value); if (billDate < e.target.value) setBillDate(e.target.value) }} />
          <TextField label="Booked on" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          {ws.registrations.length > 1 ? <SelectField label="Buying as" value={regId} onChange={(e) => setRegistrationId(e.target.value)} options={ws.registrations.map((r) => ({ value: r.id, label: `${r.gstin} · ${stateName(r.stateCode)}` }))} /> : null}
          {unregistered ? <SelectField label="Supplier's state" value={supplierState} onChange={(e) => setSupplierState(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...STATES.map((s) => ({ value: s.code, label: s.name }))]} /> : null}
          <div className="flex items-end"><CheckField label="Reverse charge" hint="You pay the tax, not the supplier" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} /></div>
        </div>
      </Card>

      <section aria-label="Goods received" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Goods received, not yet billed</h2>
        {!supplier ? <p className="text-sm text-muted">Choose a supplier to see what they have delivered.</p> : billable.isPending ? <Spinner /> : (billable.data ?? []).length === 0 ? <p className="text-sm text-muted">Nothing is waiting to be billed for this supplier. Charges and services can be added below.</p> : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="bg-canvas text-left text-xs text-muted"><th className="px-3 py-1.5">Receipt</th><th className="py-1.5">Date</th><th className="py-1.5">Item</th><th className="num py-1.5 text-right">Waiting</th><th className="num py-1.5 text-right">Order cost</th><th className="py-1.5 pl-3">Bill quantity</th><th className="py-1.5 pl-3">Supplier's price</th></tr></thead>
              <tbody>
                {(billable.data ?? []).map((g) => {
                  const p = picks[g.lineId]
                  const set = (patch: Partial<Pick>) => setPicks({ ...picks, [g.lineId]: { qty: p?.qty ?? '', price: p?.price ?? '', ...patch } })
                  return (
                    <tr key={g.lineId} className="border-t border-line/60">
                      <td className="px-3 py-1.5">{g.grnNo}</td><td className="py-1.5">{formatDate(g.receiptDate)}</td><td className="py-1.5">{items.data?.get(g.itemId)?.code} · {items.data?.get(g.itemId)?.name}</td>
                      <td className="num py-1.5 text-right">{Number(g.openQuantity)}</td><td className="num py-1.5 text-right">{formatInr(g.unitCost, { symbol: false })}</td>
                      <td className="py-1.5 pl-3"><input aria-label={`Bill quantity for ${g.grnNo}`} inputMode="decimal" className="h-8 w-24 rounded border border-line bg-surface px-2 text-right text-sm" value={p?.qty ?? ''} onChange={(e) => set({ qty: e.target.value, ...(p?.price ? {} : { price: String(Number(g.unitCost)) }) })} /></td>
                      <td className="py-1.5 pl-3"><input aria-label={`Supplier price for ${g.grnNo}`} inputMode="decimal" className="h-8 w-28 rounded border border-line bg-surface px-2 text-right text-sm" value={p?.price ?? ''} onChange={(e) => set({ price: e.target.value })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Other charges" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Services and other charges (no goods received)</h2>
        <LineGrid buying serviceOnly lines={extra} onChange={setExtra} warehouses={[]} computed={[] as never} />
        <Button variant="ghost" className="self-start" onClick={() => setExtra([...extra, emptyLine()])}>+ Add line</Button>
      </section>

      <div className="grid grid-cols-[1fr_340px] gap-4">
        <div className="flex flex-col gap-3">
          {issues.length > 0 ? (
            <Alert>
              <p className="mb-2 font-medium">This bill is outside the company's price or quantity tolerance.</p>
              <table className="w-full text-sm"><thead><tr className="text-left text-xs"><th>Line</th><th>What</th><th className="num text-right">Expected</th><th className="num text-right">Billed</th><th className="num text-right">Over by</th></tr></thead>
                <tbody>{issues.map((i, n) => <tr key={n}><td>{i.lineNo}</td><td>{i.kind}</td><td className="num text-right">{Number(i.expected)}</td><td className="num text-right">{Number(i.actual)}</td><td className="num text-right">{Number(i.deviationPercent)}%</td></tr>)}</tbody></table>
              {canApprove ? <div className="mt-3 flex items-end gap-2"><div className="flex-1"><TextField label="Approve anyway: reason" value={override} onChange={(e) => setOverride(e.target.value)} /></div><Button variant="secondary" disabled={!override.trim()} onClick={() => void check()}>Check with approval</Button></div> : <p className="mt-2 text-xs">Someone with the right to approve purchases must post this bill.</p>}
            </Alert>
          ) : null}
          {message ? <Alert>{message}</Alert> : null}
        </div>
        <Card>
          {current ? (<><div className="mb-2 flex items-center justify-between"><span className="text-xs text-muted">{current.supplierName}</span><MatchBadge status={current.matchStatus} /></div><BillTotals bill={current} /></>) : <p className="text-sm text-muted">{body ? 'Check the bill to see the tax, the input credit and whether it matches what was received.' : 'Fill in the supplier, the invoice number and at least one line.'}</p>}
          <div className="mt-4 flex flex-col gap-2">
            <Button variant={current ? 'secondary' : 'primary'} className="w-full" busy={preview.isPending} disabled={!body} onClick={() => void check()}>{current ? 'Check again' : 'Check bill'}</Button>
            <Button className="w-full" busy={post.isPending} disabled={!current} onClick={() => void submit()}>Post bill</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

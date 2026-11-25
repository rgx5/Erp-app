import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Party } from '@/api/schemas'
import { formatInr, todayIso } from '@/domain/format'
import { isValid, sum } from '@/domain/money'
import { netValue } from '@/domain/orders'
import { stateName } from '@/domain/india'
import { ApprovalNeeded } from '@/features/approvals/ApprovalNeeded'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useWorkspace } from '@/features/organization/workspace'
import { emptyLine, isBlank, LineGrid, type Line } from '@/features/sales/LineGrid'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { takePoDraft } from './poDraft'
import { usePostOrder, type PurchaseOrderInput } from './queries'

const qtyOk = (v: string): boolean => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0
const pctOk = (v: string): boolean => /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/.test(v)

export function buildOrderBody(h: { companyId: string; registrationId: string; date: string; expected: string; supplier: Party | null; reference: string; notes: string }, lines: Line[]): PurchaseOrderInput | null {
  const filled = lines.filter((l) => !isBlank(l))
  if (!h.supplier || !h.registrationId || filled.length === 0) return null
  for (const l of filled) if (!l.item || !qtyOk(l.quantity) || !isValid(l.unitPrice) || !pctOk(l.discountPercent)) return null
  if (h.expected && h.expected < h.date) return null
  return {
    companyId: h.companyId, gstRegistrationId: h.registrationId, supplierId: h.supplier.id, orderDate: h.date, ...(h.expected ? { expectedDate: h.expected } : {}),
    ...(h.reference.trim() ? { supplierReference: h.reference.trim() } : {}), ...(h.notes.trim() ? { notes: h.notes.trim() } : {}),
    lines: filled.map((l) => ({ itemId: (l.item as { id: string }).id, description: l.description || undefined, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, ...(l.item?.isStocked && l.warehouseId ? { warehouseId: l.warehouseId } : {}) })) as PurchaseOrderInput['lines'],
  }
}

export function PurchaseOrderEditorPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const flash = useFlash()
  const post = usePostOrder()
  const [supplier, setSupplier] = useState<Party | null>(null)
  const [date, setDate] = useState(todayIso())
  const [expected, setExpected] = useState('')
  const [registrationId, setRegistrationId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>(() => takePoDraft() ?? [emptyLine()])
  const [error, setError] = useState<unknown>(null)
  const regId = registrationId || ws.registrations[0]?.id || ''
  const whId = warehouseId || ws.warehouses[0]?.id || ''
  const body = useMemo(() => (ws.company ? buildOrderBody({ companyId: ws.company.id, registrationId: regId, date, expected, supplier, reference, notes }, lines.map((l) => ({ ...l, warehouseId: l.warehouseId || whId }))) : null), [ws.company, regId, date, expected, supplier, reference, notes, lines, whId])
  const bodyJson = JSON.stringify(body)
  const key = useMemo(() => crypto.randomUUID(), [bodyJson]) // eslint-disable-line react-hooks/exhaustive-deps
  const values = useMemo(() => lines.map((l) => (isBlank(l) || !qtyOk(l.quantity) || !isValid(l.unitPrice) || !pctOk(l.discountPercent) ? '' : netValue(l.quantity, l.unitPrice, l.discountPercent))), [lines])
  const total = sum(values.filter(Boolean))
  const submitRef = useRef<() => void>(() => undefined)

  async function submit() {
    if (!body) return
    setError(null)
    try {
      const po = await post.mutateAsync({ body, key })
      flash.show(`${po.poNo} created.`)
      await navigate({ to: '/purchasing/orders/$orderId', params: { orderId: po.id } })
    } catch (e) { setError(e) }
  }
  submitRef.current = () => { void submit() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); submitRef.current() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const message = error instanceof ApiError && error.code !== 'approval_required' ? `${error.message}${error.requestId ? ` (reference ${error.requestId})` : ''}` : error instanceof Error && !(error instanceof ApiError) ? error.message : null
  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">New purchase order</h1><span className="text-xs text-muted">Ctrl+S saves · Enter moves to the next field</span></div>
      <Card>
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2"><PartyPicker label="Supplier" role="supplier" value={supplier} onPick={setSupplier} autoFocus /></div>
          <TextField label="Order date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Expected on (optional)" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          {ws.registrations.length > 1 ? <SelectField label="Buying as" value={regId} onChange={(e) => setRegistrationId(e.target.value)} options={ws.registrations.map((r) => ({ value: r.id, label: `${r.gstin} · ${stateName(r.stateCode)}` }))} /> : null}
          {ws.warehouses.length > 1 ? <SelectField label="Deliver to" value={whId} onChange={(e) => setWarehouseId(e.target.value)} options={ws.warehouses.map((w) => ({ value: w.id, label: w.name }))} /> : null}
          <TextField label="Supplier's reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
          <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Card>
      <LineGrid buying partyId={supplier?.id} lines={lines} onChange={setLines} warehouses={ws.warehouses} computed={values.map((v) => (v ? { taxableValue: v, lineTotal: '0' } : undefined)) as { taxableValue: string; lineTotal: string }[]} />
      <Button variant="ghost" className="self-start" onClick={() => setLines([...lines, emptyLine(whId)])}>+ Add line</Button>
      <div className="grid grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-2">
          <ApprovalNeeded error={error} request={body && ws.company ? { companyId: ws.company.id, documentType: 'purchase_order', payload: body as unknown as Record<string, unknown> } : null} />
          {message ? <Alert>{message}</Alert> : null}
        </div>
        <Card>
          <div className="flex items-center justify-between text-base font-semibold"><span>Order value</span><span className="num">{formatInr(total)}</span></div>
          <p className="mt-1 text-xs text-muted">Before GST. The tax is worked out when the supplier's bill is booked.</p>
          <Button className="mt-4 w-full" busy={post.isPending} disabled={!body} onClick={() => void submit()}>Create order</Button>
        </Card>
      </div>
    </div>
  )
}

import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { LandedCostHeader, LedgerAccount } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { showQty } from '@/domain/quantity'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useCancelLandedCost, useCreateLandedCost, useLandedCost, useLandedCosts } from './landedQueries'
import { useGoodsReceipt, useGoodsReceipts } from './queries'

const KINDS = [['freight', 'Freight'], ['customs_duty', 'Customs duty'], ['insurance', 'Insurance'], ['handling', 'Handling'], ['other', 'Other']] as const
const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)
interface Charge { key: string; kind: string; amount: string; account: LedgerAccount | null }
let n = 0
const newCharge = (): Charge => ({ key: `c${++n}`, kind: 'freight', amount: '', account: null })

function NewVoucher({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const flash = useFlash()
  const create = useCreateLandedCost()
  const receipts = useGoodsReceipts(ws.company?.id)
  const [receiptId, setReceiptId] = useState('')
  const receipt = useGoodsReceipt(receiptId || undefined)
  const items = useItemsById(receipt.data?.lines.map((l) => l.itemId) ?? [])
  const [chosen, setChosen] = useState<string[]>([])
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [basis, setBasis] = useState('value')
  const [charges, setCharges] = useState<Charge[]>([newCharge()])
  const [problem, setProblem] = useState<string | null>(null)
  const ready = ws.company && description.trim() && chosen.length > 0 && charges.every((c) => c.account && /^\d{1,14}(\.\d{1,4})?$/.test(c.amount) && Number(c.amount) > 0)
  const body = ready && ws.company ? { companyId: ws.company.id, voucherDate: date, description: description.trim(), basis, charges: charges.map((c) => ({ kind: c.kind, amount: c.amount, accountId: (c.account as LedgerAccount).id })), receiptLines: chosen } : null
  const key = useMemo(() => crypto.randomUUID(), [JSON.stringify(body)]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Drawer title="New landed-cost voucher" onClose={onClose} width={720}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Adds freight, duty and similar costs to the cost of goods already received. Each charge must already be booked to an expense account (for example from a supplier bill); the voucher moves it into the stock value, so the stock cost rises and the expense falls.</p>
        <div className="grid grid-cols-2 gap-4"><TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <SelectField label="Goods receipt" value={receiptId} onChange={(e) => { setReceiptId(e.target.value); setChosen([]) }} options={[{ value: '', label: 'Choose…' }, ...receipts.rows.map((r) => ({ value: r.id, label: `${r.grnNo} · ${formatDate(r.receiptDate)}` }))]} />
          <SelectField label="Share the charges by" value={basis} onChange={(e) => setBasis(e.target.value)} options={[{ value: 'value', label: 'Value of the goods' }, { value: 'quantity', label: 'Quantity' }]} /></div>
        {receipt.data ? (
          <div role="group" aria-label="Receipt lines" className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">Goods the charges relate to</span>
            {receipt.data.lines.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Line ${items.data?.get(l.itemId)?.code ?? l.lineNo}`} checked={chosen.includes(l.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id))} />{items.data?.get(l.itemId)?.code ?? ''} · {showQty(l.quantity)} received</label>)}</div>) : null}
        <h3 className="text-sm font-semibold">Charges</h3>
        {charges.map((c) => (
          <div key={c.key} className="grid items-end gap-2" style={{ gridTemplateColumns: '150px 120px 1fr 32px' }}>
            <SelectField label="Kind" value={c.kind} onChange={(e) => setCharges(charges.map((x) => (x.key === c.key ? { ...x, kind: e.target.value } : x)))} options={KINDS.map(([value, label]) => ({ value, label }))} />
            <TextField label="Amount" inputMode="decimal" value={c.amount} onChange={(e) => setCharges(charges.map((x) => (x.key === c.key ? { ...x, amount: e.target.value } : x)))} />
            <AccountPicker label="Booked to (expense account)" value={c.account} filter={(a) => a.type === 'expense'} onPick={(a) => setCharges(charges.map((x) => (x.key === c.key ? { ...x, account: a } : x)))} />
            <button type="button" aria-label="Remove charge" className="mb-1 grid size-7 place-items-center rounded text-muted hover:text-bad" onClick={() => charges.length > 1 && setCharges(charges.filter((x) => x.key !== c.key))}><Trash2 className="size-4" /></button>
          </div>))}
        <Button variant="ghost" className="self-start" onClick={() => setCharges([...charges, newCharge()])}>+ Add charge</Button>
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={create.isPending} disabled={!body} onClick={async () => { if (!body) return; setProblem(null); try { const v = await create.mutateAsync({ body, key }); flash.show(`${v.voucherNo} posted: ${formatInr(v.totalAmount)} added to stock cost.`); onClose() } catch (e) { setProblem(msg(e, 'Could not post the voucher.')) } }}>Post voucher</Button>
      </div>
    </Drawer>
  )
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useLandedCost(id)
  const v = q.data
  const items = useItemsById(v?.lines.map((l) => l.itemId) ?? [])
  const cancel = useCancelLandedCost(id)
  const canCancel = can(useSession((s) => s.me?.permissions ?? []), 'purchasing:cancel')
  const flash = useFlash()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Drawer title={v?.voucherNo ?? 'Landed cost'} onClose={onClose} width={640}>
      {q.isPending ? <Spinner /> : !v ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{formatDate(v.voucherDate)} · {v.description} · shared by {v.basis === 'value' ? 'value' : 'quantity'} · {v.status === 'posted' ? 'Posted' : `Cancelled: ${v.cancelReason ?? ''}`}</p>
          <table className="w-full text-sm" aria-label="Charges"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Charge</th><th className="py-1 text-right">Amount</th></tr></thead><tbody>{v.charges.map((c) => <tr key={c.id} className="border-t border-line/60"><td className="py-1.5">{KINDS.find(([k]) => k === c.kind)?.[1] ?? c.kind}</td><td className="num py-1.5 text-right">{formatInr(c.amount, { symbol: false })}</td></tr>)}</tbody></table>
          <table className="w-full text-sm" aria-label="Allocation"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Goods</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Share</th><th className="py-1 text-right">Added to stock</th><th className="py-1 text-right">Expensed</th></tr></thead>
            <tbody>{v.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(l.itemId)?.code ?? ''}</td><td className="num py-1.5 text-right">{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.allocated, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(l.capitalised, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(l.expensed, { symbol: false })}</td></tr>)}</tbody></table>
          <p className="text-xs text-muted">Where some of the goods have already been sold, that part of the charge cannot go into stock and is expensed instead.</p>
          {problem ? <Alert>{problem}</Alert> : null}
          {v.status === 'posted' && canCancel ? <div className="flex items-end gap-3"><div className="flex-1"><TextField label="Reason to cancel" value={reason} onChange={(e) => setReason(e.target.value)} /></div><Button variant="secondary" disabled={!reason.trim()} onClick={async () => { setProblem(null); try { await cancel.mutateAsync({ cancelDate: todayIso(), reason: reason.trim() }); flash.show(`${v.voucherNo} cancelled.`); onClose() } catch (e) { setProblem(msg(e, 'Could not cancel.')) } }}>Cancel voucher</Button></div> : null}
        </div>)}
    </Drawer>
  )
}

export function LandedCostPage() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'purchasing:post')
  const list = useLandedCosts(ws.company?.id)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = useMemo<ColumnDef<LandedCostHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'voucherNo', size: 150 }, { header: 'Date', accessorFn: (v) => formatDate(v.voucherDate), size: 100 }, { header: 'Description', accessorKey: 'description', size: 320 },
    { header: 'Amount', accessorFn: (v) => formatInr(v.totalAmount), size: 130, meta: { align: 'right' } }, { header: 'Status', accessorFn: (v) => (v.status === 'posted' ? 'Posted' : 'Cancelled'), size: 90 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Landed costs</h1>{canPost ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New voucher</Button> : null}</div>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(v) => v.id} onOpen={(v) => setOpen(v.id)} empty="No landed-cost vouchers yet." height={480} />}
      {open ? <Detail id={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <NewVoucher onClose={() => setAdding(false)} /> : null}
    </div>
  )
}

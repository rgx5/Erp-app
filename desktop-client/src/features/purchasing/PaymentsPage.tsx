import { useSearch } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Party, SupplierPayment } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { compare, fromUnits, isValid, sub, sum, toUnits } from '@/domain/money'
import { ApprovalNeeded } from '@/features/approvals/ApprovalNeeded'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useParty, usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { useCashAccounts } from '@/features/sales/queries'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField } from '@/ui/primitives'
import { usePayments, usePostPayment, useSupplierPosition, type PaymentInput } from './queries'

const METHODS = [{ value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cheque', label: 'Cheque' }, { value: 'upi', label: 'UPI' }, { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' }]
const methodLabel = (v: string): string => METHODS.find((m) => m.value === v)?.label ?? v

function PaymentDrawer({ companyId, initialSupplier, onClose }: { companyId: string; initialSupplier: Party | null; onClose: () => void }) {
  const accounts = useCashAccounts(companyId)
  const post = usePostPayment()
  const flash = useFlash()
  const [supplier, setSupplier] = useState<Party | null>(initialSupplier)
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [accountId, setAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const position = useSupplierPosition(companyId, supplier?.id, date)
  const cash = accounts.data ?? []
  const paidFrom = accountId || (cash.find((a) => (method === 'cash' ? a.code === '1110' : a.code === '1120')) ?? cash[0])?.id || ''
  const allocated = sum(Object.values(alloc).filter((v) => isValid(v) && v !== ''))
  const amountOk = isValid(amount) && compare(amount, '0') > 0
  const over = amountOk && compare(allocated, amount) > 0
  const advance = amountOk && !over ? sub(amount, allocated) : null
  const body: PaymentInput | null = supplier && amountOk && !over && paidFrom ? {
    companyId, supplierId: supplier.id, paymentDate: date, amount, method: method as 'cash', paidFromAccountId: paidFrom, ...(reference.trim() ? { reference: reference.trim() } : {}),
    ...(Object.entries(alloc).some(([, v]) => isValid(v) && compare(v, '0') > 0) ? { allocations: Object.entries(alloc).filter(([, v]) => isValid(v) && compare(v, '0') > 0).map(([billId, v]) => ({ billId, amount: v })) } : {}),
  } : null
  const key = useMemo(() => crypto.randomUUID(), [JSON.stringify(body)]) // eslint-disable-line react-hooks/exhaustive-deps

  function autoAllocate() {
    let left = amountOk ? toUnits(amount) : 0n
    const next: Record<string, string> = {}
    for (const b of [...(position.data?.openBills ?? [])].sort((a, c) => (a.dueDate ?? a.date).localeCompare(c.dueDate ?? c.date))) {
      if (left <= 0n) break
      const take = toUnits(b.outstanding) < left ? toUnits(b.outstanding) : left
      next[b.id] = fromUnits(take)
      left -= take
    }
    setAlloc(next)
  }
  async function submit() {
    if (!body) return
    setError(null)
    try { const p = await post.mutateAsync({ body, key }); flash.show(`${p.paymentNo} recorded for ${formatInr(p.amount)}${p.unallocated && Number(p.unallocated) > 0 ? `; ${formatInr(p.unallocated)} is held as an advance to the supplier` : ''}.`); onClose() } catch (e) { setError(e) }
  }
  const message = error instanceof ApiError && error.code !== 'approval_required' ? `${error.message}${error.requestId ? ` (reference ${error.requestId})` : ''}` : null
  return (
    <Drawer title="Record a payment" onClose={onClose} width={640}>
      <div className="flex flex-col gap-4">
        <PartyPicker label="Supplier" role="supplier" value={supplier} onPick={(p) => { setSupplier(p); setAlloc({}) }} autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Amount paid" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <SelectField label="Method" value={method} onChange={(e) => { setMethod(e.target.value); setAccountId('') }} options={METHODS} />
          <SelectField label="Paid from" value={paidFrom} onChange={(e) => setAccountId(e.target.value)} options={cash.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        </div>
        <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} hint="Cheque number, UTR" />
        {supplier ? (
          <section aria-label="Settle bills" className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Settle bills</h3><Button variant="secondary" onClick={autoAllocate} disabled={!amountOk || !position.data}>Earliest due first</Button></div>
            {position.isPending ? <Spinner /> : position.error ? <Alert>{position.error.message}</Alert> : (position.data?.openBills ?? []).length === 0 ? <p className="text-sm text-muted">Nothing is owed to this supplier; the money will be held as an advance.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-1">Bill</th><th className="py-1">Due</th><th className="num py-1 text-right">Outstanding</th><th className="py-1 pl-3">Settle</th></tr></thead>
                <tbody>
                  {position.data?.openBills.map((b) => (
                    <tr key={b.id} className="border-t border-line/60"><td className="py-1.5">{b.number}{b.supplierInvoiceNo ? <span className="ml-1 text-xs text-muted">({b.supplierInvoiceNo})</span> : null}</td><td className="py-1.5">{b.dueDate ? formatDate(b.dueDate) : ''}</td><td className="num py-1.5 text-right">{formatInr(b.outstanding, { symbol: false })}</td>
                      <td className="py-1.5 pl-3"><input aria-label={`Settle ${b.number}`} inputMode="decimal" className="h-8 w-28 rounded border border-line bg-surface px-2 text-right text-sm" value={alloc[b.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })} /></td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {amountOk ? <p className={`text-sm ${over ? 'text-bad' : 'text-muted'}`}>Settling {formatInr(allocated)} of {formatInr(amount)}{advance && compare(advance, '0') > 0 ? ` · ${formatInr(advance)} will be held as an advance` : ''}</p> : null}
          </section>
        ) : null}
        <ApprovalNeeded error={error} request={body ? { companyId, documentType: 'payment', payload: body as unknown as Record<string, unknown> } : null} />
        {message ? <Alert>{message}</Alert> : null}
        <Button busy={post.isPending} disabled={!body} onClick={() => void submit()}>Record payment</Button>
      </div>
    </Drawer>
  )
}

export function PaymentsPage() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'payables:post')
  const search = useSearch({ strict: false }) as { supplierId?: string }
  const list = usePayments(ws.company?.id)
  const names = usePartiesById(list.rows.map((p) => p.supplierId))
  const prefill = useParty(search.supplierId)
  const [open, setOpen] = useState(false)
  const showing = open || (Boolean(search.supplierId) && !prefill.isPending)
  const columns = useMemo<ColumnDef<SupplierPayment, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'paymentNo', size: 160 }, { header: 'Date', accessorFn: (p) => formatDate(p.paymentDate), size: 100 },
    { header: 'Supplier', accessorFn: (p) => names.data?.get(p.supplierId)?.legalName ?? '…', size: 260 }, { header: 'Method', accessorFn: (p) => methodLabel(p.method), size: 120 },
    { header: 'Reference', accessorFn: (p) => p.reference ?? '', size: 140 }, { header: 'Amount', accessorFn: (p) => formatInr(p.amount), size: 130, meta: { align: 'right' } }, { header: 'Status', accessorKey: 'status', size: 90 },
  ], [names.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Payments to suppliers</h1>{canPost ? <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /> New payment</Button> : null}</div>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(p) => p.id} empty="No payments yet." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {showing ? <PaymentDrawer companyId={ws.company.id} initialSupplier={prefill.data ?? null} onClose={() => { setOpen(false); if (search.supplierId) history.replaceState(null, '', location.pathname + location.hash.split('?')[0]) }} /> : null}
    </div>
  )
}

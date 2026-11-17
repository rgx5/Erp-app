import { useSearch } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Party, Receipt } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { compare, fromUnits, isValid, sub, sum, toUnits } from '@/domain/money'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useParty, usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useCashAccounts, usePosition, usePostReceipt, useReceipts } from './queries'

const METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'cheque', label: 'Cheque' }, { value: 'other', label: 'Other' }]
const methodLabel = (v: string): string => METHODS.find((m) => m.value === v)?.label ?? v

function ReceiptDrawer({ companyId, initialCustomer, onClose }: { companyId: string; initialCustomer: Party | null; onClose: () => void }) {
  const accounts = useCashAccounts(companyId)
  const post = usePostReceipt()
  const flash = useFlash()
  const [customer, setCustomer] = useState<Party | null>(initialCustomer)
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [accountId, setAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const position = usePosition(companyId, customer?.id, date)
  const key = useMemo(() => crypto.randomUUID(), [customer?.id, date, amount, method, accountId, reference, alloc]) // eslint-disable-line react-hooks/exhaustive-deps

  const cash = accounts.data ?? []
  const deposit = accountId || (cash.find((a) => (method === 'cash' ? a.code === '1110' : a.code === '1120')) ?? cash[0])?.id || ''
  const allocated = sum(Object.values(alloc).filter((v) => isValid(v) && v !== ''))
  const amountOk = isValid(amount) && compare(amount, '0') > 0
  const over = amountOk && compare(allocated, amount) > 0
  const advance = amountOk && !over ? sub(amount, allocated) : null

  function autoAllocate() {
    let left = amountOk ? toUnits(amount) : 0n
    const next: Record<string, string> = {}
    for (const i of [...(position.data?.openInvoices ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
      if (left <= 0n) break
      const take = toUnits(i.outstanding) < left ? toUnits(i.outstanding) : left
      next[i.id] = fromUnits(take)
      left -= take
    }
    setAlloc(next)
  }

  async function submit() {
    setProblem(null)
    if (!customer) { setProblem('Choose the customer.'); return }
    if (!amountOk) { setProblem('Enter the amount received.'); return }
    if (over) { setProblem('More is allocated to invoices than was received.'); return }
    const allocations = Object.entries(alloc).filter(([, v]) => isValid(v) && compare(v, '0') > 0).map(([invoiceId, v]) => ({ invoiceId, amount: v }))
    try {
      const r = await post.mutateAsync({ key, body: { companyId, customerId: customer.id, receiptDate: date, amount, method: method as 'cash', depositAccountId: deposit, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(allocations.length ? { allocations } : {}) } })
      flash.show(`${r.receiptNo} recorded for ${formatInr(r.amount)}${r.unallocated && Number(r.unallocated) > 0 ? `; ${formatInr(r.unallocated)} is held as an advance` : ''}.`)
      onClose()
    } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not record the receipt.') }
  }

  return (
    <Drawer title="Record a receipt" onClose={onClose} width={640}>
      <div className="flex flex-col gap-4">
        <PartyPicker role="customer" value={customer} onPick={(p) => { setCustomer(p); setAlloc({}) }} autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Amount received" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <SelectField label="Method" value={method} onChange={(e) => { setMethod(e.target.value); setAccountId('') }} options={METHODS} />
          <SelectField label="Banked into" value={deposit} onChange={(e) => setAccountId(e.target.value)} options={cash.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        </div>
        <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} hint="Cheque number, UTR, UPI reference" />
        {customer ? (
          <section aria-label="Settle invoices" className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Settle invoices</h3><Button variant="secondary" onClick={autoAllocate} disabled={!amountOk || !position.data}>Oldest first</Button></div>
            {position.isPending ? <Spinner /> : position.error ? <Alert>{position.error.message}</Alert> : (position.data?.openInvoices ?? []).length === 0 ? <p className="text-sm text-muted">Nothing is outstanding for this customer; the money will be held as an advance.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-1">Invoice</th><th className="py-1">Date</th><th className="num py-1 text-right">Outstanding</th><th className="py-1 pl-3">Settle</th></tr></thead>
                <tbody>
                  {position.data?.openInvoices.map((i) => (
                    <tr key={i.id} className="border-t border-line/60">
                      <td className="py-1.5">{i.number}</td><td className="py-1.5">{formatDate(i.date)}</td><td className="num py-1.5 text-right">{formatInr(i.outstanding, { symbol: false })}</td>
                      <td className="py-1.5 pl-3"><input aria-label={`Settle ${i.number}`} inputMode="decimal" className="h-8 w-28 rounded border border-line bg-surface px-2 text-right text-sm" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {amountOk ? <p className={`text-sm ${over ? 'text-bad' : 'text-muted'}`}>Settling {formatInr(allocated)} of {formatInr(amount)}{advance && compare(advance, '0') > 0 ? ` · ${formatInr(advance)} will be held as an advance` : ''}</p> : null}
          </section>
        ) : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={post.isPending} onClick={() => void submit()}>Record receipt</Button>
      </div>
    </Drawer>
  )
}

export function ReceiptsPage() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'receivables:post')
  const search = useSearch({ strict: false }) as { customerId?: string }
  const list = useReceipts(ws.company?.id)
  const rows = list.data ?? []
  const names = usePartiesById(rows.map((r) => r.customerId))
  const prefill = useParty(search.customerId)
  const [open, setOpen] = useState(false)
  const showing = open || (Boolean(search.customerId) && !prefill.isPending)
  const columns = useMemo<ColumnDef<Receipt, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'receiptNo', size: 160 },
    { header: 'Date', accessorFn: (r) => formatDate(r.receiptDate), size: 100 },
    { header: 'Customer', accessorFn: (r) => names.data?.get(r.customerId)?.legalName ?? '…', size: 260 },
    { header: 'Method', accessorFn: (r) => methodLabel(r.method), size: 120 },
    { header: 'Reference', accessorFn: (r) => r.reference ?? '', size: 140 },
    { header: 'Amount', accessorFn: (r) => formatInr(r.amount), size: 130, meta: { align: 'right' } },
    { header: 'Status', accessorKey: 'status', size: 90 },
  ], [names.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Receipts</h1>{canPost ? <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /> New receipt</Button> : null}</div>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="No receipts yet." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {showing ? <ReceiptDrawer companyId={ws.company.id} initialCustomer={prefill.data ?? null} onClose={() => { setOpen(false); if (search.customerId) history.replaceState(null, '', location.pathname + location.hash.split('?')[0]) }} /> : null}
    </div>
  )
}

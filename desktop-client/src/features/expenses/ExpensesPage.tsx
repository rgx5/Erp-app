import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { ExpenseCategory, ExpenseVoucher, LedgerAccount } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { useAccounts } from '@/features/accounting/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useCancelExpense, useCreateExpense, useCreateExpenseCategory, useExpenseCategories, useExpenses, useUpdateExpenseCategory } from './queries'

const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)

function NewVoucher({ companyId, categories, onClose }: { companyId: string; categories: ExpenseCategory[]; onClose: () => void }) {
  const create = useCreateExpense()
  const flash = useFlash()
  const [from, setFrom] = useState<LedgerAccount | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const active = categories.filter((c) => c.status === 'active')
  const schema = z.object({ voucherDate: z.string().min(1), categoryId: z.string().min(1, 'Choose what it was for'), amount: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount such as 250').refine((v) => Number(v) > 0, 'Must be above zero'), payee: z.string().trim().max(150), note: z.string().trim().max(300) })
  return (
    <Drawer title="New expense" onClose={onClose}>
      <SimpleForm schema={schema} defaults={{ voucherDate: todayIso(), categoryId: active[0]?.id ?? '', amount: '', payee: '', note: '' }} fields={['voucherDate', 'categoryId', 'amount', 'payee', 'note']} label="Save expense"
        submit={async (v) => { setProblem(null); if (!from) { setProblem('Choose the cash or bank account it was paid from.'); return } try { const r = await create.mutateAsync({ key: crypto.randomUUID(), body: { companyId, voucherDate: v.voucherDate, categoryId: v.categoryId, amount: v.amount, paidFromAccountId: from.id, ...(v.payee ? { payee: v.payee } : {}), ...(v.note ? { note: v.note } : {}) } }); flash.show(`${r.voucherNo} saved.`); onClose() } catch (e) { setProblem(msg(e, 'Could not save the expense.')) } }}>
        {({ register, errors }) => (<>
          <TextField label="Date" type="date" {...register('voucherDate')} />
          <SelectField label="What was it for" error={errors.categoryId?.message as string | undefined} options={active.length ? active.map((c) => ({ value: c.id, label: c.name })) : [{ value: '', label: 'Add a category first' }]} {...register('categoryId')} />
          <TextField label="Amount" inputMode="decimal" error={errors.amount?.message as string | undefined} {...register('amount')} />
          <AccountPicker label="Paid from (cash or bank)" value={from} filter={(a) => a.type === 'asset'} onPick={setFrom} />
          <TextField label="Paid to (optional)" {...register('payee')} /><TextField label="Note (optional)" {...register('note')} />
          {problem ? <Alert>{problem}</Alert> : null}
        </>)}
      </SimpleForm>
    </Drawer>
  )
}

function Detail({ v, categories, onClose }: { v: ExpenseVoucher; categories: ExpenseCategory[]; onClose: () => void }) {
  const canCancel = can(useSession((s) => s.me?.permissions ?? []), 'expenses:cancel')
  const cancel = useCancelExpense(v.id)
  const flash = useFlash()
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Drawer title={v.voucherNo} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-2 text-sm" aria-label="Expense"><dt className="text-muted">Date</dt><dd>{formatDate(v.voucherDate)}</dd><dt className="text-muted">For</dt><dd>{categories.find((c) => c.id === v.categoryId)?.name ?? ''}</dd><dt className="text-muted">Amount</dt><dd className="num">{formatInr(v.amount)}</dd><dt className="text-muted">Paid to</dt><dd>{v.payee ?? ''}</dd><dt className="text-muted">Note</dt><dd>{v.note ?? ''}</dd><dt className="text-muted">Status</dt><dd>{v.status === 'posted' ? 'Posted' : `Cancelled: ${v.cancelReason ?? ''}`}</dd></dl>
        {problem ? <Alert>{problem}</Alert> : null}
        {v.status === 'posted' && canCancel ? <div className="flex items-end gap-3"><div className="flex-1"><TextField label="Reason to cancel" value={reason} onChange={(e) => setReason(e.target.value)} /></div><Button variant="secondary" disabled={!reason.trim()} onClick={async () => { setProblem(null); try { await cancel.mutateAsync({ date: todayIso() > v.voucherDate ? todayIso() : v.voucherDate, reason: reason.trim() }); flash.show(`${v.voucherNo} cancelled.`); onClose() } catch (e) { setProblem(msg(e, 'Could not cancel.')) } }}>Cancel expense</Button></div> : null}
      </div>
    </Drawer>
  )
}

function Categories({ companyId }: { companyId: string }) {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'expenses:manage')
  const list = useExpenseCategories(companyId)
  const accounts = useAccounts(companyId)
  const create = useCreateExpenseCategory(); const update = useUpdateExpenseCategory()
  const flash = useFlash()
  const [account, setAccount] = useState<LedgerAccount | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const schema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,29}$/, 'Letters, digits and . _ / -'), name: z.string().trim().min(1, 'Required').max(100) })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between"><p className="max-w-2xl text-sm text-muted">Each category books to one expense account, so recording an expense only needs &ldquo;what was it for&rdquo;. Which account suits each category is for your accountant to confirm.</p>{canManage ? <Button variant="secondary" onClick={() => { setAccount(null); setProblem(null); setAdding(true) }}>New category</Button> : null}</div>
      {list.isPending ? <Spinner /> : list.data?.length === 0 ? <Alert tone="info">No categories yet.</Alert> : (
        <table className="w-full max-w-3xl text-sm" aria-label="Expense categories"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Name</th><th className="py-1">Code</th><th className="py-1">Account</th><th className="py-1">Status</th><th /></tr></thead>
          <tbody>{list.data?.map((c) => { const a = accounts.data?.find((x) => x.id === c.expenseAccountId); return <tr key={c.id} className="border-t border-line/60"><td className="py-1.5">{c.name}</td><td className="py-1.5 text-muted">{c.code}</td><td className="py-1.5">{a ? `${a.code} · ${a.name}` : ''}</td><td className="py-1.5">{c.status}</td>
            <td className="py-1.5 text-right">{canManage ? <Button variant="ghost" aria-label={`${c.status === 'active' ? 'Switch off' : 'Switch on'} ${c.name}`} onClick={() => void update.mutateAsync({ id: c.id, version: c.version, body: { status: c.status === 'active' ? 'inactive' : 'active' } })}>{c.status === 'active' ? 'Switch off' : 'Switch on'}</Button> : null}</td></tr> })}</tbody></table>)}
      {adding ? (
        <Drawer title="New expense category" onClose={() => setAdding(false)}>
          <SimpleForm schema={schema} defaults={{ code: '', name: '' }} fields={['code', 'name']} label="Create" submit={async (v) => { setProblem(null); if (!account) { setProblem('Choose the expense account it books to.'); return } try { await create.mutateAsync({ key: crypto.randomUUID(), body: { companyId, code: v.code, name: v.name, expenseAccountId: account.id } }); flash.show('Category created.'); setAdding(false) } catch (e) { setProblem(msg(e, 'Could not create the category.')) } }}>
            {({ register, errors }) => (<><TextField label="Code" error={errors.code?.message as string | undefined} {...register('code')} /><TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} /><AccountPicker label="Books to (expense account)" value={account} filter={(a) => a.type === 'expense'} onPick={setAccount} />{problem ? <Alert>{problem}</Alert> : null}</>)}
          </SimpleForm>
        </Drawer>) : null}
    </div>
  )
}

export function ExpensesPage() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'expenses:post')
  const [tab, setTab] = useState<'vouchers' | 'categories'>('vouchers')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const cats = useExpenseCategories(ws.company?.id)
  const list = useExpenses(ws.company?.id, { ...(category ? { categoryId: category } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
  const [open, setOpen] = useState<ExpenseVoucher | null>(null)
  const [adding, setAdding] = useState(false)
  const total = list.rows.filter((r) => r.status === 'posted').reduce((s, r) => s + Number(r.amount), 0)
  const columns = useMemo<ColumnDef<ExpenseVoucher, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'voucherNo', size: 140 }, { header: 'Date', accessorFn: (v) => formatDate(v.voucherDate), size: 100 }, { header: 'For', accessorFn: (v) => cats.data?.find((c) => c.id === v.categoryId)?.name ?? '', size: 180 },
    { header: 'Paid to', accessorFn: (v) => v.payee ?? '', size: 180 }, { header: 'Amount', accessorFn: (v) => formatInr(v.amount), size: 120, meta: { align: 'right' } }, { header: 'Status', accessorFn: (v) => (v.status === 'posted' ? 'Posted' : 'Cancelled'), size: 90 },
  ], [cats.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Expenses</h1>{canPost && tab === 'vouchers' ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New expense</Button> : null}</div>
      <div role="tablist" className="flex gap-1 border-b border-line">{([['vouchers', 'Expenses'], ['categories', 'Categories']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'categories' ? <Categories companyId={ws.company.id} /> : (<>
        <Toolbar><div className="w-52"><SelectField label="For" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: 'Everything' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></div><div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div><p className="self-end pb-2 text-sm text-muted" aria-label="Total spent">Total {formatInr(String(total))}</p></Toolbar>
        {list.error ? <Alert>{list.error.message}</Alert> : null}
        {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(v) => v.id} onOpen={setOpen} empty="No expenses yet." height={520} />}
        {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}</>)}
      {adding ? <NewVoucher companyId={ws.company.id} categories={cats.data ?? []} onClose={() => setAdding(false)} /> : null}
      {open ? <Detail v={open} categories={cats.data ?? []} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

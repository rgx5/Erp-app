import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { send } from '@/api/send'
import type { Party } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useWorkspace } from '@/features/organization/workspace'
import { useCashAccounts } from '@/features/sales/queries'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, FormActions, SelectField, Spinner, Tag, TextField, Toolbar } from '@/ui/primitives'

type Dir = 'received' | 'issued'
interface Cheque { id: string; direction: Dir; partyId: string; partyName: string; chequeNo: string; chequeDate: string; bankName: string | null; amount: string; status: string; accountId: string | null; depositedOn: string | null; clearedOn: string | null; bouncedOn: string | null; bounceReason: string | null }
const TONE: Record<string, 'neutral' | 'info' | 'good' | 'bad' | 'warn'> = { pending: 'warn', deposited: 'info', clearing: 'info', cleared: 'good', bounced: 'bad', cancelled: 'neutral' }
const WORDS: Record<Dir, { title: string; party: string; deposit: string; clear: string; sub: string; role: 'customer' | 'supplier' }> = {
  received: { title: 'Cheques received', party: 'Customer', deposit: 'Deposit', clear: 'Mark cleared', sub: 'Cheques customers have given you. Money enters your books only when the cheque clears.', role: 'customer' },
  issued: { title: 'Cheques issued', party: 'Supplier', deposit: 'Mark issued', clear: 'Mark cleared', sub: 'Cheques you have written to suppliers. The payment is booked when the cheque clears.', role: 'supplier' },
}

const useCheques = (dir: Dir, companyId: string | undefined, status: string, dueBy: string) =>
  useQuery({ queryKey: ['cheques', dir, companyId, status, dueBy], enabled: Boolean(companyId), queryFn: async () => (await send<{ items: Cheque[] }>('GET', `/v1/cheques/${dir}`, { query: { companyId, status: status || undefined, dueBy: dueBy || undefined } })).items })
function useChequeAction(dir: Dir) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (a: { id?: string; verb?: string; body: unknown }) => send('POST', a.id ? `/v1/cheques/${dir}/${a.id}/${a.verb}` : `/v1/cheques/${dir}`, { body: a.body }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cheques'] }); void qc.invalidateQueries({ queryKey: ['position'] }) } })
}

function NewCheque({ dir, companyId, onClose }: { dir: Dir; companyId: string; onClose: () => void }) {
  const w = WORDS[dir]; const act = useChequeAction(dir)
  const [party, setParty] = useState<Party | null>(null)
  const [no, setNo] = useState(''); const [date, setDate] = useState(todayIso()); const [bank, setBank] = useState(''); const [amount, setAmount] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  async function save() {
    if (!party) return
    setProblem(null)
    try { await act.mutateAsync({ body: { companyId, partyId: party.id, chequeNo: no.trim(), chequeDate: date, amount: amount.trim(), ...(bank.trim() ? { bankName: bank.trim() } : {}) } }); onClose() }
    catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not save the cheque.') }
  }
  return (
    <Drawer title={dir === 'received' ? 'Record a cheque received' : 'Record a cheque issued'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <PartyPicker label={w.party} role={w.role} value={party} onPick={setParty} autoFocus />
        <div className="grid grid-cols-2 gap-4"><TextField label="Cheque number" value={no} onChange={(e) => setNo(e.target.value)} /><TextField label="Cheque date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-4"><TextField label="Bank (optional)" value={bank} onChange={(e) => setBank(e.target.value)} /><TextField label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button disabled={!party || !no.trim() || !/^\d{1,14}(\.\d{1,4})?$/.test(amount.trim())} busy={act.isPending} onClick={() => void save()}>Save cheque</Button></FormActions>
      </div>
    </Drawer>
  )
}

function Step({ dir, cheque, verb, companyId, onClose }: { dir: Dir; cheque: Cheque; verb: 'deposit' | 'clear' | 'bounce' | 'cancel'; companyId: string; onClose: () => void }) {
  const act = useChequeAction(dir); const accounts = useCashAccounts(companyId)
  const [date, setDate] = useState(todayIso()); const [accountId, setAccountId] = useState(cheque.accountId ?? ''); const [reason, setReason] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  const needsAccount = verb === 'deposit' || (verb === 'clear' && !cheque.accountId)
  const title = { deposit: WORDS[dir].deposit, clear: WORDS[dir].clear, bounce: 'Mark as bounced', cancel: 'Cancel this cheque' }[verb]
  async function go() {
    setProblem(null)
    try { await act.mutateAsync({ id: cheque.id, verb, body: verb === 'cancel' ? { reason } : verb === 'bounce' ? { date, reason } : { date, ...(accountId ? { accountId } : {}) } }); onClose() }
    catch (e) { setProblem(e instanceof ApiError ? e.message : 'That did not work.') }
  }
  const ready = verb === 'cancel' ? reason.trim() !== '' : verb === 'bounce' ? reason.trim() !== '' && date !== '' : date !== '' && (!needsAccount || accountId !== '')
  return (
    <Drawer title={title} subtitle={`${cheque.partyName} · cheque ${cheque.chequeNo} · ${formatInr(cheque.amount)}`} onClose={onClose} width={440}>
      <div className="flex flex-col gap-4">
        {verb === 'clear' ? <p className="text-sm text-muted">This books the {dir === 'received' ? 'receipt' : 'payment'} in your accounts{dir === 'received' ? ' and settles the invoices you chose when recording the cheque' : ''}.</p> : null}
        {verb === 'bounce' && cheque.status === 'cleared' ? <Alert tone="info">It has already cleared, so the {dir === 'received' ? 'receipt' : 'payment'} made for it will be cancelled and the amount owed comes back.</Alert> : null}
        {verb !== 'cancel' ? <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /> : null}
        {needsAccount ? <SelectField label={dir === 'received' ? 'Bank account it goes into' : 'Bank account it is drawn on'} value={accountId} onChange={(e) => setAccountId(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]} /> : null}
        {verb === 'bounce' || verb === 'cancel' ? <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button variant={verb === 'bounce' || verb === 'cancel' ? 'danger' : 'primary'} disabled={!ready} busy={act.isPending} onClick={() => void go()}>{title}</Button></FormActions>
      </div>
    </Drawer>
  )
}

/** The cheque register: held, deposited, cleared or bounced, with the next step for each. */
export function ChequesPage({ dir }: { dir: Dir }) {
  const w = WORDS[dir]; const ws = useWorkspace(); const companyId = ws.company?.id
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'cheques:post')
  const [status, setStatus] = useState('open'); const [dueBy, setDueBy] = useState('')
  const [adding, setAdding] = useState(false); const [step, setStep] = useState<{ cheque: Cheque; verb: 'deposit' | 'clear' | 'bounce' | 'cancel' } | null>(null)
  const list = useCheques(dir, companyId, status, dueBy)
  const today = todayIso()
  const rows = useMemo(() => list.data ?? [], [list.data])
  const columns = useMemo<ColumnDef<Cheque, unknown>[]>(() => [
            { id: 'cheque-date', header: 'Cheque date', accessorFn: (c) => formatDate(c.chequeDate), size: 110 }, { id: 'number', header: 'Number', accessorKey: 'chequeNo', size: 100 }, { id: 'party', header: w.party, accessorKey: 'partyName', size: 220 }, { id: 'bank', header: 'Bank', accessorFn: (c) => c.bankName ?? '', size: 140 },
            { id: 'amount', header: 'Amount', accessorFn: (c) => formatInr(c.amount), size: 120, meta: { align: 'right' } },
            { id: 'status', header: 'State', size: 130, cell: ({ row }) => { const c = row.original; return <Tag tone={c.status === 'pending' && c.chequeDate.slice(0, 10) <= today ? 'bad' : (TONE[c.status] ?? 'neutral')}>{c.status === 'pending' && c.chequeDate.slice(0, 10) <= today ? 'Due' : c.status === 'pending' ? (dir === 'received' ? 'In hand' : 'To issue') : c.status === 'deposited' ? (dir === 'received' ? 'Deposited' : 'Issued') : c.status[0]?.toUpperCase() + c.status.slice(1)}</Tag> } },
            { id: 'actions', header: '', size: 300, cell: ({ row }) => { const c = row.original; if (!canPost) return null; const open = c.status === 'pending' || c.status === 'deposited'
              return <div className="flex justify-end gap-1">{c.status === 'pending' ? <Button variant="secondary" onClick={() => setStep({ cheque: c, verb: 'deposit' })}>{w.deposit}</Button> : null}{open ? <Button variant="secondary" onClick={() => setStep({ cheque: c, verb: 'clear' })}>{w.clear}</Button> : null}{open || c.status === 'cleared' ? <Button variant="ghost" onClick={() => setStep({ cheque: c, verb: 'bounce' })}>Bounced</Button> : null}{open ? <Button variant="ghost" onClick={() => setStep({ cheque: c, verb: 'cancel' })}>Cancel</Button> : null}</div> } },
          ], [canPost, dir, today, w])
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><div><h1 className="page-title">{w.title}</h1><p className="page-sub">{w.sub}</p></div>{canPost ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Record a cheque</Button> : null}</div>
      <Toolbar>
        <div className="w-48"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'open', label: 'Not yet cleared' }, { value: '', label: 'All' }, { value: 'cleared', label: 'Cleared' }, { value: 'bounced', label: 'Bounced' }, { value: 'cancelled', label: 'Cancelled' }]} /></div>
        <div className="w-44"><TextField label="Dated up to" type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} /></div>
      </Toolbar>
      {list.isPending ? <Spinner /> : (
        <DataTable<Cheque> rows={rows} rowKey={(c) => c.id} empty="No cheques here." columns={columns} />)}
      {adding && companyId ? <NewCheque dir={dir} companyId={companyId} onClose={() => setAdding(false)} /> : null}
      {step && companyId ? <Step dir={dir} cheque={step.cheque} verb={step.verb} companyId={companyId} onClose={() => setStep(null)} /> : null}
    </div>
  )
}

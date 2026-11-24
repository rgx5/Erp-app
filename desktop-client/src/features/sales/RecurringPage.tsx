import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr } from '@/domain/format'
import { usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Spinner } from '@/ui/primitives'
import { FREQUENCIES, runDueRecurring, useRecurringAction, useRecurringDetail, useRecurringList, type Recurring } from './recurringQueries'

const STATUS: Record<string, string> = { active: 'Running', paused: 'Paused', ended: 'Ended' }
const every = (f: string): string => FREQUENCIES.find((x) => x.value === f)?.label ?? f

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useRecurringDetail(id); const act = useRecurringAction(); const flash = useFlash()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'sales:post')
  const r = q.data
  const [problem, setProblem] = useState<string | null>(null)
  const go = async (action: 'pause' | 'resume' | 'end') => { setProblem(null); try { await act.mutateAsync({ id, action }); flash.show(action === 'pause' ? 'Paused.' : action === 'resume' ? 'Running again.' : 'Ended.') } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not change it.') } }
  return (
    <Drawer title={r?.name ?? 'Recurring invoice'} onClose={onClose} width={640}>
      {q.isPending || !r ? <Spinner /> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{every(r.frequency)} · next {r.status === 'ended' ? '—' : formatDate(r.nextRunDate)} · {r.runCount} invoice{r.runCount === 1 ? '' : 's'} so far{r.endDate ? ` · stops after ${formatDate(r.endDate)}` : ''} · {STATUS[r.status] ?? r.status}</p>
          {r.lastError ? <Alert>The last attempt failed: {r.lastError} It will be tried again.</Alert> : null}
          {problem ? <Alert>{problem}</Alert> : null}
          {canPost && r.status !== 'ended' ? <div className="flex gap-2">{r.status === 'active' ? <Button variant="secondary" onClick={() => void go('pause')}>Pause</Button> : <Button variant="secondary" onClick={() => void go('resume')}>Resume</Button>}<Button variant="ghost" onClick={() => void go('end')}>End this schedule</Button></div> : null}
          <h3 className="text-sm font-semibold">History</h3>
          <table className="w-full text-sm" aria-label="History"><thead className="text-left text-xs text-muted"><tr><th className="py-1">Due</th><th>Result</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{r.runs.length === 0 ? <tr><td colSpan={3} className="py-4 text-center text-muted">Nothing raised yet.</td></tr> : r.runs.map((x) => <tr key={x.id} className="border-t border-line/60"><td className="py-1.5">{formatDate(x.scheduledDate)}</td><td>{x.status === 'posted' ? x.invoiceNo : <span className="text-bad">Failed: {x.error}</span>}</td><td className="text-right">{x.total ? formatInr(x.total) : ''}</td></tr>)}</tbody></table>
        </div>)}
    </Drawer>
  )
}

/** Schedules that raise the same invoice again and again (rent, subscriptions, annual maintenance). Due ones are posted when the app opens or on "Raise due invoices now". */
export function RecurringPage() {
  const ws = useWorkspace(); const navigate = useNavigate(); const flash = useFlash()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'sales:post')
  const list = useRecurringList(ws.company?.id)
  const customers = usePartiesById((list.data ?? []).map((r) => r.customerId))
  const [open, setOpen] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<Recurring, unknown>[]>(() => [
    { header: 'Name', accessorKey: 'name', size: 200 }, { header: 'Customer', accessorFn: (r) => customers.data?.get(r.customerId)?.legalName ?? '', size: 220 }, { header: 'Repeats', accessorFn: (r) => every(r.frequency), size: 130 },
    { header: 'Next invoice', accessorFn: (r) => (r.status === 'ended' ? '' : formatDate(r.nextRunDate)), size: 120 }, { header: 'Raised', accessorFn: (r) => String(r.runCount), size: 80, meta: { align: 'right' } },
    { header: 'Status', accessorFn: (r) => (r.lastError && r.status === 'active' ? 'Needs attention' : STATUS[r.status] ?? r.status), size: 130 },
  ], [customers.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const company = ws.company
  async function runNow() {
    setBusy(true); setProblem(null)
    try { const r = await runDueRecurring(company.id); await list.refetch(); flash.show(r.generated.length ? `${r.generated.length} invoice${r.generated.length === 1 ? '' : 's'} raised.` : 'Nothing is due.'); if (r.failed.length) setProblem(`${r.failed.length} could not be raised: ${r.failed.map((f) => `${f.name} (${f.error})`).join('; ')}`) }
    catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not raise the invoices.') } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Recurring invoices</h1>
        {canPost ? <div className="flex gap-2"><Button variant="secondary" busy={busy} onClick={() => void runNow()}>Raise due invoices now</Button><Button onClick={() => void navigate({ to: '/sales/recurring/new' })}><Plus className="size-4" aria-hidden /> New recurring invoice</Button></div> : null}</div>
      <p className="text-sm text-muted">Invoices that repeat on a schedule. Each one is an ordinary invoice, raised on its due date.</p>
      {problem ? <Alert>{problem}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(r) => r.id} onOpen={(r) => setOpen(r.id)} empty="No recurring invoices yet." height={480} />}
      {open ? <Detail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

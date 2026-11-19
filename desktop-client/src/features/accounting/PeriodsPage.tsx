import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { z } from 'zod'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, Spinner, TextField } from '@/ui/primitives'
import { useCloseYear, useCreateFiscalYear, useFiscalYears, usePeriodAction, useReopenYear, useYearClosings } from './queries'

const STATUS: Record<string, string> = { open: 'Open', closed: 'Closed', locked: 'Locked' }

export function PeriodsPage() {
  const ws = useWorkspace()
  const flash = useFlash()
  const perms = useSession((s) => s.me?.permissions ?? [])
  const years = useFiscalYears(ws.company?.id)
  const closings = useYearClosings(ws.company?.id)
  const act = usePeriodAction()
  const create = useCreateFiscalYear()
  const closeYear = useCloseYear()
  const reopenYear = useReopenYear()
  const [adding, setAdding] = useState(false)
  const [reopening, setReopening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canManage = can(perms, 'accounting:manage')
  const canClose = can(perms, 'accounting:close_year')
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">No company yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  const companyId = ws.company.id
  const closingOf = (yid: string) => closings.data?.find((c) => c.fiscalYearId === yid && c.status === 'closed')

  async function run<T>(fn: () => Promise<T>, done: string): Promise<void> {
    setError(null)
    try { await fn(); flash.show(done) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
  }
  const schema = z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-01$/, 'Must be the 1st of a month'), label: z.string().trim().regex(/^([0-9]{4}(-[0-9]{2})?)?$/, 'e.g. 2026-27') })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Periods and year-end</h1>{canManage ? <Button onClick={() => setAdding(true)}>New financial year</Button> : null}</div>
      <p className="max-w-3xl text-sm text-muted">Postings are only accepted into an <b>open</b> period. A <b>closed</b> period can be reopened; a <b>locked</b> period cannot. Closing the year posts the profit and loss accounts into the retained earnings account and locks nothing by itself.</p>
      {error ? <Alert>{error}</Alert> : null}
      {years.isPending ? <Spinner /> : years.error ? <Alert>{years.error.message}</Alert> : years.data?.length === 0 ? <Alert tone="info">No financial year yet. Create one to start posting.</Alert> : null}
      {years.data?.map((y) => {
        const closing = closingOf(y.id)
        return (
          <Card key={y.id} title={`Financial year ${y.label}`} action={<span className="text-xs text-muted">{formatDate(y.startDate)} – {formatDate(y.endDate)}</span>}>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              {closing ? <><span className="rounded bg-good/10 px-2 py-0.5 text-good">Year closed · profit {formatInr(closing.netProfit)}</span>{canClose ? <Button variant="secondary" onClick={() => setReopening(y.id)}>Reopen year</Button> : null}</> : canClose ? <Button variant="secondary" busy={closeYear.isPending} onClick={() => void run(() => closeYear.mutateAsync(y.id), `Year ${y.label} closed.`)}>Close the year</Button> : <span className="text-muted">Year not closed yet.</span>}
            </div>
            <table className="w-full text-sm" aria-label={`Periods ${y.label}`}>
              <thead><tr className="text-left text-xs text-muted"><th className="py-1">Period</th><th className="py-1">From</th><th className="py-1">To</th><th className="py-1">Status</th><th /></tr></thead>
              <tbody>
                {y.periods.map((p) => (
                  <tr key={p.id} className="border-t border-line/60">
                    <td className="py-1.5">{p.name}</td><td className="py-1.5">{formatDate(p.startDate)}</td><td className="py-1.5">{formatDate(p.endDate)}</td>
                    <td className="py-1.5"><span className={p.status === 'open' ? 'text-good' : p.status === 'locked' ? 'text-bad' : 'text-muted'}>{STATUS[p.status] ?? p.status}</span></td>
                    <td className="py-1.5 text-right">
                      {canManage ? (
                        <span className="inline-flex gap-2">
                          {p.status === 'open' ? <Button variant="ghost" aria-label={`Close ${p.name}`} onClick={() => void run(() => act.mutateAsync({ id: p.id, action: 'close' }), `${p.name} closed.`)}>Close</Button> : null}
                          {p.status === 'closed' ? <><Button variant="ghost" aria-label={`Reopen ${p.name}`} onClick={() => void run(() => act.mutateAsync({ id: p.id, action: 'reopen' }), `${p.name} reopened.`)}>Reopen</Button><Button variant="ghost" aria-label={`Lock ${p.name}`} onClick={() => void run(() => act.mutateAsync({ id: p.id, action: 'lock' }), `${p.name} locked.`)}>Lock</Button></> : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      })}
      {adding ? (
        <Drawer title="New financial year" onClose={() => setAdding(false)}>
          <SimpleForm schema={schema} defaults={{ startDate: `${todayIso().slice(0, 4)}-04-01`, label: '' }} fields={['startDate', 'label']} label="Create year" submit={async (v) => { await create.mutateAsync({ companyId, startDate: v.startDate, ...(v.label ? { label: v.label } : {}) }); setAdding(false); flash.show('Financial year created with its twelve periods.') }}>
            {({ register, errors }) => (<><TextField label="Starts on" type="date" error={errors.startDate?.message as string | undefined} hint="Always the 1st of a month; the year runs for twelve months." {...register('startDate')} /><TextField label="Label (optional)" error={errors.label?.message as string | undefined} hint="Defaults to e.g. 2026-27" {...register('label')} /></>)}
          </SimpleForm>
        </Drawer>
      ) : null}
      {reopening ? (
        <Drawer title="Reopen the year" onClose={() => setReopening(null)}>
          <p className="mb-3 text-sm text-muted">This reverses the year-end closing entry so the year can be corrected. The reason is kept in the audit trail.</p>
          <SimpleForm schema={z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) })} defaults={{ reason: '' }} fields={['reason']} label="Reopen year" submit={async (v) => { await reopenYear.mutateAsync({ id: reopening, reason: v.reason }); setReopening(null); flash.show('Year reopened.') }}>
            {({ register, errors }) => <TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} />}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}

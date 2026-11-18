import { useState } from 'react'
import { z } from 'zod'
import type { LedgerAccount } from '@/api/schemas'
import { ApiError } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatInr, todayIso } from '@/domain/format'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Spinner, TextField } from '@/ui/primitives'
import { useLiabilities, useRemit } from './queries'

const KINDS = [['pf', 'Provident fund'], ['esi', 'ESI'], ['pt', 'Professional tax'], ['tds', 'TDS on salary']] as const
type Kind = (typeof KINDS)[number][0]

export function RemittancesPage() {
  const ws = useWorkspace()
  const canProcess = can(useSession((s) => s.me?.permissions ?? []), 'payroll:process')
  const q = useLiabilities(ws.company?.id)
  const remit = useRemit()
  const flash = useFlash()
  const [target, setTarget] = useState<{ period: string; kind: Kind; amount: string } | null>(null)
  const [from, setFrom] = useState<LedgerAccount | null>(null)
  if (ws.loading || q.isPending) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const company = ws.company
  const periods = q.data?.periods ?? []
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Statutory dues</h1>
      <p className="max-w-3xl text-sm text-muted">What payroll has deducted or accrued and not yet paid over, by month. Pay it, then record the payment here so the books and this list agree.</p>
      {q.error ? <Alert>{q.error.message}</Alert> : null}
      {periods.length === 0 ? <Alert tone="info">Nothing is due.</Alert> : (
        <div className="overflow-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm" aria-label="Statutory dues"><thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Month</th>{KINDS.map(([, l]) => <th key={l} className="p-2 text-right">{l}</th>)}</tr></thead>
          <tbody>{periods.map((p) => <tr key={p.period} className="border-t border-line/60"><td className="p-2">{p.period}</td>{KINDS.map(([k]) => <td key={k} className="p-2 text-right"><span className="num">{Number(p[k]) === 0 ? '–' : formatInr(p[k], { symbol: false })}</span>{canProcess && Number(p[k]) > 0 ? <Button variant="ghost" aria-label={`Remit ${k} ${p.period}`} onClick={() => { setFrom(null); setTarget({ period: p.period, kind: k, amount: p[k] }) }}>Pay</Button> : null}</td>)}</tr>)}</tbody></table></div>)}
      {target ? (
        <Drawer title={`Pay ${KINDS.find(([k]) => k === target.kind)?.[1]} · ${target.period}`} onClose={() => setTarget(null)}>
          <SimpleForm schema={z.object({ date: z.string().min(1), amount: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount').refine((v) => Number(v) > 0, 'Must be above zero'), reference: z.string().trim().max(100) })} defaults={{ date: todayIso(), amount: String(Number(target.amount)), reference: '' }} fields={['date', 'amount', 'reference']} label="Record payment"
            submit={async (v) => { if (!from) throw new Error('Choose the account it was paid from.'); try { const r = await remit.mutateAsync({ key: crypto.randomUUID(), body: { companyId: company.id, kind: target.kind, period: target.period, date: v.date, amount: v.amount, paidFromAccountId: from.id, ...(v.reference ? { reference: v.reference } : {}) } }); flash.show(`${r.remittanceNo} recorded.`); setTarget(null) } catch (e) { throw new Error(e instanceof ApiError ? e.message : 'Could not record the payment.') } }}>
            {({ register, errors }) => (<><TextField label="Paid on" type="date" {...register('date')} /><TextField label="Amount" error={errors.amount?.message as string | undefined} {...register('amount')} /><TextField label="Challan or reference (optional)" {...register('reference')} /><AccountPicker label="Paid from (bank or cash)" value={from} filter={(a) => a.type === 'asset'} onPick={setFrom} /></>)}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { z } from 'zod'
import type { BankLine, LedgerAccount } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { add, fromUnits, toUnits } from '@/domain/money'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { AccountPicker } from './AccountPicker'
import { useAutoMatch, useBankAccounts, useBankCandidates, useBankLines, useBankReconciliation, useBankStatements, useBookLine, useCreateBankAccount, useIgnoreLine, useImportStatement, useMatchLine, useUnmatchLine } from './queries'
import { parseStatementCsv, type ParsedLine } from './statementCsv'

type Tab = 'lines' | 'statements' | 'recon'

function LineActions({ line, accountId, onClose }: { line: BankLine; accountId: string; onClose: () => void }) {
  const flash = useFlash()
  const [scope, setScope] = useState<'exact' | 'any'>('exact')
  const cands = useBankCandidates(line.status === 'unmatched' ? line.id : undefined, scope)
  const match = useMatchLine(); const unmatch = useUnmatchLine(); const ignore = useIgnoreLine(); const book = useBookLine()
  const [target, setTarget] = useState<LedgerAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const go = async (fn: () => Promise<unknown>, done: string) => { setError(null); try { await fn(); flash.show(done); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } }
  const reason = z.object({ reason: z.string().trim().min(2, 'Give a reason').max(300) })
  return (
    <Drawer title={`${formatDate(line.lineDate)} · ${formatInr(line.amount)}`} onClose={onClose} width={560}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{line.description}{line.reference ? <span className="text-muted"> · {line.reference}</span> : null}</p>
        {error ? <Alert>{error}</Alert> : null}
        {line.status === 'unmatched' ? (
          <>
            <section aria-label="Candidates"><div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold">Match with a book entry</h3>
              <SelectField label="Show" value={scope} onChange={(e) => setScope(e.target.value as 'exact' | 'any')} options={[{ value: 'exact', label: 'Same amount' }, { value: 'any', label: 'Any amount' }]} /></div>
              {cands.isPending ? <Spinner /> : cands.data?.length === 0 ? <p className="text-sm text-muted">No unreconciled entry in the books around this date.</p> : (
                <ul className="flex flex-col gap-1">{cands.data?.map((c) => (
                  <li key={c.journalLineId} className="flex items-center justify-between rounded border border-line px-2 py-1.5 text-sm"><span>{c.entryNo} · {formatDate(c.postingDate)} · {formatInr(c.amount)} <span className="text-muted">{c.description ?? ''} ({c.daysApart} d)</span></span>
                    <Button variant="secondary" aria-label={`Match ${c.entryNo}`} onClick={() => void go(() => match.mutateAsync({ lineId: line.id, journalLineIds: [c.journalLineId] }), 'Matched.')}>Match</Button></li>
                ))}</ul>)}
            </section>
            <section aria-label="Book"><h3 className="mb-1 text-sm font-semibold">Not in the books yet</h3>
              <p className="mb-2 text-xs text-muted">Charges, interest and similar items: choose the account to post the other side to.</p>
              <AccountPicker label="Post to account" value={target} onPick={setTarget} filter={(a) => a.id !== accountId} />
              <Button className="mt-2" disabled={!target} busy={book.isPending} onClick={() => target && void go(() => book.mutateAsync({ lineId: line.id, accountId: target.id, description: line.description }), 'Booked and matched.')}>Post entry and match</Button>
            </section>
            <section aria-label="Ignore"><h3 className="mb-1 text-sm font-semibold">Ignore this line</h3>
              <SimpleForm schema={reason} defaults={{ reason: '' }} fields={['reason']} label="Ignore line" submit={async (v) => { await ignore.mutateAsync({ lineId: line.id, reason: v.reason }); flash.show('Line ignored.'); onClose() }}>
                {({ register, errors }) => <TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} />}
              </SimpleForm></section>
          </>
        ) : (
          <section aria-label="Undo"><p className="mb-2 text-sm text-muted">{line.status === 'matched' ? 'This line is matched to the books.' : `Ignored: ${line.ignoreReason ?? ''}`}</p>
            <SimpleForm schema={reason} defaults={{ reason: '' }} fields={['reason']} label={line.status === 'matched' ? 'Unmatch' : 'Restore'} submit={async (v) => { await unmatch.mutateAsync({ lineId: line.id, reason: v.reason }); flash.show('Line is unmatched again.'); onClose() }}>
              {({ register, errors }) => <TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} />}
            </SimpleForm></section>
        )}
      </div>
    </Drawer>
  )
}

function ImportDrawer({ bankAccountId, onClose }: { bankAccountId: string; onClose: () => void }) {
  const flash = useFlash()
  const imp = useImportStatement(bankAccountId)
  const [lines, setLines] = useState<ParsedLine[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [opening, setOpening] = useState('0')
  const [closing, setClosing] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dates = lines.map((l) => l.date).sort()
  const net = lines.reduce((s, l) => add(s, l.amount), '0')
  const expected = (() => { try { return add(opening || '0', net) } catch { return '' } })()
  const body = useMemo(() => (lines.length && dates[0] && dates.at(-1) && closing !== '' ? { periodFrom: dates[0], periodTo: dates.at(-1) as string, openingBalance: opening || '0', closingBalance: closing, lines } : null), [lines, closing, opening]) // eslint-disable-line react-hooks/exhaustive-deps
  const key = useMemo(() => crypto.randomUUID(), [JSON.stringify(body)]) // eslint-disable-line react-hooks/exhaustive-deps
  async function pick(f: File | undefined) {
    if (!f) return
    const r = parseStatementCsv(await f.text()); setLines(r.lines); setErrors(r.errors)
    if (r.lines.length && closing === '') setClosing(add(opening || '0', r.lines.reduce((s, l) => add(s, l.amount), '0')))
  }
  return (
    <Drawer title="Import a bank statement" onClose={onClose} width={640}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Choose the CSV your bank gives you. It needs Date and Description, and either one Amount column (deposits positive) or Withdrawal and Deposit columns.</p>
        <input type="file" accept=".csv,text/csv" aria-label="Statement file" onChange={(e) => void pick(e.target.files?.[0])} />
        {errors.length ? <Alert>{errors.slice(0, 6).map((e) => <div key={e}>{e}</div>)}{errors.length > 6 ? <div>…and {errors.length - 6} more.</div> : null}</Alert> : null}
        {lines.length ? (
          <>
            <p className="text-sm">{lines.length} lines · {formatDate(dates[0]!)} – {formatDate(dates.at(-1)!)} · net {formatInr(net)}</p>
            <div className="grid grid-cols-2 gap-3"><TextField label="Opening balance" value={opening} onChange={(e) => setOpening(e.target.value)} /><TextField label="Closing balance" value={closing} onChange={(e) => setClosing(e.target.value)} /></div>
            {expected && closing !== '' && fromUnits(toUnits(closing)) !== fromUnits(toUnits(expected)) ? <Alert tone="info">Opening balance plus the lines gives {formatInr(expected)}, not {formatInr(closing)}. The server will refuse a statement that does not add up.</Alert> : null}
            {error ? <Alert>{error}</Alert> : null}
            <Button busy={imp.isPending} disabled={!body} onClick={async () => { if (!body) return; setError(null); try { const s = await imp.mutateAsync({ body, key }); flash.show(`${s.statementNo} imported with ${lines.length} lines.`); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.') } }}>Import statement</Button>
          </>
        ) : null}
      </div>
    </Drawer>
  )
}

export function BankPage() {
  const ws = useWorkspace()
  const flash = useFlash()
  const perms = useSession((s) => s.me?.permissions ?? [])
  const canManage = can(perms, 'bank:manage'); const canReconcile = can(perms, 'bank:reconcile')
  const accounts = useBankAccounts(ws.company?.id)
  const create = useCreateBankAccount()
  const [selected, setSelected] = useState('')
  const bankId = selected || accounts.data?.[0]?.id || ''
  const bank = accounts.data?.find((b) => b.id === bankId)
  const [tab, setTab] = useState<Tab>('lines')
  const [status, setStatus] = useState('unmatched')
  const [asOf, setAsOf] = useState(todayIso())
  const lines = useBankLines(bankId || undefined, status || undefined)
  const statements = useBankStatements(bankId || undefined)
  const recon = useBankReconciliation(tab === 'recon' ? bankId || undefined : undefined, asOf)
  const auto = useAutoMatch(bankId)
  const [open, setOpen] = useState<BankLine | null>(null)
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [ledger, setLedger] = useState<LedgerAccount | null>(null)
  if (ws.loading || accounts.isPending) return <Spinner />
  if (!ws.company) return <Alert tone="info">No company yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  const companyId = ws.company.id
  const addSchema = z.object({ name: z.string().trim().min(1, 'Required').max(100), bankName: z.string().trim().max(100), accountRef: z.string().trim().max(40) })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Bank reconciliation</h1>{canManage ? <Button variant="secondary" onClick={() => setAdding(true)}>Add bank account</Button> : null}</div>
      {accounts.data?.length === 0 ? <Alert tone="info">No bank account yet. Add one, linked to its ledger account, then import a statement.</Alert> : (
        <>
          <Toolbar>
            <div className="w-72"><SelectField label="Bank account" value={bankId} onChange={(e) => setSelected(e.target.value)} options={(accounts.data ?? []).map((b) => ({ value: b.id, label: `${b.name}${b.accountRef ? ` · ${b.accountRef}` : ''}` }))} /></div>
            {bank?.clearedThrough ? <span className="self-end pb-2 text-xs text-muted">Reconciled through {formatDate(bank.clearedThrough)}</span> : null}
            {canReconcile ? <div className="ml-auto flex gap-2 self-end"><Button variant="secondary" onClick={() => setImporting(true)}>Import statement</Button><Button busy={auto.isPending} onClick={async () => { try { const r = await auto.mutateAsync(); flash.show(`Auto-match: ${r.matched} matched, ${r.ambiguous} need a choice, ${r.unmatched} left.`) } catch (e) { flash.show(e instanceof Error ? e.message : 'Auto-match failed.') } }}>Auto-match</Button></div> : null}
          </Toolbar>
          <div role="tablist" className="flex gap-1 border-b border-line">
            {([['lines', 'Statement lines'], ['statements', 'Statements'], ['recon', 'Reconciliation']] as [Tab, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}
          </div>

          {tab === 'lines' ? (
            <div className="flex flex-col gap-3">
              <div className="w-48"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'unmatched', label: 'Unmatched' }, { value: 'matched', label: 'Matched' }, { value: 'ignored', label: 'Ignored' }, { value: '', label: 'All' }]} /></div>
              {lines.error ? <Alert>{lines.error.message}</Alert> : null}
              {lines.isPending ? <Spinner /> : lines.data?.length === 0 ? <Alert tone="info">Nothing here.</Alert> : (
                <div className="overflow-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm" aria-label="Statement lines">
                  <thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2">Reference</th><th className="p-2 text-right">Amount</th><th className="p-2">Status</th></tr></thead>
                  <tbody>{lines.data?.map((l) => <tr key={l.id} className="cursor-pointer border-t border-line/60 hover:bg-canvas" onClick={() => canReconcile && setOpen(l)}><td className="p-2">{formatDate(l.lineDate)}</td><td className="p-2">{l.description}</td><td className="p-2 text-muted">{l.reference ?? ''}</td><td className={`num p-2 text-right ${Number(l.amount) < 0 ? 'text-bad' : ''}`}>{formatInr(l.amount, { symbol: false })}</td><td className="p-2">{l.status}</td></tr>)}</tbody>
                </table></div>)}
            </div>
          ) : null}

          {tab === 'statements' ? (statements.isPending ? <Spinner /> : statements.data?.length === 0 ? <Alert tone="info">No statement imported yet.</Alert> : (
            <div className="overflow-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm" aria-label="Statements">
              <thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Number</th><th className="p-2">Period</th><th className="p-2 text-right">Opening</th><th className="p-2 text-right">Closing</th><th className="p-2 text-right">Lines</th></tr></thead>
              <tbody>{statements.data?.map((s) => <tr key={s.id} className="border-t border-line/60"><td className="p-2">{s.statementNo}</td><td className="p-2">{formatDate(s.periodFrom)} – {formatDate(s.periodTo)}</td><td className="num p-2 text-right">{formatInr(s.openingBalance, { symbol: false })}</td><td className="num p-2 text-right">{formatInr(s.closingBalance, { symbol: false })}</td><td className="num p-2 text-right">{s.lineCount}</td></tr>)}</tbody>
            </table></div>)) : null}

          {tab === 'recon' ? (
            <div className="flex flex-col gap-3">
              <div className="w-40"><TextField label="As on" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
              {recon.error ? <Alert>{recon.error.message}</Alert> : null}
              {recon.isPending ? <Spinner /> : recon.data ? (
                <Card title="Bank reconciliation statement">
                  <div className="max-w-2xl text-sm">
                    <div className="flex justify-between py-1"><span>Balance per books</span><span className="num">{formatInr(recon.data.balancePerBooks)}</span></div>
                    <div className="flex justify-between py-1"><span>Add: payments issued, not yet cleared</span><span className="num">{formatInr(recon.data.outstandingPayments.total)}</span></div>
                    <div className="flex justify-between py-1"><span>Less: deposits in transit</span><span className="num">{formatInr(recon.data.depositsInTransit.total)}</span></div>
                    <div className="flex justify-between py-1"><span>Bank items not yet in the books</span><span className="num">{formatInr(recon.data.bankItemsNotInBooks.total)}</span></div>
                    <div className="flex justify-between border-t border-line py-1 font-semibold"><span>Expected statement balance</span><span className="num">{formatInr(recon.data.expectedStatementBalance)}</span></div>
                    {recon.data.statement ? <div className="flex justify-between py-1"><span>Statement {recon.data.statement.statementNo} closing balance</span><span className="num">{formatInr(recon.data.statement.closingBalance)}</span></div> : <p className="py-1 text-muted">No statement covers this date yet.</p>}
                  </div>
                  <p className={`mt-2 text-sm font-medium ${recon.data.reconciled ? 'text-good' : 'text-bad'}`}>{recon.data.reconciled ? 'Reconciled: the statement agrees.' : recon.data.difference !== null ? `Difference ${formatInr(recon.data.difference)}` : 'Import a statement to reconcile.'}</p>
                </Card>) : null}
            </div>
          ) : null}
        </>
      )}
      {open && bank ? <LineActions line={open} accountId={bank.accountId} onClose={() => setOpen(null)} /> : null}
      {importing && bankId ? <ImportDrawer bankAccountId={bankId} onClose={() => setImporting(false)} /> : null}
      {adding ? (
        <Drawer title="Add bank account" onClose={() => setAdding(false)}>
          <SimpleForm schema={addSchema} defaults={{ name: '', bankName: '', accountRef: '' }} fields={['name', 'bankName', 'accountRef']} label="Add account" submit={async (v) => { if (!ledger) throw new Error('Choose the ledger account that holds this bank’s balance.'); await create.mutateAsync({ companyId, accountId: ledger.id, name: v.name, ...(v.bankName ? { bankName: v.bankName } : {}), ...(v.accountRef ? { accountRef: v.accountRef } : {}) }); setAdding(false); flash.show('Bank account added.') }}>
            {({ register, errors }) => (<><TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} /><TextField label="Bank" {...register('bankName')} /><TextField label="Account reference" hint="Last four digits only, never the full number." {...register('accountRef')} /><AccountPicker label="Ledger account" value={ledger} onPick={setLedger} filter={(a) => a.type === 'asset'} /></>)}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, Card, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useAccountLedger, useBalanceSheet, useCashFlow, useProfitLoss, useTrialBalance } from './queries'

type Tab = 'tb' | 'pl' | 'bs' | 'cf'
const TABS: { id: Tab; label: string }[] = [{ id: 'tb', label: 'Trial balance' }, { id: 'pl', label: 'Profit and loss' }, { id: 'bs', label: 'Balance sheet' }, { id: 'cf', label: 'Cash flow' }]
const fyStart = (): string => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01` }
const amt = (v: string) => (Number(v) === 0 ? '–' : formatInr(v, { symbol: false }))
const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => <div className={`flex justify-between py-1 ${strong ? 'border-t border-line font-semibold' : ''}`}><span>{label}</span><span className="num">{amt(value)}</span></div>

function Ledger({ companyId, accountId, from, to, onClose }: { companyId: string; accountId: string; from: string; to: string; onClose: () => void }) {
  const q = useAccountLedger(companyId, accountId, from, to)
  const l = q.data
  return (
    <Drawer title={l ? `${l.account.code} · ${l.account.name}` : 'Account ledger'} onClose={onClose} width={720}>
      {q.isPending ? <Spinner /> : !l ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{formatDate(l.from)} – {formatDate(l.to)} · opening balance {formatInr(l.openingBalance)}</p>
          <table className="w-full text-sm" aria-label="Account ledger">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">Date</th><th className="py-1">Entry</th><th className="py-1">Description</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">Credit</th><th className="py-1 text-right">Balance</th></tr></thead>
            <tbody>{l.lines.map((x, i) => <tr key={i} className="border-t border-line/60"><td className="py-1">{formatDate(x.postingDate)}</td><td className="py-1">{x.entryNo}</td><td className="py-1 text-muted">{x.description ?? ''}</td><td className="num py-1 text-right">{Number(x.debit) ? amt(x.debit) : ''}</td><td className="num py-1 text-right">{Number(x.credit) ? amt(x.credit) : ''}</td><td className="num py-1 text-right">{formatInr(x.balance, { symbol: false })}</td></tr>)}</tbody>
          </table>
          {l.hasMore ? <Alert tone="info">Only the first lines are shown. Narrow the dates to see the rest.</Alert> : null}
          <Button variant="secondary" className="self-start" onClick={() => download(`ledger-${l.account.code}.csv`, toCsv(['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'], l.lines.map((x) => [x.postingDate, x.entryNo, x.description ?? '', x.debit, x.credit, x.balance])))}>Export CSV</Button>
        </div>
      )}
    </Drawer>
  )
}

export function ReportsPage() {
  const ws = useWorkspace()
  const [tab, setTab] = useState<Tab>('tb')
  const [from, setFrom] = useState(fyStart())
  const [to, setTo] = useState(todayIso())
  const [drill, setDrill] = useState<string | null>(null)
  const cid = ws.company?.id
  const tb = useTrialBalance(tab === 'tb' ? cid : undefined, from, to)
  const pl = useProfitLoss(tab === 'pl' ? cid : undefined, from, to)
  const bs = useBalanceSheet(tab === 'bs' ? cid : undefined, to)
  const cf = useCashFlow(tab === 'cf' ? cid : undefined, from, to)
  if (ws.loading) return <Spinner />
  if (!cid) return <Alert tone="info">No company yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  const err = (tab === 'tb' ? tb : tab === 'pl' ? pl : tab === 'bs' ? bs : cf).error
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Financial reports</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <Toolbar>
        {tab !== 'bs' ? <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div> : null}
        <div className="w-40"><TextField label={tab === 'bs' ? 'As on' : 'To'} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {err ? <Alert>{err.message}</Alert> : null}

      {tab === 'tb' ? (tb.isPending ? <Spinner /> : tb.data ? (
        <div className="flex flex-col gap-3">
          {tb.data.balanced ? null : <Alert>The trial balance does not balance. Please contact support.</Alert>}
          <div className="overflow-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm" aria-label="Trial balance">
              <thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Account</th><th className="p-2 text-right">Opening Dr</th><th className="p-2 text-right">Opening Cr</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-right">Closing Dr</th><th className="p-2 text-right">Closing Cr</th></tr></thead>
              <tbody>
                {tb.data.rows.map((r) => <tr key={r.accountId} className="cursor-pointer border-t border-line/60 hover:bg-canvas" onClick={() => setDrill(r.accountId)}><td className="p-2">{r.code} · {r.name}</td>{[r.openingDebit, r.openingCredit, r.debit, r.credit, r.closingDebit, r.closingCredit].map((v, i) => <td key={i} className="num p-2 text-right">{amt(v)}</td>)}</tr>)}
                <tr className="border-t border-line bg-canvas font-semibold"><td className="p-2">Total</td>{[tb.data.totals.openingDebit, tb.data.totals.openingCredit, tb.data.totals.debit, tb.data.totals.credit, tb.data.totals.closingDebit, tb.data.totals.closingCredit].map((v, i) => <td key={i} className="num p-2 text-right">{amt(v)}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <Button variant="secondary" className="self-start" onClick={() => download('trial-balance.csv', toCsv(['Code', 'Account', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'], tb.data.rows.map((r) => [r.code, r.name, r.openingDebit, r.openingCredit, r.debit, r.credit, r.closingDebit, r.closingCredit])))}>Export CSV</Button>
          <p className="text-xs text-muted">Click an account to see its ledger.</p>
        </div>
      ) : null) : null}

      {tab === 'pl' ? (pl.isPending ? <Spinner /> : pl.data ? (
        <Card title={`Statement of profit and loss · ${formatDate(pl.data.from)} – ${formatDate(pl.data.to)}`}>
          {pl.data.unmappedAccounts.length ? <Alert tone="info">Some accounts are not mapped to a Schedule III line: {pl.data.unmappedAccounts.join(', ')}.</Alert> : null}
          <div className="max-w-2xl text-sm">
            {pl.data.lines.map((l) => <Row key={l.code} label={l.label} value={l.amount} />)}
            <Row label="Total revenue" value={pl.data.totalRevenue} strong /><Row label="Total expenses" value={pl.data.totalExpenses} />
            <Row label="Profit before tax" value={pl.data.profitBeforeTax} strong /><Row label="Tax expense" value={pl.data.taxExpense} />
            <Row label="Profit for the period" value={pl.data.profitForThePeriod} strong />
          </div>
          <Button variant="secondary" className="mt-3" onClick={() => download('profit-and-loss.csv', toCsv(['Line', 'Amount'], [...pl.data.lines.map((l) => [l.label, l.amount]), ['Total revenue', pl.data.totalRevenue], ['Total expenses', pl.data.totalExpenses], ['Profit before tax', pl.data.profitBeforeTax], ['Tax expense', pl.data.taxExpense], ['Profit for the period', pl.data.profitForThePeriod]]))}>Export CSV</Button>
        </Card>
      ) : null) : null}

      {tab === 'bs' ? (bs.isPending ? <Spinner /> : bs.data ? (
        <div className="flex flex-col gap-3">
          {bs.data.balanced ? null : <Alert>The balance sheet is out by {formatInr(bs.data.difference)}.</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <Card title="Equity and liabilities"><div className="text-sm">{bs.data.equityAndLiabilities.lines.map((l) => <Row key={l.code} label={l.label} value={l.amount} />)}<Row label="Profit and loss account" value={bs.data.equityAndLiabilities.profitAndLossAccount} /><Row label="Total" value={bs.data.equityAndLiabilities.total} strong /></div></Card>
            <Card title="Assets"><div className="text-sm">{bs.data.assets.lines.map((l) => <Row key={l.code} label={l.label} value={l.amount} />)}<Row label="Total" value={bs.data.assets.total} strong /></div></Card>
          </div>
          <Button variant="secondary" className="self-start" onClick={() => download('balance-sheet.csv', toCsv(['Side', 'Line', 'Amount'], [...bs.data.equityAndLiabilities.lines.map((l) => ['Equity and liabilities', l.label, l.amount]), ['Equity and liabilities', 'Total', bs.data.equityAndLiabilities.total], ...bs.data.assets.lines.map((l) => ['Assets', l.label, l.amount]), ['Assets', 'Total', bs.data.assets.total]]))}>Export CSV</Button>
        </div>
      ) : null) : null}

      {tab === 'cf' ? (cf.isPending ? <Spinner /> : cf.data ? (
        <Card title={`Cash flow · ${formatDate(cf.data.from)} – ${formatDate(cf.data.to)}`}>
          <div className="max-w-xl text-sm">
            <Row label="Profit for the period" value={cf.data.operating.profitForThePeriod} /><Row label="Depreciation" value={cf.data.operating.depreciation} /><Row label="Change in working capital" value={cf.data.operating.changeInWorkingCapital} />
            <Row label="Operating activities" value={cf.data.operating.net} strong /><Row label="Investing activities" value={cf.data.investing.net} strong />
            <Row label="Borrowings" value={cf.data.financing.borrowings} /><Row label="Other equity" value={cf.data.financing.equityOtherThanProfit} /><Row label="Financing activities" value={cf.data.financing.net} strong />
            <Row label="Net change in cash" value={cf.data.netChangeInCash} strong /><Row label="Opening cash" value={cf.data.openingCash} /><Row label="Closing cash" value={cf.data.closingCash} strong />
          </div>
          <p className={`mt-2 text-xs ${cf.data.reconciled ? 'text-good' : 'text-bad'}`}>{cf.data.reconciled ? 'Agrees with the cash and bank balances in the books.' : 'Does not agree with the books.'}</p>
        </Card>
      ) : null) : null}
      {drill ? <Ledger companyId={cid} accountId={drill} from={from} to={to} onClose={() => setDrill(null)} /> : null}
    </div>
  )
}

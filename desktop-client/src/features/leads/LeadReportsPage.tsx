import { useState } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { SOURCES, sourceLabel, useLeadActions, useReport, useSpend } from './queries'

const monthStart = (): string => `${todayIso().slice(0, 8)}01`
const money = (v: number | null): string => (v === null ? '—' : formatInr(String(v), { symbol: true }))
function Stat({ label, value, note }: { label: string; value: string; note?: string | undefined }) { return <div className="rounded-lg border border-line bg-surface px-4 py-3"><p className="text-xs text-muted">{label}</p><p className="num text-lg font-semibold">{value}</p>{note ? <p className="text-xs text-muted">{note}</p> : null}</div> }

function SpendPanel({ from, to }: { from: string; to: string }) {
  const a = useLeadActions(); const flash = useFlash(); const q = useSpend(from, to)
  const [v, setV] = useState({ date: todayIso(), source: 'meta', campaign: '', amount: '' }); const [problem, setProblem] = useState<string | null>(null)
  return (
    <Card>
      <h2 className="text-sm font-semibold">Advert spend</h2>
      <p className="mb-3 text-xs text-muted">Enter what you spent on each campaign (from the Meta or Google Ads billing screen), and the report shows what each lead and each sale cost. Entering the same day again replaces it.</p>
      <div className="filterbar">
        <div className="w-40"><TextField label="Date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
        <div className="w-48"><SelectField label="Source" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} options={SOURCES.filter((s) => ['meta', 'google', 'website', 'indiamart', 'justdial', 'other'].includes(s.value))} /></div>
        <div className="w-56"><TextField label="Campaign (optional)" value={v.campaign} onChange={(e) => setV({ ...v, campaign: e.target.value })} /></div>
        <div className="w-36"><TextField label="Amount, ₹" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
        <Button disabled={!v.amount} busy={a.saveSpend.isPending} onClick={async () => { setProblem(null); try { await a.saveSpend.mutateAsync([{ date: v.date, source: v.source, ...(v.campaign ? { campaign: v.campaign } : {}), amount: v.amount }]); setV({ ...v, amount: '' }); flash.show('Spend saved.') } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } }}>Add</Button>
      </div>
      {problem ? <div className="mt-2"><Alert>{problem}</Alert></div> : null}
      {q.isPending ? <Spinner /> : (q.data ?? []).length === 0 ? null : (
        <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Date</th><th className="py-1">Source</th><th className="py-1">Campaign</th><th className="num py-1 text-right">Amount</th><th /></tr></thead>
          <tbody>{(q.data ?? []).map((s) => <tr key={s.id} className="border-t border-line/60"><td className="py-1">{formatDate(s.date)}</td><td className="py-1">{sourceLabel(s.source)}</td><td className="py-1">{s.campaign}</td><td className="num py-1 text-right">{formatInr(s.amount)}</td><td className="py-1 text-right"><Button variant="ghost" aria-label={`Remove spend of ${s.amount} on ${s.date}`} onClick={() => void a.removeSpend.mutateAsync(s.id)}>Remove</Button></td></tr>)}</tbody></table>
      )}
    </Card>
  )
}

/** Which sources and campaigns bring leads, sales and money, and what they cost. */
export function LeadReportsPage() {
  const perms = useSession((s) => s.me?.permissions ?? [])
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(todayIso())
  const q = useReport(from, to)
  const r = q.data
  const max = Math.max(1, ...(r?.funnel.map((f) => f.count) ?? [1]))
  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div><h1 className="page-title">Lead reports</h1><p className="page-sub">Where leads come from, how fast they are answered, and which sources pay.</p></div>
      <div className="filterbar">
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {q.isPending ? <Spinner /> : q.error || !r ? <Alert>{q.error?.message ?? 'Could not load.'}</Alert> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Leads" value={String(r.totals.leads)} /><Stat label="Won" value={String(r.totals.won)} note={r.totals.won + r.totals.lost > 0 ? `${Math.round((r.totals.won / (r.totals.won + r.totals.lost)) * 100)}% of closed` : undefined} />
          <Stat label="Sales from these leads" value={formatInr(String(r.totals.revenue))} /><Stat label="Advert spend" value={formatInr(String(r.totals.spend))} /><Stat label="Cost per lead" value={money(r.totals.costPerLead)} />
          <Stat label="Answered in time" value={r.response.answered > 0 ? `${Math.round((r.response.withinSla / r.response.answered) * 100)}%` : '—'} note={r.response.overdue > 0 ? `${r.response.overdue} waiting too long` : undefined} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card><h2 className="mb-2 text-sm font-semibold">Where leads are now</h2><ul className="flex flex-col gap-1.5">{r.funnel.map((f) => <li key={f.name} className="flex items-center gap-2 text-sm"><span className="w-32 shrink-0">{f.name}</span><span className="h-3 flex-1 overflow-hidden rounded bg-sunken"><span className={`block h-full ${f.kind === 'won' ? 'bg-good' : f.kind === 'lost' ? 'bg-bad' : 'bg-brand'}`} style={{ width: `${(f.count / max) * 100}%` }} /></span><span className="num w-8 text-right">{f.count}</span></li>)}</ul></Card>
          <Card><h2 className="mb-2 text-sm font-semibold">Why leads were lost</h2>{r.lostReasons.length === 0 ? <p className="text-sm text-muted">None in this period.</p> : <ul className="flex flex-col gap-1 text-sm">{r.lostReasons.map((l) => <li key={l.reason} className="flex justify-between"><span>{l.reason}</span><b>{l.count}</b></li>)}</ul>}</Card>
        </div>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">By source and campaign</h2>
          {r.items.length === 0 ? <p className="text-sm text-muted">No leads in this period.</p> : (
            <div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Source</th><th className="py-1">Campaign</th><th className="num py-1 text-right">Leads</th><th className="num py-1 text-right">Won</th><th className="num py-1 text-right">Lost</th><th className="num py-1 text-right">Open</th><th className="num py-1 text-right">Reply (min)</th><th className="num py-1 text-right">Sales</th><th className="num py-1 text-right">Spend</th><th className="num py-1 text-right">Per lead</th><th className="num py-1 text-right">Per sale</th></tr></thead>
              <tbody>{r.items.map((x) => <tr key={`${x.source}|${x.campaign}`} className="border-t border-line/60"><td className="py-1.5">{sourceLabel(x.source)}</td><td className="py-1.5">{x.campaign || '—'}</td><td className="num py-1.5 text-right">{x.leads}</td><td className="num py-1.5 text-right">{x.won}</td><td className="num py-1.5 text-right">{x.lost}</td><td className="num py-1.5 text-right">{x.open}</td><td className="num py-1.5 text-right">{x.avgResponseMinutes ?? '—'}</td><td className="num py-1.5 text-right">{x.revenue ? formatInr(String(x.revenue)) : '—'}</td><td className="num py-1.5 text-right">{x.spend ? formatInr(String(x.spend)) : '—'}</td><td className="num py-1.5 text-right">{money(x.costPerLead)}</td><td className="num py-1.5 text-right">{money(x.costPerWon)}</td></tr>)}</tbody></table></div>
          )}
          <p className="mt-2 text-xs text-muted">Sales are the invoices (less credit notes) raised to a lead's customer after the lead arrived. Make the lead a customer so its sales are counted.</p>
        </Card>
      </>)}
      {can(perms, 'leads:manage') ? <SpendPanel from={from} to={to} /> : null}
    </div>
  )
}

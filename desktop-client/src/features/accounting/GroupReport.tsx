import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { query } from '@/api/client'
import { trialBalance } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import { formatInr } from '@/domain/format'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { Alert, Button, Card, Spinner } from '@/ui/primitives'
import { groupSummary, groupTrialBalance } from './group'

/** All the companies of the business together. Tick the accounts that are only balances between the companies (what one owes another, sales between them) and they are taken out of the group's totals. */
export function GroupReport({ from, to }: { from: string; to: string }) {
  const ws = useWorkspace(); const companies = ws.companies
  const qs = useQueries({ queries: companies.map((c) => ({ queryKey: ['trial-balance', c.id, from, to], queryFn: () => { const api = currentApi(); return api.call(api.raw.GET('/v1/accounting/trial-balance', { params: { query: query({ companyId: c.id, from, to }) } }), trialBalance) } })) })
  const [elim, setElim] = useState<Set<string>>(new Set())
  const ready = qs.every((q) => q.data)
  const group = useMemo(() => (ready ? groupTrialBalance(companies.map((c) => c.legalName), qs.map((q) => q.data!)) : null), [ready, companies, qs]) // eslint-disable-line react-hooks/exhaustive-deps
  if (qs.some((q) => q.isPending)) return <Spinner />
  const bad = qs.find((q) => q.error)
  if (bad || !group) return <Alert>{(bad?.error as Error | undefined)?.message ?? 'Could not load.'}</Alert>
  const s = groupSummary(group.rows, elim)
  const m = (v: number): string => (v === 0 ? '–' : formatInr(String(Math.abs(v)), { symbol: false }) + (v < 0 ? ' Cr' : ' Dr'))
  const toggle = (k: string): void => setElim((e) => { const x = new Set(e); if (x.has(k)) x.delete(k); else x.add(k); return x })
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Group income', s.income], ['Group expenses', s.expense], ['Group profit', s.profit]].map(([l, v]) => <div key={l as string} className="rounded-lg border border-line bg-surface px-4 py-3"><p className="text-xs text-muted">{l as string}</p><p className="num text-lg font-semibold">{formatInr(String(v))}</p></div>)}
        <div className="rounded-lg border border-line bg-surface px-4 py-3"><p className="text-xs text-muted">Eliminated accounts</p><p className="text-lg font-semibold">{elim.size}</p></div>
      </div>
      {!s.balanced ? <Alert>After the eliminations the group does not balance (debits {formatInr(String(s.debits))}, credits {formatInr(String(s.credits))}). Eliminate both sides of each inter-company balance.</Alert> : null}
      <Card>
        <div className="overflow-auto"><table className="w-full text-sm" aria-label="Group trial balance">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">Eliminate</th><th className="py-1">Account</th>{group.companies.map((c) => <th key={c} className="num py-1 text-right">{c}</th>)}<th className="num py-1 text-right">Group</th></tr></thead>
          <tbody>{group.rows.map((r) => <tr key={r.key} className={`border-t border-line/60 ${elim.has(r.key) ? 'text-muted line-through' : ''}`}><td className="py-1"><input type="checkbox" aria-label={`Eliminate ${r.code}`} checked={elim.has(r.key)} onChange={() => toggle(r.key)} /></td><td className="py-1">{r.code} · {r.name}</td>{r.perCompany.map((v, i) => <td key={i} className="num py-1 text-right">{m(v)}</td>)}<td className="num py-1 text-right font-medium">{m(elim.has(r.key) ? 0 : r.total)}</td></tr>)}</tbody></table></div>
        <div className="mt-3 flex gap-2"><Button variant="secondary" onClick={() => download('group-trial-balance.csv', toCsv(['Code', 'Account', ...group.companies, 'Group (signed, Dr positive)', 'Eliminated'], group.rows.map((r) => [r.code, r.name, ...r.perCompany.map(String), String(elim.has(r.key) ? 0 : r.total), elim.has(r.key) ? 'yes' : ''])))}>Download CSV</Button></div>
        <p className="mt-2 text-xs text-muted">Accounts are matched by code, so the companies should use the same chart. Closing balances for the dates chosen; all amounts in rupees.</p>
      </Card>
    </div>
  )
}

import React, { useMemo } from 'react'
import { Notice } from '@/ui/blocks'
import { ReportShell } from '@/modules/accounting/ui/ReportShell'
import { usePeriod, useLedger } from '@/modules/accounting/ui/hooks'
import { needsAttention, trialBalance } from '@/modules/accounting/ledger'
import { trialBalanceTable } from '@/modules/accounting/report-html'

/** Every account's balance at the end of the period; debits and credits come out equal or the books say so. */
export default function TrialBalancePage() {
  const p = usePeriod('fy')
  const ledger = useLedger({ from: p.from, to: p.to })
  const tb = useMemo(() => trialBalance(ledger), [ledger])
  const table = useMemo(() => trialBalanceTable(tb, p.from, p.to), [tb, p.from, p.to])
  const links = useMemo(() => table.rows.map((_, i) => (tb.rows[i] ? `/m/accounting/ledger/${tb.rows[i].account.id}` : undefined)), [table, tb])
  const att = needsAttention(ledger)
  return (
    <ReportShell title="Trial balance" period={p} table={table} links={links}
      footerNote={tb.balanced ? undefined : <Notice tone="danger" title="The trial balance does not balance" body="Debits and credits differ. Check the opening balances in the chart of accounts." />}>
      {att.suspense || att.unmapped.length ? <Notice tone="warning" title="Some entries need an account" body="Money is parked in Suspense because a document points at an account the chart does not have. Open the chart of accounts and sync it." /> : null}
    </ReportShell>
  )
}

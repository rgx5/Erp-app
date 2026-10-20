import React, { useMemo } from 'react'
import { accountLedger } from '@/modules/accounting/ledger'
import { resolveAccount } from '@/modules/accounting/chart'
import { accountLedgerTable } from '@/modules/accounting/report-html'
import { ReportShell } from '@/modules/accounting/ui/ReportShell'
import { useLedger, usePeriod } from '@/modules/accounting/ui/hooks'

/** The cash-in-hand account: what came in, what went out, and the balance after each entry. */
export default function CashBookPage() {
  const p = usePeriod('month')
  const ledger = useLedger({ from: p.from, to: p.to })
  const table = useMemo(() => {
    const a = resolveAccount(ledger.chart, 'cash')
    const l = a ? accountLedger(ledger, a.id) : null
    return l ? { ...accountLedgerTable(l, p.from, p.to), title: 'Cash book' } : { title: 'Cash book', columns: [], rows: [] }
  }, [ledger, p.from, p.to])
  return <ReportShell title="Cash book" period={p} table={table} emptyHint="No cash moved in this period." />
}

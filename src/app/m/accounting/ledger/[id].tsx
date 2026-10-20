import React, { useMemo } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { accountLedger } from '@/modules/accounting/ledger'
import { accountLedgerTable } from '@/modules/accounting/report-html'
import { ReportShell } from '@/modules/accounting/ui/ReportShell'
import { useLedger, usePeriod } from '@/modules/accounting/ui/hooks'

/** One account's ledger: every entry with the other side of it and a running balance (debit +). */
export default function AccountLedgerPage() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const p = usePeriod('fy')
  const ledger = useLedger({ from: p.from, to: p.to })
  const table = useMemo(() => {
    const l = accountLedger(ledger, String(id))
    return l ? accountLedgerTable(l, p.from, p.to) : { title: 'Account', columns: [], rows: [] }
  }, [ledger, id, p.from, p.to])
  return <ReportShell title={table.title} period={p} table={table} emptyHint="That account is not in the chart, or nothing was booked to it in this period." />
}

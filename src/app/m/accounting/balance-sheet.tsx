import React, { useMemo } from 'react'
import { Notice } from '@/ui/blocks'
import { ReportShell } from '@/modules/accounting/ui/ReportShell'
import { usePeriod, useLedger } from '@/modules/accounting/ui/hooks'
import { balanceSheet } from '@/modules/accounting/ledger'
import { balanceSheetTable } from '@/modules/accounting/report-html'
import { fmtDate } from '@/domain/dates'

/** What the business owns and owes as at the end of the chosen period (always counted from the start of the books). */
export default function BalanceSheetPage() {
  const p = usePeriod('fy')
  const ledger = useLedger({ to: p.to })
  const bs = useMemo(() => balanceSheet(ledger), [ledger])
  const table = useMemo(() => balanceSheetTable(bs, p.to), [bs, p.to])
  return (
    <ReportShell title="Balance sheet" subtitle={`As at ${fmtDate(p.to)}`} period={p} table={table} emptyHint="Nothing has been booked yet."
      footerNote={bs.openingDifference ? <Notice tone="warning" title="Opening balances do not agree" body="The opening balances in the chart do not net to zero. The difference is shown under equity until it is put right." /> : undefined} />
  )
}

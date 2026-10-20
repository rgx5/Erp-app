import React, { useMemo } from 'react'
import { ReportShell } from '@/modules/accounting/ui/ReportShell'
import { usePeriod, useLedger } from '@/modules/accounting/ui/hooks'
import { profitAndLoss } from '@/modules/accounting/ledger'
import { profitAndLossTable } from '@/modules/accounting/report-html'

/** Income less cost of sales and expenses for the period. Year-end closing entries are left out so a closed year still shows its profit. */
export default function ProfitLossPage() {
  const p = usePeriod('month')
  const ledger = useLedger({ from: p.from, to: p.to })
  const table = useMemo(() => profitAndLossTable(profitAndLoss(ledger), p.from, p.to), [ledger, p.from, p.to])
  return <ReportShell title="Profit & loss" period={p} table={table} emptyHint="No sales or expenses were booked in this period." />
}

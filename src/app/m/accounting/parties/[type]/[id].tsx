import React, { useMemo } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useList } from '@/data/hooks'
import { useApp } from '@/data/store'
import { partyLedger } from '@/modules/accounting/ledger'
import { partyLedgerTable } from '@/modules/accounting/report-html'
import { ReportShell } from '@/modules/accounting/ui/ReportShell'
import { useLedger, usePeriod } from '@/modules/accounting/ui/hooks'
import type { PartyType } from '@/modules/postings'

/** A customer's or supplier's account: what was billed, what was paid, what is still due. */
export default function PartyLedgerPage() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>()
  const kind: PartyType = type === 'supplier' ? 'supplier' : type === 'employee' ? 'employee' : 'customer'
  const p = usePeriod('fy')
  const ledger = useLedger({ from: p.from, to: p.to })
  const data = useApp((s) => s.data)
  const customers = useList('customers'), suppliers = useList('suppliers')
  const name = (kind === 'supplier' ? suppliers : customers).find((x) => x.id === id)?.name ?? (kind === 'employee' ? data.users[String(id)]?.name : undefined) ?? 'Account'
  const table = useMemo(() => partyLedgerTable(partyLedger(ledger, data, kind, String(id)), name, p.from, p.to), [ledger, data, kind, id, name, p.from, p.to])
  return <ReportShell title={name} period={p} table={table} emptyHint="Nothing is booked against this account in this period." />
}

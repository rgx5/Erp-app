import { useMemo, useState } from 'react'
import { useApp } from '@/data/store'
import { fromInputDate, toInputDate, endOfDay, startOfDay } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { buildLedger, type Ledger } from '../ledger'
import { periodBounds, type PeriodKey } from '../logic'

/** The books for a period, recomputed only when the data or the dates change. */
export function useLedger(o: { from?: number; to?: number; branchId?: string } = {}): Ledger {
  const data = useApp((s) => s.data)
  return useMemo(() => buildLedger(data, o), [data, o.from, o.to, o.branchId]) // eslint-disable-line react-hooks/exhaustive-deps
}

export interface PeriodState {
  key: PeriodKey
  setKey: (k: PeriodKey) => void
  fromText: string
  toText: string
  setFromText: (s: string) => void
  setToText: (s: string) => void
  from: number
  to: number
}

/** A report period: a named one (this month, this year…) or custom dates typed as YYYY-MM-DD. */
export function usePeriod(initial: PeriodKey = 'month'): PeriodState {
  const years = useList('financialYears')
  const [key, setKey] = useState<PeriodKey>(initial)
  const now = Date.now()
  const hour = Math.floor(now / 3_600_000)
  const named = useMemo(() => periodBounds(key === 'custom' ? 'month' : key, hour * 3_600_000, years), [key, years, hour])
  const [fromText, setFromText] = useState(toInputDate(named[0]))
  const [toText, setToText] = useState(toInputDate(now))
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(fromInputDate(s))
  if (key !== 'custom') return { key, setKey: (k) => { if (k === 'custom') { setFromText(toInputDate(named[0])); setToText(toInputDate(named[1])) } setKey(k) }, fromText, toText, setFromText, setToText, from: named[0], to: named[1] }
  const from = valid(fromText) ? startOfDay(fromInputDate(fromText)) : named[0]
  const to = valid(toText) ? endOfDay(fromInputDate(toText)) : named[1]
  return { key, setKey, fromText, toText, setFromText, setToText, from, to: Math.max(from, to) }
}

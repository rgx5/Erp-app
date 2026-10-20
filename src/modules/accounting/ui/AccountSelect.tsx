import React, { useMemo } from 'react'
import { Select } from '@/ui/Inputs'
import { useLedger } from './hooks'

/** Chooses an account from the chart (by its number, which is how vouchers refer to it). */
export function AccountSelect({ label, value, onChange, only, error }: { label?: string; value: string; onChange: (code: string) => void; only?: Array<'asset' | 'liability' | 'equity' | 'income' | 'expense'>; error?: string | null }) {
  const ledger = useLedger()
  const options = useMemo(() => ledger.chart.filter((a) => a.active && (!only || only.includes(a.type))).sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ value: a.code, label: `${a.code}  ${a.name}`, sub: a.type })), [ledger.chart, only])
  return <Select label={label} value={value} options={options} onChange={onChange} placeholder="Choose an account" searchable error={error} />
}

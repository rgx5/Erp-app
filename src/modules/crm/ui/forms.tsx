import React, { useState } from 'react'
import { View } from 'react-native'
import { fromInputDate, toInputDate } from '@/domain/dates'
import type { Customer } from '@/domain/types'
import { OpError } from '@/data/ops'
import { useApp } from '@/data/store'
import { CustomerPicker } from '@/features/CustomerPicker'
import { Field } from '@/ui/Inputs'
import { Avatar, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ChevronDown } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Shows a refusal as a toast: an OpError's own sentence, or a general line for anything else. */
export const failWith = (e: unknown, fallback = 'Could not save') => toast(e instanceof OpError ? e.message : fallback, 'err')

/** "20261031" → "2026-10-31" as the digits are typed. */
export const dateMask = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 8)
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d
}

/** Empty is fine; otherwise it must be a real calendar date. */
export function dateProblem(s: string): string | null {
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Use year-month-day, e.g. 2026-10-31'
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d ? 'That date does not exist' : null
}

/** The timestamp for a typed date, or undefined when empty/invalid. */
export const dateValue = (s: string): number | undefined => (s && !dateProblem(s) ? fromInputDate(s) : undefined)
export const dateText = (ms: number | undefined) => (ms === undefined ? '' : toInputDate(ms))

export function DateField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return <Field label={label} value={value} onChangeText={(t) => onChange(dateMask(t))} keyboardType="number-pad" placeholder="YYYY-MM-DD" mono error={dateProblem(value)} hint={hint} />
}

/** A field that opens the customer finder. */
export function CustomerField({ label = 'Customer', value, onChange, optional }: { label?: string; value: string | undefined; onChange: (c: Customer | null) => void; optional?: boolean }) {
  const { c, radius } = useTheme()
  const [open, setOpen] = useState(false)
  const customer = useApp((s) => (value ? s.data.customers[value] : undefined))
  return (
    <View>
      <T v="label" tone="soft" style={{ marginBottom: 6 }}>{label}{optional ? ' (optional)' : ''}</T>
      <Tap onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lineStrong }}>
        {customer ? <Avatar name={customer.name} size={28} /> : null}
        <T tone={customer ? 'default' : 'mute'} style={{ flex: 1 }} numberOfLines={1}>{customer ? `${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}` : 'Find by name or mobile number'}</T>
        <ChevronDown size={18} color={c.inkMute} />
      </Tap>
      <CustomerPicker visible={open} onClose={() => setOpen(false)} onPick={onChange} selectedId={value ?? null} />
    </View>
  )
}

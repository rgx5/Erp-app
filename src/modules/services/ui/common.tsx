import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { inr0 } from '@/domain/money'
import type { Customer } from '@/domain/types'
import { OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { perform, useApp } from '@/data/store'
import { CustomerPicker } from '@/features/CustomerPicker'
import { Field, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ChevronDown } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import type { Tone } from '@/ui/theme'
import { useTheme } from '@/ui/theme'
import { fromMin, isHhmm, toMin } from '../logic/time'
import type { ApptStatus, JobStatus, PackageStatus, VisitStatus } from '../types'

/** Shows a refusal as a toast: an OpError's own sentence, or a general line for anything else. */
export const failWith = (e: unknown, fallback = 'Could not save') => toast(e instanceof OpError ? e.message : fallback, 'err')

export const APPT_TONE: Record<ApptStatus, Tone> = { booked: 'primary', confirmed: 'accent', arrived: 'warning', in_service: 'warning', completed: 'success', cancelled: 'default', no_show: 'danger' }
export const JOB_TONE: Record<JobStatus, Tone> = { received: 'primary', estimated: 'warning', approved: 'accent', in_work: 'warning', ready: 'success', delivered: 'default', rejected: 'danger', cancelled: 'default' }
export const VISIT_TONE: Record<VisitStatus, Tone> = { planned: 'primary', checked_in: 'warning', completed: 'success', cancelled: 'default' }
export const PACKAGE_TONE: Record<PackageStatus, Tone> = { active: 'success', frozen: 'primary', expired: 'danger' }

/** "20261031" → "2026-10-31" as the digits are typed. */
export const dateMask = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 8)
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d
}
export function dateProblem(s: string): string | null {
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Use year-month-day, e.g. 2026-10-31'
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d ? 'That date does not exist' : null
}
/** The start of a typed day, or undefined when empty / invalid. */
export const dayValue = (s: string): number | undefined => (s && !dateProblem(s) ? new Date(fromInputDate(s)).setHours(0, 0, 0, 0) : undefined)
export const dayText = (ms: number | undefined) => (ms === undefined ? '' : toInputDate(ms))

export function DateField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return <Field label={label} value={value} onChangeText={(t) => onChange(dateMask(t))} keyboardType="number-pad" placeholder="YYYY-MM-DD" mono error={dateProblem(value)} hint={hint} />
}

/** "0930" → "09:30" as the digits are typed. */
export const timeMask = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d
}
export function TimeField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return <Field label={label} value={value} onChangeText={(t) => onChange(timeMask(t))} keyboardType="number-pad" placeholder="HH:MM" mono error={value && !isHhmm(value) ? 'Use 24-hour time, e.g. 14:30' : null} hint={hint} />
}
/** A typed day and time → a moment, or undefined. */
export function momentOf(day: string, time: string): number | undefined {
  const d = dayValue(day)
  if (d === undefined || !isHhmm(time)) return undefined
  const m = toMin(time)
  const x = new Date(d)
  return new Date(x.getFullYear(), x.getMonth(), x.getDate(), Math.floor(m / 60), m % 60).getTime()
}
export const timeText = (ms: number) => { const d = new Date(ms); return fromMin(d.getHours() * 60 + d.getMinutes()) }

/** A field that opens the customer finder. */
export function CustomerField({ label = 'Customer', value, onChange, optional }: { label?: string; value: string | null | undefined; onChange: (c: Customer | null) => void; optional?: boolean }) {
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

/** Items that are services (no stock) or parts (stocked), as choices. */
export function useVariantChoices(kind: 'service' | 'part') {
  const products = useApp((s) => s.data.products)
  const variants = useApp((s) => s.data.variants)
  return useMemo(() => listOf(variants).filter((v) => {
    const p = products[v.productId]
    if (!p || !p.active) return false
    return kind === 'service' ? p.trackStock === false : p.trackStock !== false
  }).map((v) => {
    const p = products[v.productId]
    const name = [p.name, v.size, v.color].filter(Boolean).join(' ')
    return { value: v.id, label: name, sub: `${inr0(v.price)}${kind === 'part' ? ` · ${v.stock} in stock` : ''}`, price: v.price, name, stock: v.stock }
  }).sort((a, b) => a.label.localeCompare(b.label)), [products, variants, kind])
}

export function VariantSelect({ kind, value, onChange, label, placeholder }: { kind: 'service' | 'part'; value: string; onChange: (v: string, c: { name: string; price: number }) => void; label?: string; placeholder?: string }) {
  const choices = useVariantChoices(kind)
  return (
    <Select label={label} value={value} placeholder={placeholder ?? (kind === 'service' ? 'Choose a service' : 'Choose a part from stock')} searchable
      options={choices.map((c) => ({ value: c.value, label: c.label, sub: c.sub }))} onChange={(v) => { const c = choices.find((x) => x.value === v); if (c) onChange(v, { name: c.name, price: c.price }) }} />
  )
}

/** Team members as choices. */
export function useTeam() {
  const users = useApp((s) => s.data.users)
  return useMemo(() => listOf(users).filter((u) => u.active), [users])
}

export const useShopName = () => useApp((s) => s.data.store?.name ?? 'our shop')

/** A short summary row used on detail screens. */
export function Pill({ children, tone = 'default' }: { children: React.ReactNode; tone?: Tone }) {
  const { c } = useTheme()
  const color = tone === 'success' ? c.success : tone === 'danger' ? c.danger : tone === 'warning' ? c.warning : tone === 'primary' ? c.primary : c.inkSoft
  return <T v="caption" style={{ color }}>{children}</T>
}

/** Runs an operation and commits it. A refusal shows as a toast and returns null; success shows `ok` (if given) and returns the result. */
export function act<R extends { changes: Changes }>(fn: (state: DataState, ctx: OpCtx) => R, ok?: string): R | null {
  try {
    const r = perform(fn)
    if (ok) toast(ok, 'ok')
    return r
  } catch (e) { failWith(e); return null }
}

/** A friendly line for a screen the person's role may not use. */
export function Denied({ title, who }: { title: string; who: string }) {
  return <Screen title={title} back><T tone="mute">{who}</T></Screen>
}

/** Today at the start of the day, refreshed on every render (screens re-render on any data change). */
export const todayStart = () => new Date().setHours(0, 0, 0, 0)

/** Phone numbers and WhatsApp share: texts open the right app; nothing is sent from here. */
export { whatsApp, shareText } from '@/features/share'

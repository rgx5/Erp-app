import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { useApp } from '@/data/store'
import type { DataState } from '@/data/state'
import { ItemPicker } from '@/features/ItemPicker'
import { Field, Select } from '@/ui/Inputs'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ChevronDown } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { locationOptions } from '../logic'

/** The business data, for the pure functions of `logic.ts`. */
export const useData = (): DataState => useApp((s) => s.data)

/** "YYYY-MM-DD" → time, '' → undefined, anything else → NaN (so a screen can say "write the date as YYYY-MM-DD"). */
export function parseDate(s: string): number | undefined {
  const t = s.trim()
  if (!t) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(fromInputDate(t)) ? fromInputDate(t) : NaN
}

/** A date typed as YYYY-MM-DD. Keeps what is being typed; reports a time once it is a whole valid date, `undefined` when empty. */
export function DateInput({ label, value, onChange, hint }: { label: string; value?: number; onChange: (ms: number | undefined) => void; hint?: string }) {
  const [text, setText] = useState(value ? toInputDate(value) : '')
  const bad = Number.isNaN(parseDate(text))
  return (
    <Field label={label} value={text} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" mono maxLength={10} hint={hint} error={bad && text.length >= 10 ? 'Write the date as YYYY-MM-DD' : null}
      onChangeText={(t) => { setText(t); const d = parseDate(t); if (d === undefined) onChange(undefined); else if (!Number.isNaN(d)) onChange(d) }} />
  )
}

/** Choose an item (variant) from the catalogue; shows the choice. */
export function ItemField({ label, value, onChange, trackedOnly = true, placeholder = 'Choose item' }: { label?: string; value: string; onChange: (variantId: string) => void; trackedOnly?: boolean; placeholder?: string }) {
  const { c, radius } = useTheme()
  const data = useData()
  const [open, setOpen] = useState(false)
  const v = value ? data.variants[value] : undefined
  const text = v ? `${data.products[v.productId]?.name ?? v.sku}${variantLabel(v.size, v.color) ? ` · ${variantLabel(v.size, v.color)}` : ''}` : placeholder
  return (
    <View>
      {label ? <T v="label" tone="soft" style={{ marginBottom: 6 }}>{label}</T> : null}
      <Tap onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lineStrong }}>
        <T v="body" tone={v ? 'default' : 'mute'} style={{ flex: 1 }} numberOfLines={1}>{text}</T>
        <ChevronDown size={18} color={c.inkMute} />
      </Tap>
      <ItemPicker visible={open} onClose={() => setOpen(false)} trackedOnly={trackedOnly} onPick={(x) => { onChange(x.id); setOpen(false) }} title={label ?? 'Choose item'} />
    </View>
  )
}

export function LocationSelect({ label, value, onChange, exclude, hint }: { label?: string; value: string; onChange: (id: string) => void; exclude?: string; hint?: string }) {
  const data = useData()
  const options = useMemo(() => locationOptions(data).filter((o) => o.id !== exclude).map((o) => ({ value: o.id, label: o.label })), [data, exclude])
  return <Select<string> label={label} value={value} options={options} onChange={onChange} placeholder="Choose location" hint={hint} />
}

/** A short label for a time in the past or future: "in 12 days", "3 days ago", "today". */
export function whenLabel(days: number | null): string {
  if (days === null) return 'no expiry'
  if (days === 0) return 'today'
  return days > 0 ? `in ${days} ${days === 1 ? 'day' : 'days'}` : `${-days} ${days === -1 ? 'day' : 'days'} ago`
}

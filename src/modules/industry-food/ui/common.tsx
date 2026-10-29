import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { inr0 } from '@/domain/money'
import type { Customer } from '@/domain/types'
import { OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { perform, useApp } from '@/data/store'
import { CustomerPicker } from '@/features/CustomerPicker'
import { Screen } from '@/ui/Screen'
import { Avatar, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ChevronDown } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Shows a refusal as a toast: an OpError's own sentence, or a general line for anything else. */
export const failWith = (e: unknown, fallback = 'Could not save') => toast(e instanceof OpError ? e.message : fallback, 'err')

/** Runs an operation and commits it. A refusal shows as a toast and returns null; success shows `ok` (if given) and returns the result. */
export function act<R extends { changes: Changes }>(fn: (state: DataState, ctx: OpCtx) => R, ok?: string): R | null {
  try {
    const r = perform(fn)
    if (ok) toast(ok, 'ok')
    return r
  } catch (e) { failWith(e); return null }
}

/** A friendly line for a screen the person's role (or industry) may not use. */
export function Denied({ title, who }: { title: string; who: string }) {
  return <Screen title={title} back><T tone="mute">{who}</T></Screen>
}

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

/** Menu items as choices for the order editor — those priced and sold like a plate, not tracked piece by piece. */
export function useMenuChoices() {
  const products = useApp((s) => s.data.products)
  const variants = useApp((s) => s.data.variants)
  return useMemo(() => listOf(variants).filter((v) => products[v.productId]?.active).map((v) => {
    const p = products[v.productId]
    const name = [p?.name, v.size, v.color].filter(Boolean).join(' · ')
    return { value: v.id, label: name, sub: inr0(v.price), price: v.price, name, categoryId: p?.categoryId, stock: v.stock, trackStock: p?.trackStock !== false }
  }).sort((a, b) => a.label.localeCompare(b.label)), [products, variants])
}

/** Active staff, for "who gets this tip". */
export function useTeam() {
  const users = useApp((s) => s.data.users)
  return useMemo(() => listOf(users).filter((u) => u.active), [users])
}

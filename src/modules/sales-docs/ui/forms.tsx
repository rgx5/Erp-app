import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr, round2 } from '@/domain/money'
import type { DiscountType } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import { useList, useStore } from '@/data/hooks'
import { CustomerPicker } from '@/features/CustomerPicker'
import { ItemPicker } from '@/features/ItemPicker'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented } from '@/ui/Inputs'
import { Avatar, Card, Tap } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Plus, Trash, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { docLineFor, docTotals } from '../logic/lines'
import type { DocLine } from '../types'

// ───────────────────────────── lines ─────────────────────────────

interface Row { line: DocLine; qty: string; price: string }
const toRow = (line: DocLine): Row => ({ line, qty: String(line.qty), price: String(line.price) })

/** The lines of a quotation / order / plan being written: quantities and rates stay as typed text until saved. */
export function useDocLines(initial: DocLine[] = []) {
  const store = useStore()
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow))
  const lines = useMemo<DocLine[]>(() => rows.map((r) => ({ ...r.line, qty: Number(r.qty) || 0, price: Number(r.price) || 0 })).filter((l) => l.qty > 0), [rows])
  return {
    rows, lines,
    add: (v: VariantView) => setRows((cur) => (cur.some((r) => r.line.variantId === v.id) ? cur : [...cur, toRow(docLineFor(v, store.costBasis))])),
    remove: (variantId: string) => setRows((cur) => cur.filter((r) => r.line.variantId !== variantId)),
    patch: (variantId: string, p: Partial<Pick<Row, 'qty' | 'price'>>) => setRows((cur) => cur.map((r) => (r.line.variantId === variantId ? { ...r, ...p } : r))),
    set: (next: DocLine[]) => setRows(next.map(toRow)),
  }
}
export type DocLinesState = ReturnType<typeof useDocLines>

/** The item cards of a document with "Add item". */
export function DocLinesEditor({ doc, title }: { doc: DocLinesState; title?: string }) {
  const { c } = useTheme()
  const [picking, setPicking] = useState(false)
  return (
    <View style={{ gap: 10 }}>
      {doc.rows.map(({ line: l, qty, price }) => (
        <Card key={l.variantId} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{[variantLabel(l.size, l.color), l.sku].filter(Boolean).join(' · ')}</T>
            </View>
            <T v="num">{inr((Number(qty) || 0) * (Number(price) || 0), 0)}</T>
            <IconButton label="Remove" tone="ghost" size={36} onPress={() => doc.remove(l.variantId)}><Trash size={18} color={c.inkMute} /></IconButton>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><NumberField label={l.unit && l.unit !== 'pc' ? `Quantity (${l.unit})` : 'Quantity'} value={qty} onChange={(t) => doc.patch(l.variantId, { qty: t })} decimals={!!l.fractional} /></View>
            <View style={{ flex: 1 }}><MoneyField label="Rate" value={price} onChange={(t) => doc.patch(l.variantId, { price: t })} /></View>
          </View>
        </Card>
      ))}
      <Button label={title ?? 'Add item'} kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking(true)} />
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={doc.add} picked={new Set(doc.rows.map((r) => r.line.variantId))} title="Add item" />
    </View>
  )
}

// ───────────────────────────── discount & totals ─────────────────────────────

export function useDiscount(type: DiscountType = 'amt', value = 0) {
  const [t, setT] = useState<DiscountType>(type)
  const [text, setText] = useState(value ? String(value) : '')
  return { type: t, setType: setT, text, setText, value: Number(text) || 0 }
}
export type DiscountState = ReturnType<typeof useDiscount>

/** Bill discount entry and the totals worked out exactly as the counter will work them out. */
export function DocTotals({ lines, discount, label = 'Total' }: { lines: DocLine[]; discount: DiscountState; label?: string }) {
  const store = useStore()
  const t = docTotals(lines, discount.type, discount.value, store)
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 128 }}><Segmented compact value={discount.type} options={[{ value: 'amt', label: '₹' }, { value: 'pct', label: '%' }]} onChange={discount.setType} /></View>
        <View style={{ flex: 1 }}><MoneyField value={discount.text} onChange={discount.setText} placeholder="Bill discount" /></View>
      </View>
      <Card>
        {t.itemDiscount + t.billDiscount > 0 ? <KV k="Discount" v={`− ${inr(round2(t.itemDiscount + t.billDiscount))}`} tone="success" /> : null}
        <KV k={store.priceIncludesTax ? 'GST included' : 'GST added'} v={inr(t.taxTotal)} />
        {t.roundOff ? <KV k="Round off" v={inr(t.roundOff)} /> : null}
        <KV k={label} v={inr(t.total)} strong big />
      </Card>
    </View>
  )
}

// ───────────────────────────── people & dates ─────────────────────────────

/** A tappable customer row that opens the customer picker (which can also add a new customer). */
export function CustomerRow({ customerId, onChange, label = 'Customer', optional }: { customerId: string | null; onChange: (id: string | null) => void; label?: string; optional?: boolean }) {
  const { c, radius } = useTheme()
  const customers = useList('customers')
  const [open, setOpen] = useState(false)
  const cu = customers.find((x) => x.id === customerId)
  return (
    <View>
      <T v="label" tone="soft" style={{ marginBottom: 6 }}>{label}</T>
      <Tap onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
        {cu ? <Avatar name={cu.name} size={40} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={18} color={c.primary} /></View>}
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">{cu ? cu.name : optional ? 'Walk-in / not saved' : 'Choose a customer'}</T>
          <T v="caption" tone="mute">{cu ? cu.phone : optional ? 'Type a name below, or pick a customer' : 'Tap to search or add'}</T>
        </View>
        <ChevronRight size={18} color={c.inkMute} />
      </Tap>
      <CustomerPicker visible={open} onClose={() => setOpen(false)} selectedId={customerId} onPick={(x) => onChange(x?.id ?? null)} />
    </View>
  )
}

export const isInputDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00`).getTime())

/** A typed `YYYY-MM-DD` date (see `toInputDate` / `fromInputDate`). */
export function DateField({ label, value, onChange, optional }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const bad = value !== '' && !isInputDate(value)
  return <Field label={optional ? `${label} (optional)` : label} value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" autoCapitalize="none" error={bad ? 'Write the date as YYYY-MM-DD' : null} />
}

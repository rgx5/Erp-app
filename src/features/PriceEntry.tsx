import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr0 } from '@/domain/money'
import { marginPct, unpricedDays, isOverdue } from '@/domain/pricing'
import { readPrices, suggestPrice, type PriceDraftText } from '@/domain/purchasing'
import { fmtQtyUnit } from '@/domain/qty'
import type { VariantView } from '@/domain/views'
import { OpError, priceVariants } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

export type PriceDrafts = Record<string, PriceDraftText>

/** The state behind a price-later form: one price/MRP pair per variant, validated and saved in one go. */
export function usePriceDrafts(variants: VariantView[]) {
  const [drafts, setDrafts] = useState<PriceDrafts>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const get = (v: VariantView): PriceDraftText => drafts[v.id] ?? { price: '', mrp: v.mrp > 0 ? String(v.mrp) : '' }
  const filled = variants.filter((v) => (drafts[v.id]?.price ?? '').trim() !== '').length

  const set = (v: VariantView, patch: Partial<PriceDraftText>) => {
    setDrafts((d) => ({ ...d, [v.id]: { ...(d[v.id] ?? { price: '', mrp: v.mrp > 0 ? String(v.mrp) : '' }), ...patch } }))
    setErrors((e) => { if (!e[v.id]) return e; const { [v.id]: _drop, ...rest } = e; return rest })
  }
  /** Fills every empty row that has a cost with cost + markup. Rows already priced by hand are left alone. */
  const markup = (pct: number) => setDrafts((d) => {
    const next = { ...d }
    for (const v of variants) {
      if ((next[v.id]?.price ?? '').trim()) continue
      const p = suggestPrice(v.cost, pct)
      if (p > 0) next[v.id] = { price: String(p), mrp: next[v.id]?.mrp ?? (v.mrp > 0 ? String(v.mrp) : '') }
    }
    return next
  })
  /** Saves the filled rows. Returns how many were priced (0 = nothing saved, errors shown on the rows). */
  function save(): number {
    const merged: PriceDrafts = {}
    for (const v of variants) if (drafts[v.id]) merged[v.id] = drafts[v.id]
    const r = readPrices(merged)
    setErrors(r.errors)
    if (Object.keys(r.errors).length) { toast('Fix the highlighted prices', 'err'); return 0 }
    if (!r.rows.length) { toast('Enter at least one price', 'info'); return 0 }
    try {
      perform((s, ctx) => priceVariants(s, r.rows, ctx))
      setDrafts((d) => { const next = { ...d }; for (const row of r.rows) delete next[row.id]; return next })
      return r.rows.length
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save prices', 'err'); return 0 }
  }
  return { drafts, get, set, errors, filled, markup, save }
}

export type PriceForm = ReturnType<typeof usePriceDrafts>

const MARKUPS = [25, 40, 60, 100]

/** Unpriced variants grouped by product, each with a price and MRP box and the cost beside it. */
export function PriceEditor({ variants, form }: { variants: VariantView[]; form: PriceForm }) {
  const { c } = useTheme()
  const showMargin = useCan('viewProfit')
  const groups = useMemo(() => {
    const by = new Map<string, VariantView[]>()
    for (const v of variants) { const l = by.get(v.productId); if (l) l.push(v); else by.set(v.productId, [v]) }
    return [...by.values()]
  }, [variants])
  const hasCost = variants.some((v) => v.cost > 0)

  return (
    <View style={{ gap: 14 }}>
      {hasCost ? (
        <View style={{ gap: 8 }}>
          <T v="label" tone="soft">QUICK FILL — COST PLUS</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MARKUPS.map((m) => <Chip key={m} label={`+${m}%`} onPress={() => form.markup(m)} />)}
          </View>
          <T v="caption" tone="mute">Fills empty prices only. You can change any of them.</T>
        </View>
      ) : null}
      {groups.map((vs) => (
        <Card key={vs[0].productId} padded={false}>
          <View style={{ padding: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{vs[0].productName}</T>
            <T v="caption" tone="mute" numberOfLines={1}>{vs[0].styleCode}</T>
            {vs.some((v) => isOverdue(v)) ? <Badge tone="warning">{Math.max(...vs.map((v) => unpricedDays(v)))} d waiting</Badge> : null}
          </View>
          {vs.map((v) => {
            const d = form.get(v)
            const price = Number(d.price)
            return (
              <View key={v.id} style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: c.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{variantLabel(v.size, v.color) || 'Standard'}</T>
                  <T v="caption" tone="mute" numberOfLines={1}>{[v.trackStock ? `${fmtQtyUnit(v.stock, v)} in stock` : null, v.cost > 0 ? `cost ${inr0(v.cost)}` : null].filter(Boolean).join(' · ')}</T>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><MoneyField label="Selling price" value={d.price} onChange={(t) => form.set(v, { price: t })} error={form.errors[v.id] ?? null} /></View>
                  <View style={{ flex: 1 }}><MoneyField label="MRP" value={d.mrp} onChange={(t) => form.set(v, { mrp: t })} placeholder={d.price || '0'} /></View>
                </View>
                {showMargin && price > 0 && v.cost > 0 ? <T v="caption" tone={price > v.cost ? 'success' : 'danger'}>{price > v.cost ? `${Math.round(marginPct(price, v.cost))}% margin` : 'Below cost'}</T> : null}
              </View>
            )
          })}
        </Card>
      ))}
    </View>
  )
}

/** "Price what you just received" — shown after a goods receipt that brought in unpriced items. */
export function PriceSheet({ variants, onClose, title = 'Price what you received', subtitle }: { variants: VariantView[]; onClose: () => void; title?: string; subtitle?: string }) {
  const form = usePriceDrafts(variants)
  const left = variants.length - form.filled
  return (
    <Sheet visible={variants.length > 0} onClose={onClose} title={title} subtitle={subtitle ?? 'Items without a price can’t be sold. Set them now, or later from the home screen.'} full
      footer={(
        <View style={{ gap: 8 }}>
          <Button label={form.filled ? `Save ${form.filled} ${form.filled === 1 ? 'price' : 'prices'}` : 'Save prices'} size="lg" block disabled={!form.filled} onPress={() => { const n = form.save(); if (n) { toast(`${n} ${n === 1 ? 'item' : 'items'} priced`, 'ok'); onClose() } }} />
          <Button label={left > 0 && form.filled ? `Skip the other ${left}` : 'Price them later'} kind="ghost" block onPress={onClose} />
        </View>
      )}>
      <View style={{ paddingBottom: 12 }}><PriceEditor variants={variants} form={form} /></View>
    </Sheet>
  )
}

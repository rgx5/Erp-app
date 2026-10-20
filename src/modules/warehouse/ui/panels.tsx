import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import type { PanelProps } from '@/modules/registry'
import { Field, SwitchRow } from '@/ui/Inputs'
import { Badge, Card, Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { TagInput } from '@/ui/TagInput'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { Button } from '@/ui/Button'
import {
  batchMovesOfBill, batchesOf, conversionsOf, daysToExpiry, formatUnits, isExpired, locationOptions, lineExt, receiptExt, ruleFor, serialsInStock, serialView, stockByLocation, variantName, kitOf, kitAvailable,
  type LineExt, type ReceiptExt, type ReceiptLineExt,
} from '../logic'
import { saveItemRule } from '../ops'
import { DateInput, LocationSelect, useData, whenLabel } from './common'
import { EXT } from '../hooks'

// ───────────────────────────── an item's page ─────────────────────────────

/** On the item page: how it is tracked, where it sits, its batches and bigger units. */
export function ItemPanel({ product, variants }: PanelProps['item']) {
  const { c } = useTheme()
  const router = useRouter()
  const data = useData()
  const canEdit = useCan('warehouse')
  const rule = data.itemRules[product.id]
  const convs = conversionsOf(data, product.id)
  const now = Date.now()

  function set(patch: Parameters<typeof saveItemRule>[2]) {
    try { perform((s, ctx) => saveItemRule(s, product.id, patch, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Section title="Warehouse" style={{ marginTop: 6 }}>
      <Card padded={false}>
        {canEdit ? (
          <>
            <SwitchRow title="Track batches and expiry" subtitle="Ask for a batch number and expiry when goods arrive" value={!!rule?.trackBatch} onChange={(v) => set({ trackBatch: v })} />
            <SwitchRow title="Track serial / IMEI numbers" subtitle="One number per unit, from receipt to sale" value={!!rule?.trackSerial} onChange={(v) => set({ trackSerial: v })} />
          </>
        ) : null}
        <View style={{ padding: 16, gap: 12 }}>
          {variants.map((v) => {
            const places = stockByLocation(data, v.id)
            const batches = batchesOf(data, v.id).filter((b) => b.qty > 0).sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity))
            const kit = kitOf(data, v.id)
            const base = product.unit || 'pc'
            return (
              <View key={v.id} style={{ gap: 4 }}>
                <T v="bodyStrong">{variantName(data, v.id)}</T>
                {kit ? <T v="caption" tone="mute">Kit of {kit.components.map((k) => `${k.qty} × ${variantName(data, k.variantId)}`).join(', ')} · {kitAvailable(data, kit)} can be made</T> : null}
                {places.length > 1 ? places.map((p) => <T key={p.locationId} v="caption" tone="soft">{p.name}: {formatUnits(p.qty, base, convs[0])}</T>) : <T v="caption" tone="mute">{formatUnits(v.stock, base, convs[0])}</T>}
                {batches.map((b) => {
                  const d = daysToExpiry(b, now)
                  return <T key={b.id} v="caption" tone={isExpired(b, now) ? 'danger' : d !== null && d <= 30 ? 'warning' : 'mute'}>Batch {b.batchNo}: {b.qty}{b.expiry ? ` · expires ${fmtDate(b.expiry)} (${whenLabel(d)})` : ''}</T>
                })}
              </View>
            )
          })}
          {convs.map((cv) => <T key={cv.id} v="caption" tone="soft">1 {cv.unit} = {cv.factor} {product.unit || 'pc'}{cv.price ? ` · ${inr(cv.price)} a ${cv.unit}` : ''}</T>)}
          {canEdit ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button label="Bigger units" kind="soft" size="sm" onPress={() => router.push({ pathname: '/m/warehouse/units', params: { productId: product.id } })} />
              <Button label="Batches" kind="soft" size="sm" onPress={() => router.push('/m/warehouse/batches')} />
            </View>
          ) : null}
          {!rule && !convs.length ? <T v="caption" tone="mute" style={{ color: c.inkMute }}>Not tracked by batch or serial number.</T> : null}
        </View>
      </Card>
    </Section>
  )
}

// ───────────────────────────── the line editor at the counter ─────────────────────────────

/** Under a cart line: batch (soonest expiry by default), serial numbers, where to take it from, and whole packs. */
export function LinePanel({ line, patch }: PanelProps['line']) {
  const data = useData()
  const canOverride = useCan('bigDiscount')
  const rule = ruleFor(data, line.variantId)
  const ext = lineExt(line)
  const kit = kitOf(data, line.variantId)
  const now = Date.now()
  const set = (next: Partial<LineExt>) => {
    const merged = { ...ext, ...next }
    for (const k of Object.keys(merged) as Array<keyof LineExt>) if (merged[k] === undefined || merged[k] === false || (Array.isArray(merged[k]) && !(merged[k] as unknown[]).length)) delete merged[k]
    patch({ ext: { ...(line.ext ?? {}), [EXT]: merged } })
  }
  const batches = rule?.trackBatch ? batchesOf(data, line.variantId).filter((b) => b.qty > 0).sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity)) : []
  const convs = line.productId ? conversionsOf(data, line.productId).filter((x) => x.price) : []
  const places = listOf(data.locations).some((l) => l.active) && !kit && !line.noStock ? stockByLocation(data, line.variantId) : []
  const serials = rule?.trackSerial ? serialsInStock(data, line.variantId) : []
  const anyExpired = batches.some((b) => isExpired(b, now))

  if (!batches.length && !rule?.trackSerial && !convs.length && places.length < 2 && !kit) return null
  return (
    <View style={{ gap: 14 }}>
      {kit ? <T v="caption" tone="mute">Kit: {kit.components.map((k) => `${k.qty} × ${variantName(data, k.variantId)}`).join(', ')}. The parts come off the shelf when you sell it.</T> : null}

      {batches.length ? (
        <View style={{ gap: 8 }}>
          <T v="label" tone="soft">BATCH</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Soonest expiry" selected={!ext.batchId} onPress={() => set({ batchId: undefined })} />
            {batches.map((b) => (
              <Chip key={b.id} label={`${b.batchNo} · ${b.qty}${b.expiry ? ` · ${fmtDate(b.expiry)}` : ''}${isExpired(b, now) ? ' · expired' : ''}`} selected={ext.batchId === b.id} tone={isExpired(b, now) ? 'danger' : undefined} onPress={() => set({ batchId: b.id })} />
            ))}
          </View>
          {anyExpired && canOverride ? <SwitchRow title="Sell past the expiry date" subtitle="Manager only — use for samples or returns to supplier" value={!!ext.allowExpired} onChange={(v) => set({ allowExpired: v })} /> : null}
        </View>
      ) : null}

      {rule?.trackSerial ? (
        <View style={{ gap: 8 }}>
          <TagInput label={`SERIAL / IMEI (${(ext.serials ?? []).length} of ${line.qty})`} value={ext.serials ?? []} onChange={(v) => set({ serials: v })} caps="characters" placeholder="Type or scan, then return" suggestions={serials.slice(0, 8).map((s) => s.serial)} />
          {!serials.length ? <T v="caption" tone="warning">No serial numbers are in stock for this item. Add them under Warehouse › Serial numbers.</T> : null}
        </View>
      ) : null}

      {places.length > 1 ? (
        <View style={{ gap: 8 }}>
          <T v="label" tone="soft">TAKE FROM</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {places.map((p) => <Chip key={p.locationId} label={`${p.name} · ${p.qty}`} selected={(ext.locationId ?? 'main') === p.locationId} onPress={() => set({ locationId: p.locationId === 'main' ? undefined : p.locationId })} />)}
          </View>
        </View>
      ) : null}

      {convs.length ? (
        <View style={{ gap: 8 }}>
          <T v="label" tone="soft">SELL IN PACKS</T>
          {convs.map((cv) => {
            const n = ext.packs?.unit === cv.unit ? ext.packs.n : 0
            const max = Math.floor(line.qty / cv.factor)
            return (
              <View key={cv.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <T v="body" style={{ flex: 1 }}>{cv.unit} of {cv.factor} · {inr(cv.price!)}</T>
                <Chip label="−" onPress={() => set({ packs: n > 1 ? { unit: cv.unit, n: n - 1 } : undefined })} />
                <T v="num">{Math.min(n, max)}</T>
                <Chip label="+" onPress={() => { if (n + 1 > max) patch({ qty: (n + 1) * cv.factor, ext: { ...(line.ext ?? {}), [EXT]: { ...ext, packs: { unit: cv.unit, n: n + 1 } } } }); else set({ packs: { unit: cv.unit, n: n + 1 } }) }} />
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

// ───────────────────────────── goods receipt ─────────────────────────────

/** Under the items of a goods receipt: batch + expiry, serial numbers, the location they go to, and a boxes helper. */
export function ReceiptPanel({ items, ext, setExt, setQty }: PanelProps['receipt']) {
  const data = useData()
  const cur: ReceiptExt = receiptExt({ ext })
  const hasLocations = locationOptions(data).length > 1
  const rows = items.filter((i) => data.variants[i.variantId])
  const tracked = rows.filter((i) => { const r = ruleFor(data, i.variantId); return r?.trackBatch || r?.trackSerial })
  const packable = rows.map((i) => ({ i, convs: conversionsOf(data, data.variants[i.variantId].productId) })).filter((x) => x.convs.length)
  if (!tracked.length && !hasLocations && !packable.length) return null

  const save = (next: ReceiptExt) => setExt(EXT, next)
  const lineOf = (variantId: string): ReceiptLineExt => cur.lines?.[variantId] ?? {}
  const setLine = (variantId: string, patch: Partial<ReceiptLineExt>) => save({ ...cur, lines: { ...(cur.lines ?? {}), [variantId]: { ...lineOf(variantId), ...patch } } })

  return (
    <Section title="Batches, serial numbers and place" style={{ marginTop: 18 }}>
      <View style={{ gap: 10 }}>
        {packable.map(({ i, convs }) => (
          <Card key={`pack-${i.variantId}`} style={{ gap: 8 }}>
            <T v="bodyStrong" numberOfLines={1}>{variantName(data, i.variantId)}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {convs.map((cv) => <Chip key={cv.id} label={`+1 ${cv.unit} (${cv.factor})`} onPress={() => setQty(i.variantId, Math.round((i.qty + cv.factor) * 1000) / 1000)} />)}
            </View>
            <T v="caption" tone="mute">{formatUnits(i.qty, data.products[data.variants[i.variantId].productId]?.unit || 'pc', convs[0])} received</T>
          </Card>
        ))}
        {tracked.map((i) => {
          const rule = ruleFor(data, i.variantId)!
          const l = lineOf(i.variantId)
          return (
            <Card key={i.variantId} style={{ gap: 10 }}>
              <T v="bodyStrong" numberOfLines={1}>{variantName(data, i.variantId)} · {i.qty}</T>
              {rule.trackBatch ? (
                <>
                  <Field label="Batch number" value={l.batchNo ?? ''} onChangeText={(t) => setLine(i.variantId, { batchNo: t })} autoCapitalize="characters" />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><DateInput label="Made on (optional)" value={l.mfgDate} onChange={(d) => setLine(i.variantId, { mfgDate: d })} /></View>
                    <View style={{ flex: 1 }}><DateInput label="Expires on" value={l.expiry} onChange={(d) => setLine(i.variantId, { expiry: d })} /></View>
                  </View>
                </>
              ) : null}
              {rule.trackSerial ? <TagInput label={`Serial / IMEI numbers (${(l.serials ?? []).length} of ${i.qty})`} value={l.serials ?? []} onChange={(v) => setLine(i.variantId, { serials: v })} caps="characters" placeholder="Type or scan, then return" /> : null}
            </Card>
          )
        })}
        {hasLocations ? <LocationSelect label="Put the goods in" value={cur.locationId ?? 'main'} onChange={(id) => save({ ...cur, locationId: id === 'main' ? undefined : id })} /> : null}
      </View>
    </Section>
  )
}

// ───────────────────────────── a bill ─────────────────────────────

/** On a bill: the batches and serial numbers it sold, and their warranty. */
export function BillPanel({ bill }: PanelProps['bill']) {
  const data = useData()
  const moves = batchMovesOfBill(data, bill.id).filter((m) => m.reason === 'sale')
  const serials = listOf(data.serials).filter((s) => s.billId === bill.id)
  const now = Date.now()
  if (!moves.length && !serials.length) return null
  return (
    <Section title="Batches and serial numbers" style={{ marginTop: 6 }}>
      <Card style={{ gap: 8 }}>
        {moves.map((m) => { const b = data.batches[m.batchId]; return <T key={m.id} v="body">{variantName(data, m.variantId)} · batch {b?.batchNo ?? '?'} × {-m.qty}{b?.expiry ? ` · exp ${fmtDate(b.expiry)}` : ''}</T> })}
        {serials.map((s) => {
          const v = serialView(data, s, now)
          return (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T v="body" style={{ flex: 1 }}>{v.name} · {s.serial}</T>
              {s.warrantyUntil ? <Badge tone={v.warranty.kind === 'active' ? 'success' : 'default'}>{v.warranty.kind === 'active' ? `Warranty to ${fmtDate(s.warrantyUntil)}` : 'Out of warranty'}</Badge> : null}
            </View>
          )
        })}
      </Card>
    </Section>
  )
}


import React, { useCallback, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { inr, inr0 } from '@/domain/money'
import { fmtQty, fmtQtyUnit, unitSuffix } from '@/domain/qty'
import { buildIndex, parseQuery, searchGroups, type ProductGroup } from '@/domain/search'
import { needsPricing, costFor } from '@/domain/pricing'
import { variantLabel } from '@/domain/codes'
import { lineDiscount } from '@/domain/cart'
import { DAY } from '@/domain/dates'
import type { Bill } from '@/domain/types'
import { findVariantByCode } from '@/data/lookup'
import { useLabels, useList, useStore, useVariantViews } from '@/data/hooks'
import { saveBill } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { addToCart, lineFor, useCart, useCartTotals } from '@/features/cart'
import { CustomerPicker } from '@/features/CustomerPicker'
import { LineEditor } from '@/features/LineEditor'
import { ParkedSheet } from '@/features/ParkedSheet'
import { VariantPicker } from '@/features/VariantPicker'
import { openScanner } from '@/features/scanBus'
import { Button, IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Tap } from '@/ui/primitives'
import { SearchBar, Stepper, type InputRef } from '@/ui/Inputs'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Pause, Plus, ReceiptText, ScanBarcode, Trash, UserPlus } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { soft } from '@/ui/feedback'
import { useTheme } from '@/ui/theme'

export default function Sell() {
  const { c, radius } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const store = useStore()
  const canPrice = useCan('bigDiscount')
  const userId = useApp((s) => s.session?.userId ?? '')
  const variants = useVariantViews()
  const customers = useList('customers')
  const bills = useList('bills')
  const lines = useCart((s) => s.lines)
  const customerId = useCart((s) => s.customerId)
  const heldId = useCart((s) => s.heldId)
  const totals = useCartTotals()
  const customer = customers.find((x) => x.id === customerId) ?? null
  const held = useMemo(() => bills.filter((b) => b.status === 'held').sort((a, b) => b.date - a.date), [bills])

  const [q, setQ] = useState('')
  const [picker, setPicker] = useState<ProductGroup | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [showCustomer, setShowCustomer] = useState(false)
  const [showHeld, setShowHeld] = useState(false)
  const searchRef = useRef<InputRef>(null)

  const index = useMemo(() => buildIndex(variants), [variants])
  const parsed = useMemo(() => parseQuery(q), [q])
  const results = useMemo(() => searchGroups(index, parsed.tokens, 12), [index, parsed.tokens])

  // What sold most lately — the tiles to tap when the cart is empty.
  const popular = useMemo(() => {
    const cutoff = Date.now() - 30 * DAY
    const vmap = new Map(variants.map((v) => [v.id, v]))
    const score = new Map<string, number>()
    for (const b of bills) {
      if (b.date < cutoff || b.total <= 0) continue
      for (const it of b.items) { const v = vmap.get(it.variantId); if (v) score.set(v.productId, (score.get(v.productId) ?? 0) + 1) }
    }
    const byProduct = new Map(index.map((g) => [g.id, g]))
    const ranked = [...byProduct.values()].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0))
    return ranked.filter((g) => g.variants.some((v) => !v.trackStock || v.stock > 0)).slice(0, 8)
  }, [bills, variants, index])

  const add = useCallback((variantId: string, qty?: number) => {
    const v = variants.find((x) => x.id === variantId)
    if (!v) return
    const r = addToCart(v, { qty, basis: store.costBasis, canPrice })
    if (!r.ok) { toast(r.message, 'err'); return }
    soft()
    if (r.unpriced) { setEditing(v.id); toast(`${v.productName} has no price in the system — type the price for this sale`, 'info') }
  }, [variants, store.costBasis, canPrice])

  function submit() {
    const code = parsed.term.trim()
    if (!code) return
    const v = findVariantByCode(useApp.getState().data, code)
    if (v) { add(v.id, parsed.qty !== 1 ? parsed.qty : undefined); setQ(''); return }
    if (results.length === 1 && results[0].variants.length === 1) { add(results[0].variants[0].id, parsed.qty !== 1 ? parsed.qty : undefined); setQ(''); return }
    if (!results.length) toast(`Nothing found for “${code}”`, 'err')
  }

  // A scanner that types (Bluetooth/USB) ends with Enter; a long numeric code can be added the moment it is complete.
  function onType(t: string) {
    setQ(t)
    if (/^\d{8,14}$/.test(t.trim())) {
      const v = findVariantByCode(useApp.getState().data, t)
      if (v) { add(v.id); setQ('') }
    }
  }

  function scan() {
    openScanner((code) => {
      const state = useApp.getState()
      const v = findVariantByCode(state.data, code)
      if (!v) return { ok: false, text: `No item for ${code}` }
      const r = addToCart(v, { basis: state.data.store?.costBasis, canPrice })
      if (!r.ok) return { ok: false, text: r.message }
      return { ok: true, text: `Added ${v.productName}${variantLabel(v.size, v.color) ? ` · ${variantLabel(v.size, v.color)}` : ''}` }
    }, { title: `Scan to ${labels.newSale.toLowerCase()}`, hint: 'Keep scanning — each item is added' })
    router.push('/scan')
  }

  function hold() {
    if (!lines.length) return
    const heldInput = {
      date: Date.now(), customerId, items: totals.items.map((it, i) => ({ ...it, soldBy: lines[i]?.staffId ?? (useCart.getState().staffId || userId) })),
      grossMrp: totals.grossMrp, itemDiscount: totals.itemDiscount, billDiscountType: useCart.getState().billDiscountType, billDiscountValue: useCart.getState().billDiscountValue,
      billDiscount: totals.billDiscount, coupon: useCart.getState().coupon, subtotal: totals.subtotal, taxableTotal: totals.taxableTotal, cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal, taxTotal: totals.taxTotal, roundOff: totals.roundOff, total: totals.total, payments: [], paid: 0, changeDue: 0, loyaltyEarned: 0,
      loyaltyRedeemed: 0, creditUsed: 0, cashierId: userId, soldBy: useCart.getState().staffId || userId, status: 'held' as const, notes: 'Parked bill',
    }
    const r = perform((s, ctx) => saveBill(s, heldInput, ctx, { heldId: heldId ?? undefined }))
    toast(`Parked as ${r.bill.no}`, 'ok')
    useCart.getState().clear()
  }

  function resume(b: Bill) {
    const restored = b.items.map((it) => {
      const v = variants.find((x) => x.id === it.variantId)
      const base = v ? lineFor(v, store.costBasis, it.qty) : null
      return {
        ...(base ?? { variantId: it.variantId, sku: it.sku, barcode: it.barcode, name: it.name, size: it.size, color: it.color, hsn: it.hsn, mrp: it.mrp, price: it.price, qty: it.qty, stock: it.qty, discountType: it.discountType, discountValue: 0, unit: it.unit }),
        price: it.unpricedSale && v && v.price > 0 ? v.price : it.price, qty: it.qty, discountType: it.discountType, discountValue: it.discountValue,
        ...(it.unpricedSale && !(v && v.price > 0) ? { unpricedSale: true } : {}),
        staffId: it.soldBy && it.soldBy !== (b.soldBy ?? b.cashierId) ? it.soldBy : undefined,
      }
    })
    useCart.getState().setLines(restored)
    useCart.getState().set({ customerId: b.customerId, billDiscountType: b.billDiscountType, billDiscountValue: b.billDiscountValue, coupon: b.coupon, staffId: b.soldBy ?? b.cashierId, heldId: b.id })
    toast(`Resumed ${b.no}`, 'ok')
  }

  async function clearCart() {
    if (!lines.length) return
    if (await ask({ title: 'Clear this bill?', message: 'All items on it will be removed.', confirm: 'Clear', danger: true })) useCart.getState().clear()
  }

  // Leaving the screen with the keyboard up should not strand a search.
  useFocusEffect(useCallback(() => () => setQ(''), []))

  const searching = parsed.tokens.join('').length >= 2
  const itemCount = lines.length
  const unitsLabel = lines.every((l) => unitSuffix(l) === '') ? `${fmtQty(totals.qtyTotal)} ${totals.qtyTotal === 1 ? 'unit' : 'units'}` : 'mixed units'

  return (
    <Screen
      large title={labels.newSale} subtitle={customer ? `${customer.name}${customer.loyaltyPoints ? ` · ${customer.loyaltyPoints} pts` : ''}` : 'Walk-in'}
      right={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View>
            <IconButton label="Parked bills" onPress={() => setShowHeld(true)}><Pause size={19} color={c.ink} /></IconButton>
            {held.length ? <View style={{ position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><T v="micro" style={{ color: '#fff' }} fixed>{held.length}</T></View> : null}
          </View>
          {lines.length ? <IconButton label="Clear bill" onPress={clearCart}><Trash size={19} color={c.danger} /></IconButton> : null}
        </View>
      }
      scroll={false}
      footer={lines.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T v="caption" tone="mute">{itemCount} {itemCount === 1 ? 'line' : 'lines'} · {unitsLabel}</T>
            <T v="display" style={{ fontSize: 28, lineHeight: 34 }}>{inr(totals.total, 0)}</T>
          </View>
          <Button label="Hold" kind="soft" onPress={hold} />
          <Button label="Charge" size="lg" iconRight={<ChevronRight size={20} color="#fff" />} onPress={() => router.push('/sell/checkout')} />
        </View>
      ) : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, gap: 14 }}>
        <SearchBar value={q} onChange={onType} onSubmit={submit} inputRef={searchRef} placeholder={`Scan or search ${labels.items.toLowerCase()}`}
          right={<IconButton label="Scan barcode" tone="dark" size={48} onPress={scan}><ScanBarcode size={22} color={c.bg} /></IconButton>} />

        {searching ? (
          <View style={{ gap: 12 }}>
            {parsed.qty !== 1 ? <Badge tone="primary">Adding {fmtQty(parsed.qty)} of each</Badge> : null}
            {!results.length ? <EmptyState compact icon={<ScanBarcode size={24} color={c.primary} />} title="Nothing found" hint="Check the spelling, or scan the barcode." /> : null}
            {results.map((r) => {
              const single = r.variants.length === 1
              const many = r.variants.length > 8
              const body = (
                <View style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T v="bodyStrong" numberOfLines={2}>{r.group.name}</T>
                      <T v="caption" tone="mute" numberOfLines={1}>{[r.group.brand, r.group.styleCode].filter(Boolean).join(' · ')}</T>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <T v="num">{r.minPrice === r.maxPrice ? inr0(r.minPrice) : `${inr0(r.minPrice)}–${inr0(r.maxPrice)}`}</T>
                      {r.variants.some((v) => v.trackStock) ? <Badge tone={r.totalStock > 0 ? 'success' : 'danger'}>{r.totalStock > 0 ? `${fmtQtyUnit(r.totalStock, r.variants[0])} in stock` : 'Sold out'}</Badge> : null}
                    </View>
                  </View>
                  {!single ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {(many ? r.variants.slice(0, 7) : r.variants).map((v) => {
                        const out = v.trackStock && v.stock <= 0
                        return (
                          <Tap key={v.id} disabled={out} onPress={() => add(v.id, parsed.qty !== 1 ? parsed.qty : undefined)}
                            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: out ? c.sunken : c.surface, gap: 1 }}>
                            <T v="bodyStrong" style={{ fontSize: 13.5 }} numberOfLines={1}>{variantLabel(v.size, v.color) || 'Standard'}</T>
                            <T v="micro" tone={out ? 'danger' : needsPricing(v) ? 'warning' : 'mute'}>{out ? 'Out' : needsPricing(v) ? 'No price' : v.trackStock ? `${fmtQtyUnit(v.stock, v)} left` : inr0(v.price)}</T>
                          </Tap>
                        )
                      })}
                      {many ? <Tap onPress={() => setPicker(r.group)} style={{ paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.md, backgroundColor: c.primaryTint }}><T v="bodyStrong" tone="primary" style={{ fontSize: 13.5 }}>+{r.variants.length - 7} more</T></Tap> : null}
                    </View>
                  ) : null}
                </View>
              )
              return single ? (
                <Card key={r.group.id} onPress={() => add(r.variants[0].id, parsed.qty !== 1 ? parsed.qty : undefined)}>{body}</Card>
              ) : <Card key={r.group.id}>{body}</Card>
            })}
          </View>
        ) : (
          <>
            {/* Customer */}
            <Tap onPress={() => setShowCustomer(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderStyle: customer ? 'solid' : 'dashed', borderColor: customer ? c.line : c.lineStrong, backgroundColor: customer ? c.surface : 'transparent' }}>
              {customer ? <Avatar name={customer.name} size={38} /> : <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={18} color={c.primary} /></View>}
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{customer ? customer.name : `Add ${labels.customer.toLowerCase()}`}</T>
                <T v="caption" tone="mute">{customer ? `${customer.phone}${customer.storeCredit ? ` · ${inr0(customer.storeCredit)} credit` : ''}` : 'For loyalty points and purchase history'}</T>
              </View>
              <ChevronRight size={18} color={c.inkMute} />
            </Tap>

            {!lines.length ? (
              <View style={{ gap: 12 }}>
                <T v="h2">Quick picks</T>
                {popular.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {popular.map((g) => {
                      const price = Math.min(...g.variants.map((v) => v.price).filter((p) => p > 0), Infinity)
                      return (
                        <Tap key={g.id} onPress={() => (g.variants.length === 1 ? add(g.variants[0].id) : setPicker(g))} style={{ width: '48%', flexGrow: 1, padding: 14, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, gap: 4, minHeight: 84 }}>
                          <T v="bodyStrong" numberOfLines={2} style={{ fontSize: 14 }}>{g.name}</T>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                            <T v="num" tone="primary">{Number.isFinite(price) ? inr0(price) : '—'}</T>
                            {g.variants.length > 1 ? <T v="micro" tone="mute">{g.variants.length} options</T> : <Plus size={16} color={c.primary} />}
                          </View>
                        </Tap>
                      )
                    })}
                  </View>
                ) : <EmptyState icon={<ReceiptText size={26} color={c.primary} />} title={`Add ${labels.items.toLowerCase()} first`} hint="Your catalogue is empty." action={`Add ${labels.item.toLowerCase()}`} onAction={() => router.push('/items/new')} />}
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <T v="h2">Cart</T>
                {lines.map((l) => {
                  const disc = lineDiscount(l)
                  const li = totals.items.find((i) => i.variantId === l.variantId)
                  return (
                    <Card key={l.variantId} padded={false}>
                      <Tap onPress={() => setEditing(l.variantId)} style={{ padding: 14, gap: 10 }}>
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <T v="bodyStrong" numberOfLines={2}>{l.name}</T>
                            <T v="caption" tone="mute" numberOfLines={1}>{[variantLabel(l.size, l.color), l.sku].filter(Boolean).join(' · ')}</T>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <T v="num">{inr(li?.lineTotal ?? l.price * l.qty, 0)}</T>
                            {disc > 0 ? <T v="micro" tone="success">−{inr0(disc)}</T> : null}
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                            {l.unpricedSale && !(l.price > 0) ? <Badge tone="warning">Set price</Badge> : <T v="caption" tone="soft">{inr(l.price)}{l.unit && l.unit !== 'pc' ? ` / ${unitSuffix(l).trim()}` : ''}</T>}
                            {l.priceOverridden ? <Badge tone="accent">Price changed</Badge> : null}
                          </View>
                          <Stepper compact value={l.qty} rules={l} min={0} max={l.noStock ? undefined : l.stock}
                            onChange={(n) => { if (n <= 0) useCart.getState().remove(l.variantId); else useCart.getState().patchLine(l.variantId, { qty: n }) }} />
                        </View>
                      </Tap>
                    </Card>
                  )
                })}
                <Button label={`Add more ${labels.items.toLowerCase()}`} kind="soft" size="sm" icon={<Plus size={16} color={c.primary} />} onPress={() => searchRef.current?.focus()} />
              </View>
            )}
          </>
        )}
      </ScrollView>

      <VariantPicker group={picker} visible={!!picker} onClose={() => setPicker(null)} onAdd={(id) => add(id)} />
      <LineEditor variantId={editing} onClose={() => setEditing(null)} />
      <CustomerPicker visible={showCustomer} onClose={() => setShowCustomer(false)} selectedId={customerId} onPick={(cu) => useCart.getState().set({ customerId: cu?.id ?? null })} />
      <ParkedSheet visible={showHeld} bills={held} onClose={() => setShowHeld(false)} onResume={resume} />
    </Screen>
  )
}

void costFor

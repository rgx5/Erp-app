import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Platform, Pressable, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { cashSuggestions, finalPayments, pointsEarned, settle } from '@/domain/checkout'
import { inr, inr0, round2 } from '@/domain/money'
import { fmtQty, fmtQtyUnit, unitSuffix } from '@/domain/qty'
import { buildIndex, parseQuery, searchGroups, type ProductGroup, type SearchResult } from '@/domain/search'
import { variantLabel } from '@/domain/codes'
import { lineDiscount, type CartLine } from '@/domain/cart'
import { DAY, fmtDateTime } from '@/domain/dates'
import { billPrintHtml, paymentSummary, receiptText } from '@/domain/receipt'
import type { Bill, Customer, PayMode } from '@/domain/types'
import { findVariantByCode } from '@/data/lookup'
import { useLabels, useList, useStore, useVariantViews } from '@/data/hooks'
import { saveBill } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { addToCart, lineFor, useCart, useCartTotals } from '@/features/cart'
import { CustomerPicker } from '@/features/CustomerPicker'
import { VariantPicker } from '@/features/VariantPicker'
import { openScanner } from '@/features/scanBus'
import { printHtml, whatsApp } from '@/features/share'
import { useFocusMode } from '@/features/focusMode'
import { Stepper, type InputRef } from '@/ui/Inputs'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { ask, toast } from '@/ui/overlays'
import { soft, success } from '@/ui/feedback'
import { Banknote, Check, Close, CreditCard, Maximize, Minimize, Pause, Phone, Printer, Scan, Search as SearchIcon, Share, Trash, UserPlus } from '@/ui/icons'
import { receiptAddOns, paymentMethodList } from '@/modules/registry'
import { DataTable, DeskButton, DeskPage, KeyHint, Pill, SplitPane, Toolbar, cellNum, cellText, dtext } from './kit'

/**
 * The desktop POS: a keyboard-first counter, not a stretched phone screen. Left pane is search/catalogue (type or
 * scan, Enter adds), right pane is the running cart with a dense totals block and Hold/Charge. Every function that
 * actually rings up a sale — `addToCart`, `patchLine`, `saveBill`, `findVariantByCode` — is the exact one the phone
 * screen uses (`src/app/(tabs)/sell.tsx`); this file only re-lays-out the UI and adds a few real keyboard shortcuts.
 */
export function DesktopPos() {
  const { c } = useTheme()
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
  const [showCustomer, setShowCustomer] = useState(false)
  const [showHeld, setShowHeld] = useState(false)
  const [charging, setCharging] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const focusMode = useFocusMode((s) => s.on)
  const searchRef = useRef<InputRef>(null)

  // The sidebar belongs to the whole app, not to one screen, so leaving the counter — however that happens —
  // always gives it back rather than leaving some other screen stuck full-width.
  useEffect(() => () => useFocusMode.getState().set(false), [])

  const index = useMemo(() => buildIndex(variants), [variants])
  const parsed = useMemo(() => parseQuery(q), [q])
  const results = useMemo(() => searchGroups(index, parsed.tokens, 12), [index, parsed.tokens])

  // What sold most lately — identical scoring to the phone's "Quick picks" (copied, not re-derived).
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
    return ranked.filter((g) => g.variants.some((v) => !v.trackStock || v.stock > 0)).slice(0, 20)
  }, [bills, variants, index])

  const add = useCallback((variantId: string, qty?: number) => {
    const v = variants.find((x) => x.id === variantId)
    if (!v) return
    const r = addToCart(v, { qty, basis: store.costBasis, canPrice })
    if (!r.ok) { toast(r.message, 'err'); return }
    soft()
    if (r.unpriced) toast(`${v.productName} has no price in the system — type the price for this sale`, 'info')
  }, [variants, store.costBasis, canPrice])

  // Ground truth for the search box — same barcode/SKU lookup, same "one result, one variant" shortcut as mobile.
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

  // Enter in an empty search box rings the sale up — the keyboard-only path to Charge when nothing is left to add.
  function onSearchSubmit() {
    if (!parsed.term.trim()) { if (lines.length) setCharging(true); return }
    submit()
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

  // Leaving the screen with a half-typed search should not strand it.
  useFocusEffect(useCallback(() => () => setQ(''), []))

  // Real, wired shortcuts — not decoration. F2/F4 are page-level (RNW only: there is no `window` on native, so this
  // never runs off-web); Enter and Escape are ordinary TextInput events, which React Native Web fires for every key
  // on web (not just the handful iOS honours), so they work the same way in the Electron shell.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'F4' && lines.length) { e.preventDefault(); setCharging(true) }
      else if (e.key === 'F11') { e.preventDefault(); useFocusMode.getState().set(!useFocusMode.getState().on) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lines.length])

  // A search row's click mirrors the mobile Card's onPress: one variant adds it straight away, several open the picker.
  function onResultPress(r: SearchResult) {
    if (r.variants.length === 1) { add(r.variants[0].id, parsed.qty !== 1 ? parsed.qty : undefined); setQ('') }
    else setPicker(r.group)
  }

  const searching = parsed.tokens.join('').length >= 2
  const itemCount = lines.length
  const unitsLabel = lines.every((l) => unitSuffix(l) === '') ? `${fmtQty(totals.qtyTotal)} ${totals.qtyTotal === 1 ? 'unit' : 'units'}` : 'mixed units'

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={labels.newSale}
          subtitle={customer ? `${customer.name}${customer.loyaltyPoints ? ` · ${customer.loyaltyPoints} pts` : ''}` : 'Walk-in'}
          right={
            <>
              <DeskButton label={customer ? customer.name : 'Customer'} icon={<UserPlus size={14} color={c.ink} />} onPress={() => setShowCustomer(true)} />
              <DeskButton label={held.length ? `Parked (${held.length})` : 'Parked'} icon={<Pause size={14} color={c.ink} />} onPress={() => setShowHeld(true)} />
              {lines.length ? <DeskButton label="Clear" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={clearCart} /> : null}
              <DeskButton
                label={focusMode ? 'Exit full screen' : 'Full screen'}
                hint="F11"
                icon={focusMode ? <Minimize size={14} color={c.ink} /> : <Maximize size={14} color={c.ink} />}
                onPress={() => useFocusMode.getState().set(!focusMode)}
              />
            </>
          }
        />
      }
    >
      <SplitPane widths={['flex', 420]}>
        {/* Left: search / catalogue */}
        <View style={{ flex: 1 }}>
          <View style={{ padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surface }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 14, borderRadius: 8,
                borderWidth: 1.5, borderColor: searchFocused ? c.primary : c.lineStrong, backgroundColor: c.bg,
              }}>
                <SearchIcon size={17} color={searchFocused ? c.primary : c.inkMute} />
                <TextInput
                  ref={searchRef}
                  value={q}
                  onChangeText={onType}
                  onSubmitEditing={onSearchSubmit}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onKeyPress={(e) => { if (e.nativeEvent.key === 'Escape') setQ('') }}
                  placeholder={`Scan or search ${labels.items.toLowerCase()} — name, SKU or barcode`}
                  placeholderTextColor={c.inkMute}
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 14.5, paddingVertical: 0, outlineWidth: 0 }}
                />
                {q ? <Pressable onPress={() => setQ('')} accessibilityLabel="Clear search"><Close size={16} color={c.inkMute} /></Pressable> : <KeyHint k="ESC" />}
              </View>
              <KeyHint k="F2" />
              <DeskButton label="Scan" icon={<Scan size={14} color={c.ink} />} onPress={scan} />
            </View>
            {parsed.qty !== 1 ? <Pill tone="primary" label={`Adding ${fmtQty(parsed.qty)} of each`} /> : null}
          </View>

          <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            {searching ? (
              <DataTable
                emptyLabel={`Nothing found for “${parsed.term}”`}
                rows={results.map((r) => ({ id: r.group.id, ...r }))}
                onRowPress={onResultPress}
                columns={[
                  { key: 'name', label: 'Item', render: (r) => (
                    <View style={{ gap: 1 }}>
                      <T style={dtext.cellStrong} numberOfLines={1}>{r.group.name}</T>
                      <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[r.group.brand, r.group.styleCode].filter(Boolean).join(' · ')}</T>
                    </View>
                  ) },
                  { key: 'opt', label: 'Options', width: 110, render: (r) => cellText(r.variants.length > 1 ? `${r.variants.length} options` : r.variants[0]?.sku || '—') },
                  { key: 'price', label: 'Price', width: 110, align: 'right', render: (r) => cellNum(r.minPrice === r.maxPrice ? inr0(r.minPrice) : `${inr0(r.minPrice)}–${inr0(r.maxPrice)}`) },
                  { key: 'stock', label: 'Stock', width: 110, align: 'right', render: (r) => r.variants.some((v) => v.trackStock) ? <Pill tone={r.totalStock > 0 ? 'success' : 'danger'} label={r.totalStock > 0 ? fmtQtyUnit(r.totalStock, r.variants[0]) : 'Out'} /> : cellText('—') },
                ]}
              />
            ) : (
              <DataTable
                emptyLabel="No sales yet — your catalogue will show its best sellers here"
                rows={popular.map((g) => ({ id: g.id, g }))}
                onRowPress={({ g }) => (g.variants.length === 1 ? add(g.variants[0].id) : setPicker(g))}
                columns={[
                  { key: 'name', label: 'Popular items — click to add', render: ({ g }) => cellText(g.name) },
                  { key: 'price', label: 'Price', width: 110, align: 'right', render: ({ g }) => {
                    const price = Math.min(...g.variants.map((v) => v.price).filter((p) => p > 0), Infinity)
                    return cellNum(Number.isFinite(price) ? inr0(price) : '—')
                  } },
                  { key: 'stock', label: 'Stock', width: 110, align: 'right', render: ({ g }) => {
                    const tracked = g.variants.filter((v) => v.trackStock)
                    if (!tracked.length) return cellText('—')
                    const total = tracked.reduce((s, v) => s + Math.max(0, v.stock), 0)
                    return <Pill tone={total > 0 ? 'success' : 'danger'} label={total > 0 ? fmtQtyUnit(total, tracked[0]) : 'Out'} />
                  } },
                ]}
              />
            )}
          </View>
        </View>

        {/* Right: running cart */}
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, margin: 14, marginBottom: 0, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              emptyLabel="Cart is empty — scan or search on the left to start a bill"
              rows={lines.map((l) => ({ ...l, id: l.variantId }))}
              columns={[
                { key: 'name', label: 'Item', render: (l) => {
                  const disc = lineDiscount(l)
                  const unpriced = l.unpricedSale && !(l.price > 0)
                  return (
                    <View style={{ gap: 1 }}>
                      <T style={dtext.cellStrong} numberOfLines={1}>{l.name}</T>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[variantLabel(l.size, l.color), l.sku].filter(Boolean).join(' · ')}</T>
                        {unpriced ? <Pill tone="warning" label="Set price" /> : null}
                        {disc > 0 ? <Pill tone="success" label={`−${inr0(disc)}`} /> : null}
                      </View>
                    </View>
                  )
                } },
                { key: 'qty', label: 'Qty', width: 110, align: 'right', render: (l) => (
                  <Stepper compact value={l.qty} rules={l} min={0} max={l.noStock ? undefined : l.stock}
                    onChange={(n) => { if (n <= 0) useCart.getState().remove(l.variantId); else useCart.getState().patchLine(l.variantId, { qty: n }) }} />
                ) },
                { key: 'price', label: 'Price', width: 86, align: 'right', render: (l) => <PriceCell line={l} locked={!canPrice && !l.unpricedSale} /> },
                { key: 'total', label: 'Total', width: 96, align: 'right', render: (l) => {
                  const li = totals.items.find((i) => i.variantId === l.variantId)
                  return cellNum(inr(li?.lineTotal ?? l.price * l.qty, 0), true)
                } },
                { key: 'rm', label: '', width: 32, align: 'center', render: (l) => (
                  <Pressable onPress={() => useCart.getState().remove(l.variantId)} hitSlop={8} accessibilityLabel="Remove">
                    <Trash size={14} color={c.danger} />
                  </Pressable>
                ) },
              ]}
            />
          </View>

          <View style={{ margin: 14, padding: 16, gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T style={[dtext.tiny, { color: c.inkMute }]}>{itemCount} {itemCount === 1 ? 'line' : 'lines'} · {unitsLabel}</T>
              {totals.itemDiscount + totals.billDiscount > 0 ? <T style={[dtext.tiny, { color: c.success }]}>Saved {inr0(totals.itemDiscount + totals.billDiscount)}</T> : null}
            </View>
            {totals.taxTotal > 0 ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T style={[dtext.cell, { color: c.inkMute }]}>Tax</T>
                <T style={dtext.cell}>{inr(totals.taxTotal)}</T>
              </View>
            ) : null}
            <View style={{ height: 1, backgroundColor: c.line }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T style={dtext.title}>Total</T>
              <T style={dtext.kpi}>{inr(totals.total, 0)}</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
              <View style={{ flex: 1 }}><DeskButton label="Hold" onPress={hold} disabled={!lines.length} /></View>
              <View style={{ flex: 1 }}><DeskButton label="Charge" tone="primary" hint="F4" onPress={() => setCharging(true)} disabled={!lines.length} /></View>
            </View>
          </View>
        </View>
      </SplitPane>

      <VariantPicker group={picker} visible={!!picker} onClose={() => setPicker(null)} onAdd={(id) => add(id)} />
      <CustomerPicker visible={showCustomer} onClose={() => setShowCustomer(false)} selectedId={customerId} onPick={(cu) => useCart.getState().set({ customerId: cu?.id ?? null })} />
      <HeldBills visible={showHeld} bills={held} onClose={() => setShowHeld(false)} onResume={(b) => { resume(b); setShowHeld(false) }} />
      <ChargePanel visible={charging} onClose={() => setCharging(false)} customer={customer} onRefocus={() => searchRef.current?.focus()} />
    </DeskPage>
  )
}

/**
 * Payment and printing, without ever leaving the counter screen — the thing `/sell/checkout` + `/sell/done` cost two
 * screen changes and a dozen taps for. Covers the common case (cash/UPI/card, one tender, this shop's usual loyalty
 * and store-credit rules) in the fewest clicks the money math allows: open with Cash and the exact amount already
 * selected, so a plain cash sale is one click (Charge) once the panel is up. A coupon, a bill discount, a split
 * across several modes, or a different seller are real but rarer needs — "More options" still goes to the full
 * `/sell/checkout` screen for those, rather than this panel trying to be that screen.
 *
 * The money logic is the exact `settle`/`finalPayments`/`saveBill` triplet `/sell/checkout` itself calls — nothing
 * about how a bill is priced, taxed, or paid is re-derived here, only the screen it happens on.
 */
function ChargePanel({ visible, onClose, customer, onRefocus }: { visible: boolean; onClose: () => void; customer: Customer | null; onRefocus: () => void }) {
  const { c, radius } = useTheme()
  const router = useRouter()
  const store = useStore()
  const userId = useApp((s) => s.session?.userId ?? '')
  const cart = useCart()
  const totals = useCartTotals()
  const total = totals.total
  const appState = useApp((s) => s.data)

  const [mode, setMode] = useState<PayMode>('cash')
  const [tendered, setTendered] = useState('')
  const [redeemPts, setRedeemPts] = useState(0)
  const [useCredit, setUseCredit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<Bill | null>(null)

  // Reset to a clean "about to charge" state each time the panel opens, for the next sale.
  useEffect(() => {
    if (visible) { setMode('cash'); setTendered(''); setRedeemPts(0); setUseCredit(false); setSaving(false); setDone(null) }
  }, [visible])

  const modes = useMemo(() => [
    { mode: 'cash' as PayMode, label: 'Cash', icon: Banknote },
    { mode: 'upi' as PayMode, label: 'UPI', icon: Phone },
    { mode: 'card' as PayMode, label: 'Card', icon: CreditCard },
    ...paymentMethodList()
      .filter((m) => !m.enabled || m.enabled(appState, { state: appState, customerId: cart.customerId, extras: cart.extras }))
      .map((m) => ({ mode: m.id as PayMode, label: m.label, icon: m.icon })),
  ], [appState, cart.customerId, cart.extras])

  const st = settle({ total, customer, loyaltyValue: store.loyaltyRedeemValue, redeemPts, useCredit, split: [], mode, tendered })
  const isCash = mode === 'cash'
  const quick = isCash ? cashSuggestions(st.remaining) : []

  function charge() {
    if (saving || total <= 0 || !st.covers) return
    setSaving(true)
    try {
      const payments = finalPayments({ total, customer, loyaltyValue: store.loyaltyRedeemValue, redeemPts, useCredit, split: [], mode, tendered }, st)
      const paid = round2(payments.reduce((s, p) => s + p.amount, 0))
      const r = perform((s, ctx) => saveBill(s, {
        date: ctx.now, customerId: cart.customerId, items: totals.items.map((it, i) => ({ ...it, soldBy: cart.lines[i]?.staffId || cart.staffId || userId })),
        grossMrp: totals.grossMrp, itemDiscount: totals.itemDiscount, billDiscountType: cart.billDiscountType, billDiscountValue: cart.billDiscountValue,
        billDiscount: totals.billDiscount, coupon: cart.coupon, subtotal: totals.subtotal, taxableTotal: totals.taxableTotal, cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal, ...(totals.igstTotal !== undefined ? { igstTotal: totals.igstTotal } : {}), taxTotal: totals.taxTotal, roundOff: totals.roundOff, total, payments, paid, changeDue: st.change,
        loyaltyEarned: customer ? pointsEarned(total, store.loyaltyEarnPct) : 0, loyaltyRedeemed: st.pts, creditUsed: st.creditUsed,
        cashierId: userId, soldBy: cart.staffId || userId, status: 'paid', notes: '',
        ...(Object.keys(cart.extras).length ? { ext: cart.extras } : {}),
      }, ctx, { heldId: cart.heldId ?? undefined }))
      cart.clear()
      setDone(r.bill)
      if (store.autoPrintOnSale) void printHtml(billPrintHtml({ bill: r.bill, store, customer, seller: appState.users[r.bill.soldBy ?? r.bill.cashierId] ?? null, extras: receiptAddOns(r.bill, appState) }))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the bill', 'err')
    } finally {
      setSaving(false)
    }
  }

  function newSale() {
    onClose()
    setTimeout(onRefocus, 0) // after the modal has actually closed, so focus lands in the search box, not the panel
  }

  if (!visible) return null
  const docCtx = done ? { bill: done, store, customer, seller: appState.users[done.soldBy ?? done.cashierId] ?? null, extras: receiptAddOns(done, appState) } : null

  return (
    <Modal visible transparent animationType="fade" onRequestClose={done ? newSale : onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center' }} onPress={done ? undefined : onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: 400, backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
          {done && docCtx ? (
            <View style={{ padding: 20, gap: 14, alignItems: 'center' }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center' }}>
                <Check size={28} color="#fff" strokeWidth={3} />
              </View>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <T style={[dtext.tiny, { color: c.inkMute }]}>PAYMENT RECEIVED</T>
                <T style={dtext.kpi}>{inr(done.total, 0)}</T>
                <T style={[dtext.tiny, { color: c.inkMute }]}>{done.no} · {paymentSummary(done)}</T>
              </View>
              {done.changeDue > 0 ? (
                <View style={{ width: '100%', padding: 12, borderRadius: radius.md, backgroundColor: c.warningTint, alignItems: 'center' }}>
                  <T style={[dtext.tiny, { color: c.warning }]}>CHANGE DUE</T>
                  <T style={[dtext.numStrong, { color: c.warning, fontSize: 18 }]}>{inr(done.changeDue)}</T>
                </View>
              ) : null}
              {store.autoPrintOnSale ? <T style={[dtext.tiny, { color: c.inkMute }]}>Printed automatically</T> : null}
              <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                <View style={{ flex: 1 }}><DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={() => void printHtml(billPrintHtml(docCtx))} /></View>
                {customer?.phone ? <View style={{ flex: 1 }}><DeskButton label="WhatsApp" icon={<Share size={14} color={c.ink} />} onPress={() => void whatsApp(receiptText(docCtx), customer.phone)} /></View> : null}
              </View>
              <View style={{ width: '100%' }}><DeskButton label="New sale" tone="primary" hint="Esc" onPress={newSale} /></View>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 48, borderBottomWidth: 1, borderBottomColor: c.line }}>
                <T style={dtext.title}>Charge</T>
                <View style={{ flex: 1 }} />
                <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}><Close size={18} color={c.inkMute} /></Pressable>
              </View>
              <View style={{ padding: 16, gap: 12 }}>
                <View style={{ borderRadius: radius.lg, padding: 16, backgroundColor: c.ink, alignItems: 'center', gap: 2 }}>
                  <T style={[dtext.tiny, { color: c.bg, opacity: 0.7 }]}>AMOUNT DUE</T>
                  <T style={[dtext.kpi, { color: c.bg, fontSize: 30 }]}>{inr(st.remaining, 2)}</T>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {modes.map((m) => {
                    const on = mode === m.mode
                    return (
                      <Pressable key={m.mode} onPress={() => { setMode(m.mode); setTendered('') }} style={{ flexGrow: 1, minWidth: 90, height: 42, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: on ? c.primary : c.bg, borderWidth: 1, borderColor: on ? c.primary : c.lineStrong }}>
                        <m.icon size={15} color={on ? c.onPrimary : c.inkSoft} />
                        <T style={[dtext.cellStrong, { color: on ? c.onPrimary : c.ink }]}>{m.label}</T>
                      </Pressable>
                    )
                  })}
                </View>

                {isCash ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      value={tendered}
                      onChangeText={setTendered}
                      placeholder={`Exact — ${inr0(st.remaining)}`}
                      placeholderTextColor={c.inkMute}
                      keyboardType="decimal-pad"
                      style={{ height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: c.lineStrong, paddingHorizontal: 12, color: c.ink, fontFamily: fonts.displayMedium, fontSize: 16, outlineWidth: 0 }}
                    />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {quick.map((n) => <Pill key={n} tone={Number(tendered) === n ? 'primary' : 'default'} label={inr0(n)} />)}
                    </View>
                  </View>
                ) : null}

                {customer && (customer.storeCredit > 0 || (customer.loyaltyPoints > 0 && store.loyaltyRedeemValue > 0)) ? (
                  <View style={{ gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: c.sunken }}>
                    {customer.storeCredit > 0 ? (
                      <Pressable onPress={() => setUseCredit(!useCredit)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Check size={14} color={useCredit ? c.primary : c.inkMute} />
                        <T style={dtext.cell}>Use store credit · {inr0(customer.storeCredit)}</T>
                      </Pressable>
                    ) : null}
                    {customer.loyaltyPoints > 0 && store.loyaltyRedeemValue > 0 ? (
                      <Pressable onPress={() => setRedeemPts(st.maxPts)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Check size={14} color={st.pts > 0 ? c.primary : c.inkMute} />
                        <T style={dtext.cell}>Redeem {st.maxPts} points · {inr0(st.maxPts * store.loyaltyRedeemValue)}</T>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {st.shortBy > 0 ? <T style={[dtext.cell, { color: c.danger }]}>Short by {inr(st.shortBy)}</T> : st.change > 0 ? <T style={[dtext.cell, { color: c.warning }]}>Change to return {inr(st.change)}</T> : null}

                <DeskButton label={`Charge ${inr(total, 0)}`} tone="primary" disabled={!st.covers || saving} onPress={charge} />
                <Pressable onPress={() => { onClose(); router.push('/sell/checkout') }}><T style={[dtext.tiny, { color: c.primary, textAlign: 'center' }]}>More options (coupon, split payment, discount)</T></Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/** The cart's price cell: a plain figure once a manager has priced the item (or a cashier has no pricing right), an
 * editable field while it still needs one. Tracks its own text so a half-typed number is not clobbered by the store's
 * re-render on every keystroke of a sibling line — the same pattern `Stepper` (kit's neighbour, `ui/Inputs.tsx`) uses. */
function PriceCell({ line, locked }: { line: CartLine; locked: boolean }) {
  const { c } = useTheme()
  const patchLine = useCart((s) => s.patchLine)
  const [text, setText] = useState(line.price ? String(line.price) : '')
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setText(line.price ? String(line.price) : '') }, [line.price])

  if (locked) return cellNum(inr(line.price), true)
  return (
    <TextInput
      value={text}
      onChangeText={(t) => { editing.current = true; setText(t.replace(/[^\d.]/g, '')) }}
      onEndEditing={() => {
        editing.current = false
        const n = Number(text)
        patchLine(line.variantId, { price: Number.isFinite(n) ? n : 0, mrp: Math.max(line.mrp, Number.isFinite(n) ? n : 0), priceOverridden: !line.unpricedSale && n !== line.price ? true : line.priceOverridden })
      }}
      keyboardType="decimal-pad"
      selectTextOnFocus
      style={{ width: 70, textAlign: 'right', color: c.ink, fontFamily: fonts.displayMedium, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
    />
  )
}

/**
 * Parked bills, as a dense table rather than the phone's bottom sheet (`@/features/ParkedSheet`) — a floating panel
 * is the desktop idiom for this, and the kit has no modal primitive of its own to reuse here. Resuming a row calls
 * the exact same `resume()` the toolbar button above wires up; nothing about parking or restoring a bill is redone.
 */
function HeldBills({ visible, bills, onClose, onResume }: { visible: boolean; bills: Bill[]; onClose: () => void; onResume: (b: Bill) => void }) {
  const { c } = useTheme()
  if (!visible) return null
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: 720, maxHeight: 480, backgroundColor: c.surface, borderRadius: 8, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 48, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <T style={dtext.title}>Parked bills</T>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}><Close size={18} color={c.inkMute} /></Pressable>
          </View>
          <View style={{ height: 420 }}>
            <DataTable
              emptyLabel="Nothing on hold"
              rows={bills}
              onRowPress={onResume}
              columns={[
                { key: 'no', label: 'No.', width: 100, render: (b) => cellText(b.no, true) },
                { key: 'when', label: 'When', render: (b) => cellText(fmtDateTime(b.date)) },
                { key: 'items', label: 'Items', width: 80, align: 'right', render: (b) => cellNum(String(b.items.length)) },
                { key: 'total', label: 'Total', width: 110, align: 'right', render: (b) => cellNum(inr0(b.total), true) },
              ]}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

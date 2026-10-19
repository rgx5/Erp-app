import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { lineDiscount } from '@/domain/cart'
import { cashSuggestions, finalPayments, pointsEarned, settle } from '@/domain/checkout'
import { couponProblem, couponUses, describeCoupon, normalizeCouponCode } from '@/domain/coupons'
import { inr, inr0, round2 } from '@/domain/money'
import type { PayMode } from '@/domain/types'
import { useLabels, useList, useStore } from '@/data/hooks'
import { saveBill } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { useCart, useCartTotals } from '@/features/cart'
import { CustomerPicker } from '@/features/CustomerPicker'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Chip, Tap } from '@/ui/primitives'
import { Field, MoneyField, NumberField, Segmented, Stepper, SwitchRow } from '@/ui/Inputs'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Banknote, ChevronRight, CreditCard, Phone, Ticket, UserPlus, Close } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const MODES: Array<{ mode: PayMode; label: string; icon: (c: string) => React.ReactNode }> = [
  { mode: 'cash', label: 'Cash', icon: (c) => <Banknote size={18} color={c} /> },
  { mode: 'upi', label: 'UPI', icon: (c) => <Phone size={18} color={c} /> },
  { mode: 'card', label: 'Card', icon: (c) => <CreditCard size={18} color={c} /> },
]

export default function Checkout() {
  const { c, radius } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const store = useStore()
  const user = useApp((s) => s.session?.userId ?? '')
  const canBig = useCan('bigDiscount')
  const customers = useList('customers')
  const coupons = useList('coupons')
  const bills = useList('bills')
  const staff = useList('users').filter((u) => u.active)
  const cart = useCart()
  const totals = useCartTotals()
  const customer = customers.find((x) => x.id === cart.customerId) ?? null

  const [showCustomer, setShowCustomer] = useState(false)
  const [mode, setMode] = useState<PayMode>('cash')
  const [tendered, setTendered] = useState('')
  const [ref, setRef] = useState('')
  const [split, setSplit] = useState<Array<{ mode: PayMode; amount: number; ref?: string }>>([])
  const [redeemPts, setRedeemPts] = useState(0)
  const [useCredit, setUseCredit] = useState(false)
  const [couponInput, setCouponInput] = useState('')
  const [discText, setDiscText] = useState(cart.billDiscountValue ? String(cart.billDiscountValue) : '')
  const [saving, setSaving] = useState(false)

  const defaultStaff = cart.staffId || user
  const billBefore = useMemo(() => round2(cart.lines.reduce((s, l) => s + (l.price * l.qty - lineDiscount(l)), 0)), [cart.lines])
  const total = totals.total
  const st = settle({ total, customer, loyaltyValue: store.loyaltyRedeemValue, redeemPts, useCredit, split, mode, tendered })
  const isCash = mode === 'cash'
  const capLimit = round2((billBefore * store.maxCashierDiscountPct) / 100)
  const overCap = !canBig && !cart.coupon && totals.billDiscount > capLimit + 0.01
  const quick = isCash ? cashSuggestions(st.remaining) : []

  function applyCoupon() {
    const code = normalizeCouponCode(couponInput)
    const cp = coupons.find((x) => x.code === code)
    const problem = couponProblem(cp, billBefore, couponUses(bills, code))
    if (problem || !cp) { toast(problem ?? 'No such coupon', 'err'); return }
    cart.set({ coupon: cp.code, billDiscountType: cp.type, billDiscountValue: cp.value })
    setDiscText(String(cp.value)); setCouponInput('')
    toast(`${cp.code} applied — ${describeCoupon(cp)}`, 'ok')
  }
  function removeCoupon() { cart.set({ coupon: '', billDiscountValue: 0 }); setDiscText('') }

  function addPartial() {
    if (st.amount <= 0 || st.covers) return
    setSplit([...split, { mode, amount: st.amount, ...(ref.trim() ? { ref: ref.trim() } : {}) }])
    setTendered(''); setRef('')
  }

  function complete() {
    if (saving) return
    const noPrice = cart.lines.find((l) => !(l.price > 0))
    if (noPrice) { toast(`${noPrice.name} has no price — type one or remove it.`, 'err'); return }
    if (total <= 0) { toast('This bill is ₹0 — nothing to charge. Remove the discount or add items.', 'err'); return }
    if (overCap) { toast(`Discount ${inr(totals.billDiscount)} is over your ${store.maxCashierDiscountPct}% limit (${inr(capLimit)}). Lower it or ask a manager.`, 'err'); return }
    if (!st.covers) { toast(`Still ${inr(st.shortBy)} to collect`, 'err'); return }
    setSaving(true)
    try {
      const input = { mode, split, tendered, customer, loyaltyValue: store.loyaltyRedeemValue, redeemPts, useCredit, total }
      const payments = finalPayments({ ...input, customer }, st, ref)
      const paid = round2(payments.reduce((s, p) => s + p.amount, 0))
      const unpriced = cart.lines.filter((l) => l.unpricedSale).map((l) => ({ variantId: l.variantId, sku: l.sku, name: l.name, price: l.price, qty: l.qty, save: !!l.savePrice, mrp: Math.max(l.mrp, l.price) }))
      const r = perform((s, ctx) => saveBill(s, {
        date: ctx.now, customerId: cart.customerId, items: totals.items.map((it, i) => ({ ...it, soldBy: cart.lines[i]?.staffId || defaultStaff })),
        grossMrp: totals.grossMrp, itemDiscount: totals.itemDiscount, billDiscountType: cart.billDiscountType, billDiscountValue: cart.billDiscountValue,
        billDiscount: totals.billDiscount, coupon: cart.coupon, subtotal: totals.subtotal, taxableTotal: totals.taxableTotal, cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal, taxTotal: totals.taxTotal, roundOff: totals.roundOff, total, payments, paid, changeDue: st.change,
        loyaltyEarned: customer ? pointsEarned(total, store.loyaltyEarnPct) : 0, loyaltyRedeemed: st.pts, creditUsed: st.creditUsed,
        cashierId: user, soldBy: defaultStaff, status: 'paid', notes: '',
      }, ctx, { heldId: cart.heldId ?? undefined, unpriced }))
      cart.clear()
      router.replace({ pathname: '/sell/done', params: { id: r.bill.id, change: String(st.change) } })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the bill', 'err')
      setSaving(false)
    }
  }

  return (
    <Screen title="Checkout" subtitle={`${cart.lines.length} ${cart.lines.length === 1 ? 'line' : 'lines'}`} back
      footer={<Button label={`Complete ${labels.sale.toLowerCase()} · ${inr(total, 0)}`} size="lg" block loading={saving} disabled={!st.covers || overCap} onPress={complete} kind="primary" />}>
      <View style={{ gap: 0, paddingBottom: 12 }}>
        {/* Summary */}
        <Card>
          <KV k="Items total (MRP)" v={inr(totals.grossMrp)} />
          {totals.grossMrp - totals.subtotal > 0 ? <KV k="Savings vs MRP" v={`− ${inr(round2(totals.grossMrp - totals.subtotal))}`} tone="success" /> : null}
          {store.priceIncludesTax ? <KV k="GST included" v={inr(totals.taxTotal)} /> : <KV k="GST added" v={inr(totals.taxTotal)} />}
          {totals.roundOff ? <KV k="Round off" v={inr(totals.roundOff)} /> : null}
          <View style={{ height: 1, backgroundColor: c.line, marginVertical: 6 }} />
          <KV k="Bill total" v={inr(total)} strong big />
        </Card>

        {/* Customer */}
        <Section title={labels.customer} style={{ marginTop: 20 }}>
          <Tap onPress={() => setShowCustomer(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            {customer ? <Avatar name={customer.name} size={40} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={18} color={c.primary} /></View>}
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">{customer ? customer.name : `Walk-in ${labels.customer.toLowerCase()}`}</T>
              <T v="caption" tone="mute">{customer ? customer.phone : 'Add one to give loyalty points'}</T>
            </View>
            {customer && customer.loyaltyPoints ? <Badge tone="primary">{customer.loyaltyPoints} pts</Badge> : null}
            <ChevronRight size={18} color={c.inkMute} />
          </Tap>
        </Section>

        {/* Discount */}
        <Section title="Discount" style={{ marginTop: 20 }}>
          <View style={{ gap: 12 }}>
            {cart.coupon ? (
              <Notice tone="success" icon={<Ticket size={20} color={c.success} />} title={`${cart.coupon} applied`} body={`${cart.billDiscountType === 'pct' ? `${cart.billDiscountValue}%` : inr0(cart.billDiscountValue)} off this bill`} action="Remove" onAction={removeCoupon} />
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ width: 128 }}>
                    <Segmented compact value={cart.billDiscountType} options={[{ value: 'amt', label: '₹' }, { value: 'pct', label: '%' }]} onChange={(t) => cart.set({ billDiscountType: t })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MoneyField value={discText} onChange={(v) => { setDiscText(v); cart.set({ billDiscountValue: Number(v) || 0 }) }} placeholder="Bill discount" error={overCap ? `Over your ${store.maxCashierDiscountPct}% limit` : null} />
                  </View>
                </View>
                {coupons.some((x) => x.active) ? (
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <View style={{ flex: 1 }}><Field value={couponInput} onChangeText={(t) => setCouponInput(t.toUpperCase())} placeholder="Coupon code" autoCapitalize="characters" left={<Ticket size={18} color={c.inkMute} />} onSubmitEditing={applyCoupon} /></View>
                    <Button label="Apply" kind="soft" onPress={applyCoupon} disabled={!couponInput.trim()} />
                  </View>
                ) : null}
              </>
            )}
          </View>
        </Section>

        {/* Loyalty & credit */}
        {customer && (customer.storeCredit > 0 || (customer.loyaltyPoints > 0 && store.loyaltyRedeemValue > 0)) ? (
          <Section title="Use balance" style={{ marginTop: 20 }}>
            <Card padded={false}>
              {customer.storeCredit > 0 ? <SwitchRow title={`Store credit · ${inr0(customer.storeCredit)}`} subtitle="Pays part of the bill" value={useCredit} onChange={setUseCredit} /> : null}
              {customer.loyaltyPoints > 0 && store.loyaltyRedeemValue > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderTopWidth: customer.storeCredit > 0 ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">Redeem points</T>
                    <T v="caption" tone="mute">1 pt = {inr(store.loyaltyRedeemValue)} · up to {st.maxPts} here</T>
                  </View>
                  <Stepper value={st.pts} onChange={(n) => setRedeemPts(Math.max(0, Math.min(n, st.maxPts)))} max={st.maxPts} min={0} />
                </View>
              ) : null}
            </Card>
          </Section>
        ) : null}

        {/* Payment */}
        <Section title="Payment" style={{ marginTop: 20 }}>
          <View style={{ gap: 12 }}>
            <View style={{ borderRadius: radius.lg, padding: 16, backgroundColor: c.ink, gap: 2 }}>
              <T v="caption" style={{ color: c.bg, opacity: 0.7 }}>{split.length ? 'Still due' : 'Amount due'}</T>
              <T v="display" style={{ color: c.bg }}>{inr(st.remaining, 2)}</T>
              {(split.length || st.creditUsed || st.loyaltyRupees) ? <T v="caption" style={{ color: c.bg, opacity: 0.7 }}>Bill {inr(total, 0)}{st.splitPaid ? ` − paid ${inr0(st.splitPaid)}` : ''}{st.creditUsed ? ` − credit ${inr0(st.creditUsed)}` : ''}{st.loyaltyRupees ? ` − points ${inr0(st.loyaltyRupees)}` : ''}</T> : null}
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              {MODES.map((m) => {
                const on = mode === m.mode
                return (
                  <Tap key={m.mode} onPress={() => { setMode(m.mode); setRef('') }} style={{ flex: 1, height: 52, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.lineStrong }}>
                    {m.icon(on ? c.onPrimary : c.inkSoft)}
                    <T v="bodyStrong" style={{ color: on ? c.onPrimary : c.ink }}>{m.label}</T>
                  </Tap>
                )
              })}
            </View>

            <MoneyField label={isCash ? 'Cash received' : `${mode.toUpperCase()} amount`} value={tendered} onChange={setTendered} placeholder={String(st.remaining)} large />
            {isCash ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Chip label={`Exact ${inr0(st.remaining)}`} selected={tendered === ''} onPress={() => setTendered('')} />
                {quick.map((n) => <Chip key={n} label={inr0(n)} selected={Number(tendered) === n} onPress={() => setTendered(String(n))} />)}
              </View>
            ) : (
              <Field value={ref} onChangeText={setRef} placeholder={mode === 'upi' ? 'UPI transaction ID (optional)' : 'Card last 4 / approval code (optional)'} />
            )}

            <Notice tone={st.shortBy > 0 ? 'danger' : st.change > 0 ? 'warning' : 'success'} title={st.shortBy > 0 ? `Short by ${inr(st.shortBy)}` : st.change > 0 ? `Change to return ${inr(st.change)}` : st.remaining > 0 ? 'Exact amount — no change' : 'Nothing left to pay'} />

            {st.shortBy > 0 && st.amount > 0 ? <Button label={`Take ${inr0(st.amount)} by ${mode.toUpperCase()} · rest on another mode`} kind="outline" block onPress={addPartial} /> : null}

            {split.length ? (
              <Card padded={false}>
                {split.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <Badge>{p.mode.toUpperCase()}</Badge>
                    <T v="caption" tone="mute" style={{ flex: 1 }} numberOfLines={1}>{p.ref}</T>
                    <T v="num">{inr(p.amount)}</T>
                    <Tap onPress={() => setSplit(split.filter((_, x) => x !== i))} hitSlop={10} accessibilityLabel="Remove payment"><Close size={16} color={c.inkMute} /></Tap>
                  </View>
                ))}
              </Card>
            ) : null}
          </View>
        </Section>

        {/* Seller */}
        {staff.length > 1 ? (
          <Section title={`Sold by`} style={{ marginTop: 20 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {staff.map((u) => <Chip key={u.id} label={`${u.code ? u.code + ' · ' : ''}${u.name.split(' ')[0]}`} selected={defaultStaff === u.id} onPress={() => cart.set({ staffId: u.id })} />)}
            </View>
          </Section>
        ) : null}
      </View>
      <CustomerPicker visible={showCustomer} onClose={() => setShowCustomer(false)} selectedId={cart.customerId} onPick={(cu) => { cart.set({ customerId: cu?.id ?? null }); setRedeemPts(0); setUseCredit(false) }} />
    </Screen>
  )
}

void NumberField

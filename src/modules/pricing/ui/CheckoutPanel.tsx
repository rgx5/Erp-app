import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { gstinState, STATE_OPTIONS, stateName, type BillTaxInfo } from '@/domain/gst'
import { useList, useStore } from '@/data/hooks'
import { useApp } from '@/data/store'
import { useCart } from '@/features/cart'
import { Field, Select, SwitchRow } from '@/ui/Inputs'
import { Notice, Section } from '@/ui/blocks'
import { Card, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ChevronDown, ChevronUp, FileText } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { billTaxInfo, checkBuyer, sameTaxInfo, supplySummary } from '../b2b'
import { listForCart, tierOf } from '../prices'
import { TIER_LABEL } from '../types'

/**
 * Checkout section "GST invoice": the buyer's GSTIN and place of supply (which decide IGST or CGST + SGST), reverse charge, and the
 * price list for this bill. It writes `extras.pricing`, which is saved as `bill.ext.pricing`. For a composition or unregistered
 * dealer it records that the bill is a bill of supply.
 */
export function PricingCheckoutPanel({ moduleId }: { moduleId: string }) {
  const { c, radius } = useTheme()
  const store = useStore()
  const customerId = useCart((s) => s.customerId)
  const extras = useCart((s) => s.extras)
  const setExtra = useCart((s) => s.setExtra)
  const state = useApp((s) => s.data)
  const lists = useList('priceLists')
  const customer = customerId ? state.customers[customerId] ?? null : null
  const typed = (extras[moduleId] ?? {}) as BillTaxInfo
  const sum = useMemo(() => supplySummary(store, customer, typed), [store, customer, typed])
  const check = useMemo(() => checkBuyer(store, customer, typed), [store, customer, typed])
  const list = useMemo(() => listForCart(state, customerId, extras), [state, customerId, extras])
  const [open, setOpen] = useState(false)
  const active = lists.filter((l) => l.active)

  // Keep the derived fields (bill of supply, IGST) on the record, so a receipt or a return never has to work them out again.
  useEffect(() => {
    const next = billTaxInfo(store, customer, typed)
    if (!sameTaxInfo(next, extras[moduleId] as BillTaxInfo | undefined)) setExtra(moduleId, next)
  }, [store, customer, typed, extras, moduleId, setExtra])

  const patch = (p: Partial<BillTaxInfo>) => setExtra(moduleId, { ...typed, ...p })
  const hasData = !!(typed.buyerGstin || typed.placeOfSupply || typed.reverseCharge || typed.buyerName || typed.priceListId)
  const shown = open || hasData || check.errors.length > 0
  const own = (customer?.gstin ?? '').trim()

  if (!active.length && !own && store.registrationType !== 'composition' && store.registrationType !== 'unregistered' && !hasData && !open) {
    return (
      <Section title="GST invoice" style={{ marginTop: 20 }}>
        <Tap onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <FileText size={18} color={c.primary} />
          <T v="body" style={{ flex: 1 }}>Selling to a business? Add its GSTIN</T>
          <ChevronDown size={18} color={c.inkMute} />
        </Tap>
      </Section>
    )
  }

  return (
    <Section title="GST invoice" style={{ marginTop: 20 }}>
      <View style={{ gap: 12 }}>
        <Notice
          tone={sum.kind === 'bill_of_supply' ? 'warning' : sum.interState ? 'accent' : 'success'}
          title={sum.kind === 'bill_of_supply' ? 'Bill of supply — no GST charged' : `${sum.isB2B ? 'Tax invoice to a business' : 'Tax invoice'} · ${sum.tax}`}
          body={sum.kind === 'bill_of_supply'
            ? (store.registrationType === 'composition' ? 'You are registered under the composition scheme.' : 'You are not registered for GST.')
            : sum.placeOfSupply ? `Place of supply: ${stateName(sum.placeOfSupply)}${sum.interState ? ' — another state, so IGST' : ''}` : 'Same state as the shop, so CGST + SGST'}
        />
        {!shown ? (
          <Tap onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
            <T v="bodyStrong" style={{ flex: 1, color: c.primary }}>Buyer GSTIN, place of supply, price list</T>
            <ChevronDown size={18} color={c.inkMute} />
          </Tap>
        ) : (
          <Card style={{ gap: 12 }}>
            {sum.kind === 'tax_invoice' ? (
              <>
                <Field label="Buyer GSTIN" value={typed.buyerGstin ?? ''} placeholder={own || '15 characters'} autoCapitalize="characters" autoCorrect={false}
                  onChangeText={(t) => { const g = t.toUpperCase().replace(/\s/g, ''); patch({ buyerGstin: g, ...(gstinState(g) ? { placeOfSupply: gstinState(g) } : {}) }) }}
                  error={check.errors.find((e) => e.startsWith('Buyer GSTIN')) ?? null} hint={own && !typed.buyerGstin ? 'The customer’s saved GSTIN is used' : undefined} />
                <Field label="Buyer’s business name (optional)" value={typed.buyerName ?? ''} onChangeText={(t) => patch({ buyerName: t })} placeholder={customer?.name} />
                <Select<string> label="Place of supply" value={typed.placeOfSupply ?? ''} placeholder={`Same as the shop (${stateName(gstinState(store.gstin)) || 'not set'})`} searchable
                  options={[{ value: '', label: 'Same as the shop / from GSTIN' }, ...STATE_OPTIONS.map((s) => ({ value: s.code, label: s.name, sub: s.code }))]} onChange={(v) => patch({ placeOfSupply: v || undefined })} />
                <Card padded={false} flat><SwitchRow title="Reverse charge" subtitle="The buyer pays the GST, not you" value={!!typed.reverseCharge} onChange={(v) => patch({ reverseCharge: v })} /></Card>
              </>
            ) : null}
            {active.length ? (
              <Select<string> label={`Price list${list ? ` · ${TIER_LABEL[tierOf(list)]}` : ''}`} value={typed.priceListId ?? ''} placeholder="The customer’s own list"
                options={[{ value: '', label: customer?.priceListId ? 'The customer’s own list' : 'Normal selling prices' }, ...active.map((l) => ({ value: l.id, label: l.name, sub: TIER_LABEL[l.tier] }))]}
                onChange={(v) => patch({ priceListId: v || undefined })} />
            ) : null}
            {check.errors.filter((e) => !e.startsWith('Buyer GSTIN')).map((e) => <Notice key={e} tone="danger" title={e} />)}
            {check.warnings.map((w) => <Notice key={w} tone="warning" title={w} />)}
            {!hasData && open ? <Tap onPress={() => setOpen(false)} style={{ alignItems: 'center' }}><ChevronUp size={18} color={c.inkMute} /></Tap> : null}
          </Card>
        )}
      </View>
    </Section>
  )
}

import React, { useMemo } from 'react'
import { Platform, Text, View, type TextStyle } from 'react-native'
import { fmtDateTime } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { paymentSummary, type ReceiptOptions } from '@/domain/receipt'
import { sampleBill } from '@/domain/sampleBill'
import { hsnSummary } from '@/domain/tax'
import { variantLabel } from '@/domain/codes'
import type { StoreSettings } from '@/domain/types'

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
const ink = '#111111'
const soft = '#555555'

const t = (extra?: TextStyle): TextStyle => ({ fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: ink, ...extra })
const Dash = () => <Text style={t({ color: '#999' })} numberOfLines={1}>{'-'.repeat(64)}</Text>
const Line = ({ l, r, bold, size }: { l: string; r: string; bold?: boolean; size?: number }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
    <Text style={t({ fontWeight: bold ? '700' : '400', fontSize: size ?? 11.5, flexShrink: 1 })}>{l}</Text>
    <Text style={t({ fontWeight: bold ? '700' : '400', fontSize: size ?? 11.5 })}>{r}</Text>
  </View>
)

/**
 * What the printed receipt will look like, drawn from the settings being edited — a paper strip at the chosen width
 * (58 mm or 80 mm), with a sample bill worked out using the shop's own tax rules.
 */
export function ReceiptPreview({ store, opts }: { store: StoreSettings; opts: ReceiptOptions }) {
  const bill = useMemo(() => sampleBill(store, Date.now()), [store])
  const saved = round2(bill.grossMrp - bill.subtotal)
  const hsn = opts.showHsn ? hsnSummary(bill.items) : []
  const width = store.receiptWidth === '58mm' ? 232 : 300

  return (
    <View style={{ alignSelf: 'center', width, maxWidth: '100%', backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 16, borderRadius: 4, borderWidth: 1, borderColor: '#E4E1D8', gap: 3 }} accessibilityLabel="Receipt preview">
      <Text style={t({ textAlign: 'center', fontWeight: '800', fontSize: 15, lineHeight: 20 })}>{store.name || 'Your business'}</Text>
      {store.tagline ? <Text style={t({ textAlign: 'center', color: soft, fontSize: 10.5 })}>{store.tagline}</Text> : null}
      {[store.address, store.city].filter(Boolean).length ? <Text style={t({ textAlign: 'center', fontSize: 10.5 })}>{[store.address, store.city].filter(Boolean).join(', ')}</Text> : null}
      {store.phone ? <Text style={t({ textAlign: 'center', fontSize: 10.5 })}>Ph: {store.phone}</Text> : null}
      {store.gstin ? <Text style={t({ textAlign: 'center', fontSize: 10.5 })}>GSTIN: {store.gstin}</Text> : null}
      <Text style={t({ textAlign: 'center', fontWeight: '700', marginTop: 6, letterSpacing: 0.6 })}>TAX INVOICE</Text>
      <Dash />
      <Line l={bill.no} r={fmtDateTime(bill.date)} size={10.5} />
      <Dash />
      {bill.items.map((i) => (
        <View key={i.variantId} style={{ marginBottom: 3 }}>
          <Text style={t({ fontWeight: '700' })}>{i.name}{variantLabel(i.size, i.color) ? ` ${variantLabel(i.size, i.color)}` : ''}</Text>
          <Line l={`${fmtQty(i.qty)} × ${inr(i.price, 2)}`} r={inr(i.lineTotal, 2)} size={10.5} />
        </View>
      ))}
      <Dash />
      {bill.grossMrp > bill.subtotal ? <Line l="Total MRP" r={inr(bill.grossMrp, 2)} size={10.5} /> : null}
      {opts.showTax ? (
        <>
          <Line l="Taxable value" r={inr(bill.taxableTotal, 2)} size={10.5} />
          <Line l="CGST" r={inr(bill.cgstTotal, 2)} size={10.5} />
          <Line l="SGST" r={inr(bill.sgstTotal, 2)} size={10.5} />
        </>
      ) : null}
      {bill.roundOff ? <Line l="Round off" r={inr(bill.roundOff, 2)} size={10.5} /> : null}
      <Line l="TOTAL" r={inr(bill.total, 2)} bold size={14} />
      <Text style={t({ color: soft, fontSize: 10.5 })}>{paymentSummary(bill)}</Text>
      {opts.showSavings && saved > 0 ? <Text style={t({ textAlign: 'center', fontWeight: '700', marginTop: 4 })}>You saved {inr(saved, 2)}!</Text> : null}
      {opts.showLoyalty && bill.loyaltyEarned > 0 ? <Text style={t({ textAlign: 'center', fontSize: 10.5 })}>+{bill.loyaltyEarned} loyalty points earned</Text> : null}
      {hsn.length ? (
        <>
          <Dash />
          {hsn.map((h) => <Line key={`${h.hsn}|${h.rate}`} l={`HSN ${h.hsn} · ${h.rate}%`} r={inr(round2(h.cgst + h.sgst), 2)} size={10} />)}
        </>
      ) : null}
      <Dash />
      {store.returnPolicy ? <Text style={t({ textAlign: 'center', color: soft, fontSize: 10 })}>{store.returnPolicy}</Text> : null}
      {store.footerNote ? <Text style={t({ textAlign: 'center', fontWeight: '700', marginTop: 4 })}>{store.footerNote}</Text> : null}
    </View>
  )
}

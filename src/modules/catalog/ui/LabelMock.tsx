import React from 'react'
import { View } from 'react-native'
import type { LabelField, LabelTemplate } from '@/modules/catalog/types'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

export type Draft = Omit<LabelTemplate, 'id' | 'createdAt'>
export const blank = (): Draft => ({ name: '', widthMm: 50, heightMm: 30, perRow: 1, paper: 'roll', fields: ['name', 'variant', 'price'], code: 'bars', qrText: '{barcode}' })
export const num = (s: string) => Number(s.replace(',', '.'))

export const SAMPLE = { name: 'Cotton Kurta', variant: 'M / Blue', brand: 'Fab India', sku: 'KU-101-BLU-M', barcode: '2100000000015', hsn: '6104', price: 799, mrp: 999 }

/**
 * A rough picture of the label at its real proportions (the print has the real bars). Shared by the phone
 * `m/catalog/templates.tsx` editor and its desktop counterpart so both preview a design identically.
 */
export function Mock({ t, store }: { t: Draft; store: string }) {
  const { c } = useTheme()
  const scale = Math.min(260 / t.widthMm, 150 / t.heightMm)
  const has = (f: LabelField) => t.fields.includes(f)
  return (
    <View style={{ alignSelf: 'center', width: t.widthMm * scale, height: t.heightMm * scale, borderWidth: 1, borderColor: c.lineStrong, borderStyle: 'dashed', borderRadius: 6, padding: 6, backgroundColor: '#fff', flexDirection: t.code === 'qr' ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden' }}>
      {t.code === 'qr' ? <View style={{ width: Math.min(t.heightMm * scale - 12, t.widthMm * scale * 0.4), aspectRatio: 1, backgroundColor: '#222', borderRadius: 3 }} /> : null}
      <View style={{ alignItems: t.code === 'qr' ? 'flex-start' : 'center', flexShrink: 1 }}>
        {has('store') ? <T v="micro" style={{ color: '#444' }}>{store.toUpperCase()}</T> : null}
        {has('name') ? <T v="micro" style={{ color: '#000', fontWeight: '700' }} numberOfLines={1}>{SAMPLE.name}</T> : null}
        {has('variant') ? <T v="micro" style={{ color: '#333' }}>{SAMPLE.variant}</T> : null}
        {has('brand') ? <T v="micro" style={{ color: '#333' }}>{SAMPLE.brand}</T> : null}
        {has('sku') ? <T v="micro" style={{ color: '#000' }}>{SAMPLE.sku}</T> : null}
        {has('hsn') ? <T v="micro" style={{ color: '#000' }}>HSN {SAMPLE.hsn}</T> : null}
        {t.code === 'bars' ? <View style={{ height: Math.max(8, t.heightMm * scale * 0.25), width: t.widthMm * scale * 0.7, backgroundColor: '#222', marginVertical: 2, opacity: 0.85 }} /> : null}
        {has('barcodeText') ? <T v="micro" style={{ color: '#000' }}>{SAMPLE.barcode}</T> : null}
        {has('price') || has('mrp') ? <T v="micro" style={{ color: '#000' }}>{has('mrp') ? `MRP ₹${SAMPLE.mrp}  ` : ''}{has('price') ? `₹${SAMPLE.price}` : ''}</T> : null}
      </View>
    </View>
  )
}

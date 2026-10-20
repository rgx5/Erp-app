import { ean13CheckDigit } from '../barcode'
import { DEFAULT_SCALE, matchesItemCode, parseScaleBarcode, scaleFiller, scaleLayoutProblem, scaleQuantity, type ScaleLayout } from '../scale'
import { baseState } from '@/data/__tests__/helpers'
import { findVariantByCode } from '@/data/lookup'

const on: ScaleLayout = { ...DEFAULT_SCALE, enabled: true }
/** A scale label: prefix 2, a flag digit, item PLU, weight/price, check digit. */
const label = (item: string, value: string, flag = '0', prefix = '2') => { const b = prefix + flag + item + value; return b + ean13CheckDigit(b) }

describe('scale labels', () => {
  test('reads the item code and the weight', () => {
    expect(parseScaleBarcode(label('00123', '01250'), on)).toEqual({ item: '00123', value: 1250, kind: 'weight' })
  })
  test('weight in 10 g steps, price in rupees or paise', () => {
    expect(parseScaleBarcode(label('00123', '00125'), { ...on, value: 'weight_10g' })).toEqual({ item: '00123', value: 1250, kind: 'weight' })
    expect(parseScaleBarcode(label('00123', '00250'), { ...on, value: 'price_rupees' })).toEqual({ item: '00123', value: 250, kind: 'price' })
    expect(parseScaleBarcode(label('00123', '02575'), { ...on, value: 'price_paise' })).toEqual({ item: '00123', value: 25.75, kind: 'price' })
  })
  test('refuses what is not a label: off, wrong prefix, bad check digit, wrong length', () => {
    const code = label('00123', '01250')
    expect(parseScaleBarcode(code, DEFAULT_SCALE)).toBeNull()
    expect(parseScaleBarcode(label('00123', '01250', '0', '5'), on)).toBeNull()
    expect(parseScaleBarcode(code.slice(0, 12) + ((Number(code[12]) + 1) % 10), on)).toBeNull()
    expect(parseScaleBarcode('12345', on)).toBeNull()
  })
  test('a layout has to fit 13 digits', () => {
    expect(scaleFiller(DEFAULT_SCALE)).toBe(1)
    expect(scaleLayoutProblem(DEFAULT_SCALE)).toBeNull()
    expect(scaleLayoutProblem({ ...DEFAULT_SCALE, itemDigits: 8, valueDigits: 6 })).toMatch(/more than the 12 digits/)
    expect(scaleLayoutProblem({ ...DEFAULT_SCALE, prefix: 'x' })).toMatch(/prefix/)
  })
  test('another layout: a 2-digit prefix, 6-digit item code, 4-digit weight', () => {
    const l: ScaleLayout = { enabled: true, prefix: '21', itemDigits: 6, valueDigits: 4, value: 'weight_g' }
    const b = '21' + '000123' + '0750'; const code = b + ean13CheckDigit(b)
    expect(parseScaleBarcode(code, l)).toEqual({ item: '000123', value: 750, kind: 'weight' })
  })
  test('quantities: kilograms from grams, grams for an item sold by the gram, price ÷ unit price', () => {
    expect(scaleQuantity({ item: '1', value: 1250, kind: 'weight' }, 'kg', 80)).toBe(1.25)
    expect(scaleQuantity({ item: '1', value: 1250, kind: 'weight' }, 'g', 0.08)).toBe(1250)
    expect(scaleQuantity({ item: '1', value: 150, kind: 'price' }, 'kg', 80)).toBe(1.875)
    expect(scaleQuantity({ item: '1', value: 150, kind: 'price' }, 'kg', 0)).toBeNull()
  })
  test('the item code matches a barcode or SKU, ignoring leading zeros', () => {
    expect(matchesItemCode({ barcode: '123', sku: 'X' }, '00123')).toBe(true)
    expect(matchesItemCode({ barcode: '9', sku: '00123' }, '123')).toBe(true)
    expect(matchesItemCode({ barcode: '124', sku: 'X' }, '00123')).toBe(false)
    expect(matchesItemCode({ barcode: '0', sku: 'X' }, '00000')).toBe(false)
  })
})

describe('findVariantByCode and scale labels', () => {
  const withScale = (enabled: boolean) => {
    const s = baseState()
    s.variants = { ...s.variants, v1: { ...s.variants.v1, barcode: '00123', price: 80 } }
    s.products = { ...s.products, p1: { ...s.products.p1, unit: 'kg', fractional: true } }
    ;(s as unknown as Record<string, unknown>).pricingSettings = { settings: { id: 'settings', scale: { ...DEFAULT_SCALE, enabled } } }
    return s
  }
  test('an exact barcode or SKU still wins, whatever the scale setting', () => {
    expect(findVariantByCode(withScale(true), '00123')?.id).toBe('v1')
    expect(findVariantByCode(withScale(true), 'ms-101-nav-l')?.id).toBe('v2')
  })
  test('a label sells the weight on it, once the shop turns labels on', () => {
    const code = label('00123', '01250')
    const hit = findVariantByCode(withScale(true), code)
    expect(hit?.id).toBe('v1')
    expect(hit?.scanQty).toBe(1.25)
    expect(findVariantByCode(withScale(false), code)).toBeNull()
  })
  test('a price label sells price ÷ unit price', () => {
    const s = withScale(true)
    ;(s as unknown as { pricingSettings: Record<string, { scale: ScaleLayout }> }).pricingSettings.settings.scale = { ...on, value: 'price_rupees' }
    expect(findVariantByCode(s, label('00123', '00200'))?.scanQty).toBe(2.5)
  })
  test('a label for an item the shop does not have finds nothing', () => {
    expect(findVariantByCode(withScale(true), label('09999', '01250'))).toBeNull()
  })
})

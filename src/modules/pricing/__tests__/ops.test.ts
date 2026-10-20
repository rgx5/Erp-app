import { ctx, NOW } from '@/data/__tests__/helpers'
import { OpError, saveBill } from '@/data/ops'
import { applyChanges, listOf, type DataState } from '@/data/state'
import { makeScaleBarcode, parseScaleBarcode, DEFAULT_SCALE } from '@/domain/scale'
import { findVariantByCode } from '@/data/lookup'
import {
  assignPriceList, cancelEInvoice, cancelEwayBill, deleteBreakRule, deletePriceList, deletePromotion, recordEwayBill, recordIrn, saveBreakRule, saveEInvoiceDetails, saveEwayDetails,
  savePriceList, savePricingSettings, savePromotion, setListPrices, setPromotionActive,
} from '../ops'
import { eInvoiceId, ewayId } from '../types'
import { cartLine, sale, shop } from './helpers'

const apply = (s: DataState, r: { changes: Parameters<typeof applyChanges>[1] }) => applyChanges(s, r.changes)
const IRN = 'f'.repeat(64)

describe('price lists', () => {
  test('create, rename, refuse a duplicate name', () => {
    let s = shop()
    const made = savePriceList(s, { name: ' Trade ', tier: 'dealer', basis: 'cost', pct: 25, roundTo: 5 }, undefined, ctx())
    s = apply(s, made)
    expect(made.list).toMatchObject({ name: 'Trade', active: true })
    expect(() => savePriceList(s, { name: 'trade', tier: 'dealer', basis: 'cost', pct: 1, roundTo: 0 }, undefined, ctx())).toThrow(/already a price list/)
    expect(savePriceList(s, { name: 'Trade', tier: 'retail', basis: 'price', pct: 0, roundTo: 0 }, made.list.id, ctx()).list.tier).toBe('retail')
    expect(() => savePriceList(s, { name: 'X', tier: 'retail', basis: 'price', pct: 5000, roundTo: 0 }, undefined, ctx())).toThrow(OpError)
    expect(() => savePriceList(s, { name: '', tier: 'retail', basis: 'price', pct: 0, roundTo: 0 }, undefined, ctx())).toThrow(/name/)
  })
  test('item prices are set and cleared in a batch', () => {
    let s = shop()
    let r = setListPrices(s, 'pl_ws', [{ variantId: 'v1', price: 850 }, { variantId: 'v3', price: 1200.456 }], ctx())
    s = apply(s, r)
    expect([r.set, r.cleared]).toEqual([2, 0])
    expect(s.priceListItems['pl_ws:v3'].price).toBe(1200.46)
    r = setListPrices(s, 'pl_ws', [{ variantId: 'v1', price: null }, { variantId: 'v2', price: null }], ctx())
    s = apply(s, r)
    expect(r.cleared).toBe(1)
    expect(s.priceListItems['pl_ws:v1']).toBeUndefined()
    expect(() => setListPrices(s, 'pl_ws', [{ variantId: 'nope', price: 1 }], ctx())).toThrow(/no longer exists/)
    expect(() => setListPrices(s, 'pl_ws', [{ variantId: 'v1', price: -1 }], ctx())).toThrow(/negative/)
    expect(setListPrices(s, 'pl_ws', [], ctx()).changes).toEqual({})
  })
  test('deleting a list frees the customers and the default, and switches off its own rules', () => {
    let s = shop()
    s = apply(s, setListPrices(s, 'pl_ws', [{ variantId: 'v1', price: 850 }], ctx()))
    s = apply(s, savePricingSettings(s, { defaultListId: 'pl_ws' }, ctx()))
    s = apply(s, saveBreakRule(s, { name: 'ws bulk', target: 'all', targetId: '', listId: 'pl_ws', breaks: [{ minQty: 5, kind: 'pct', value: 3 }] }, undefined, ctx()))
    s = apply(s, deletePriceList(s, 'pl_ws', ctx()))
    expect(s.priceLists.pl_ws).toBeUndefined()
    expect(s.priceListItems['pl_ws:v1']).toBeUndefined()
    expect(s.customers.c1.priceListId).toBeUndefined()
    expect(s.pricingSettings.settings.defaultListId).toBeUndefined()
    expect(listOf(s.qtyBreakRules)[0].active).toBe(false)
  })
  test('assigning a customer to a list', () => {
    let s = shop()
    s = apply(s, assignPriceList(s, 'c2', 'pl_dl', ctx()))
    expect(s.customers.c2.priceListId).toBe('pl_dl')
    s = apply(s, assignPriceList(s, 'c2', '', ctx()))
    expect('priceListId' in s.customers.c2).toBe(false)
    expect(() => assignPriceList(s, 'c2', 'ghost', ctx())).toThrow(/no longer exists/)
    expect(assignPriceList(s, 'c2', '', ctx()).changes).toEqual({})
  })
})

describe('rules and promotions', () => {
  test('a break rule is sorted and checked', () => {
    const s = shop()
    const r = saveBreakRule(s, { name: '', target: 'product', targetId: 'p1', listId: '', breaks: [{ minQty: 12, kind: 'pct', value: 10 }, { minQty: 6, kind: 'pct', value: 5.555 }] }, undefined, ctx())
    expect(r.rule.breaks.map((b) => b.minQty)).toEqual([6, 12])
    expect(r.rule.breaks[0].value).toBe(5.56)
    expect(r.rule.name).toBe('Quantity break')
    expect(() => saveBreakRule(s, { name: 'x', target: 'product', targetId: 'p1', listId: 'ghost', breaks: r.rule.breaks }, undefined, ctx())).toThrow(/price list/)
    expect(deleteBreakRule(apply(s, r), r.rule.id, ctx()).changes.del).toEqual({ qtyBreakRules: [r.rule.id] })
  })
  test('a promotion is checked, toggled, deleted', () => {
    let s = shop()
    const draft = { kind: 'buy_x_get_y' as const, name: 'B2G1', active: true, priority: 0, scope: { categoryIds: ['cat_mshirt'] }, buyQty: 2, getQty: 1, getPct: 100 }
    expect(() => savePromotion(s, { ...draft, buyQty: 0 }, undefined, ctx())).toThrow(/Buy quantity/)
    expect(() => savePromotion(s, { kind: 'bundle', name: 'B', active: true, priority: 0, items: [{ variantId: 'v1', qty: 1 }, { variantId: 'ghost', qty: 1 }], price: 10 }, undefined, ctx())).toThrow(/no longer exists/)
    const r = savePromotion(s, draft, undefined, ctx())
    s = apply(s, r)
    s = apply(s, setPromotionActive(s, r.promotion.id, false, ctx()))
    expect(s.promotions[r.promotion.id].active).toBe(false)
    expect(setPromotionActive(s, r.promotion.id, false, ctx()).changes).toEqual({})
    s = apply(s, deletePromotion(s, r.promotion.id, ctx()))
    expect(listOf(s.promotions)).toEqual([])
  })
  test('settings: scale layout, pincode, default list', () => {
    const s = shop()
    expect(() => savePricingSettings(s, { scale: { itemDigits: 8, valueDigits: 6 } }, ctx())).toThrow(/more than the 12 digits/)
    expect(() => savePricingSettings(s, { sellerPin: '12' }, ctx())).toThrow(/6 digits/)
    expect(() => savePricingSettings(s, { defaultListId: 'ghost' }, ctx())).toThrow(/no longer exists/)
    expect(savePricingSettings(s, { sellerPin: '411001', legalName: 'X' }, ctx()).settings).toEqual({ id: 'settings', sellerPin: '411001', legalName: 'X' })
  })
})

describe('e-invoice and e-way bill records', () => {
  const setup = () => {
    let s = shop()
    const r = saveBill(s, sale(s, [cartLine(s, 'v1', 60)], { customerId: 'c1' }), ctx())
    s = apply(s, r)
    return { s, bill: r.bill }
  }
  test('prepare, record the IRN, refuse changes after, mark cancelled', () => {
    let { s, bill } = setup()
    const prep = saveEInvoiceDetails(s, bill.id, { addr1: ' 5 Brigade Rd ', loc: 'Bengaluru', pin: '560 001' }, ctx())
    expect(prep.record).toMatchObject({ id: eInvoiceId(bill.id), status: 'prepared', billNo: bill.no, docType: 'INV', buyer: { addr1: '5 Brigade Rd', pin: '560001' } })
    s = apply(s, prep)
    expect(() => saveEInvoiceDetails(s, bill.id, { pin: '12' }, ctx())).toThrow(/6 digits/)
    expect(() => recordIrn(s, bill.id, { irn: 'short', ackNo: '1', ackDate: '' }, ctx())).toThrow(/64/)
    expect(() => recordIrn(s, bill.id, { irn: IRN, ackNo: ' ', ackDate: '' }, ctx())).toThrow(/acknowledgement/)
    const reg = recordIrn(s, bill.id, { irn: IRN.toUpperCase(), ackNo: '1120', ackDate: '2026-10-19 10:30:00', signedQr: 'eyJ.qr' }, ctx())
    s = apply(s, reg)
    expect(s.eInvoices[eInvoiceId(bill.id)]).toMatchObject({ status: 'registered', irn: IRN, signedQr: 'eyJ.qr', buyer: { loc: 'Bengaluru' } })
    expect(() => saveEInvoiceDetails(s, bill.id, {}, ctx())).toThrow(/already has an IRN/)
    expect(() => recordIrn(s, bill.id, { irn: 'e'.repeat(64), ackNo: '1', ackDate: '' }, ctx())).toThrow(/different IRN/)
    expect(() => cancelEInvoice(s, bill.id, ' ', ctx())).toThrow(/why/)
    s = apply(s, cancelEInvoice(s, bill.id, 'wrong buyer', ctx()))
    expect(s.eInvoices[eInvoiceId(bill.id)].status).toBe('cancelled')
    expect(() => recordIrn(s, bill.id, { irn: IRN, ackNo: '1', ackDate: '' }, ctx())).toThrow(/cancelled/)
  })
  test('one IRN belongs to one bill', () => {
    let { s, bill } = setup()
    s = apply(s, recordIrn(s, bill.id, { irn: IRN, ackNo: '1', ackDate: '' }, ctx()))
    const second = saveBill(s, sale(s, [cartLine(s, 'v1', 2)], { customerId: 'c1', now: NOW + 5 }), ctx({ now: NOW + 5 }))
    s = apply(s, second)
    expect(() => recordIrn(s, second.bill.id, { irn: IRN, ackNo: '2', ackDate: '' }, ctx())).toThrow(/already recorded against/)
  })
  test('an e-way bill: transport, number, cancel', () => {
    let { s, bill } = setup()
    expect(() => saveEwayDetails(s, bill.id, { transport: { mode: 'road', distanceKm: 5000 } }, ctx())).toThrow(/4000/)
    expect(() => saveEwayDetails(s, bill.id, { transport: { mode: 'road', distanceKm: 10, vehicleNo: 'bad' } }, ctx())).toThrow(/MH12AB1234/)
    const prep = saveEwayDetails(s, bill.id, { transport: { mode: 'road', distanceKm: 840.4, vehicleNo: 'mh12 ab-1234', transporterName: ' Sai ' }, shipTo: { pin: '560001' } }, ctx())
    expect(prep.record.transport).toEqual({ mode: 'road', distanceKm: 840, vehicleNo: 'MH12AB1234', transporterName: 'Sai' })
    s = apply(s, prep)
    expect(() => recordEwayBill(s, bill.id, { ewbNo: '123' }, ctx())).toThrow(/12 digits/)
    expect(() => recordEwayBill(s, bill.id, { ewbNo: '271000123456', validUpto: '5 Nov' }, ctx())).toThrow(/YYYY-MM-DD/)
    s = apply(s, recordEwayBill(s, bill.id, { ewbNo: '2710 0012 3456', validUpto: '2026-10-24' }, ctx()))
    expect(s.ewayBills[ewayId(bill.id)]).toMatchObject({ status: 'generated', ewbNo: '271000123456', transport: { distanceKm: 840 } })
    expect(() => saveEwayDetails(s, bill.id, { transport: { mode: 'road', distanceKm: 1 } }, ctx())).toThrow(/already has a number/)
    s = apply(s, cancelEwayBill(s, bill.id, 'goods not sent', ctx()))
    expect(s.ewayBills[ewayId(bill.id)].status).toBe('cancelled')
  })
  test('a parked bill cannot be invoiced', () => {
    const s = shop()
    const held = saveBill(s, { ...sale(s, [cartLine(s, 'v1')]), status: 'held' }, ctx())
    expect(() => saveEInvoiceDetails(apply(s, held), held.bill.id, {}, ctx())).toThrow(/parked/)
  })
})

describe('price-embedded barcodes', () => {
  const on = { ...DEFAULT_SCALE, enabled: true }
  test('make and read agree for every kind of value', () => {
    for (const [value, v, expected] of [['weight_g', 1250, 1250], ['weight_10g', 1250, 1250], ['price_rupees', 250, 250], ['price_paise', 25.75, 25.75]] as const) {
      const code = makeScaleBarcode({ ...on, value }, '123', v)!
      expect(code).toHaveLength(13)
      expect(parseScaleBarcode(code, { ...on, value })).toMatchObject({ item: '00123', value: expected })
    }
  })
  test('refuses what does not fit', () => {
    expect(makeScaleBarcode(on, '123456', 100)).toBeNull()
    expect(makeScaleBarcode(on, 'ab', 100)).toBeNull()
    expect(makeScaleBarcode(on, '1', 100000)).toBeNull()
    expect(makeScaleBarcode({ ...on, prefix: 'x' }, '1', 5)).toBeNull()
  })
  test('a label the app printed sells the right amount once the settings are saved', () => {
    let s = shop()
    s.variants = { ...s.variants, v1: { ...s.variants.v1, barcode: '00123', price: 80 } }
    s.products = { ...s.products, p1: { ...s.products.p1, unit: 'kg', fractional: true } }
    s = apply(s, savePricingSettings(s, { scale: { enabled: true } }, ctx()))
    const code = makeScaleBarcode({ ...DEFAULT_SCALE, enabled: true }, '123', 1750)!
    expect(findVariantByCode(s, code)?.scanQty).toBe(1.75)
  })
})

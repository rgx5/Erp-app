import { saveBill, processReturn } from '@/data/ops'
import { ctx } from '@/data/__tests__/helpers'
import { applyChanges, type DataState } from '@/data/state'
import { buildEInvoice, eInvoiceFile, eInvoiceSkipReason, financialYear, parseIrpResponse, portalDate, uqc } from '../einvoice'
import { buildEway, ewayFile, ewbNeeded, ewbValidityDays, vehicleProblem } from '../eway'
import type { PricingSettings } from '../types'
import { cartLine, KA, sale, shop } from './helpers'

const settings: PricingSettings = { id: 'settings', sellerPin: '411001', legalName: 'Test Store Pvt Ltd' }
const buyer = { addr1: '5 Brigade Road', loc: 'Bengaluru', pin: '560001' }

function sold(qty = 2, over: Parameters<typeof sale>[2] = { customerId: 'c1' }) {
  let s: DataState = shop()
  const r = saveBill(s, sale(s, [cartLine(s, 'v1', qty), cartLine(s, 'v3', 1)], over), ctx())
  s = applyChanges(s, r.changes)
  return { s, bill: r.bill }
}

describe('e-invoice payload', () => {
  test('an inter-state invoice in the portal’s schema, ready to export', () => {
    const { s, bill } = sold()
    const { payload: p, problems } = buildEInvoice({ bill, store: s.store!, settings, customer: s.customers.c1, record: { buyer } })
    expect(problems).toEqual([])
    expect(p.Version).toBe('1.1')
    expect(p.TranDtls).toEqual({ TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' })
    expect(p.DocDtls).toEqual({ Typ: 'INV', No: bill.no, Dt: '19/10/2026' })
    expect(p.SellerDtls).toMatchObject({ Gstin: s.store!.gstin, LglNm: 'Test Store Pvt Ltd', Pin: 411001, Stcd: '27', Loc: 'Pune' })
    expect(p.BuyerDtls).toMatchObject({ Gstin: KA, Pos: '29', Stcd: '29', Pin: 560001, Loc: 'Bengaluru' })
    expect(p.ItemList).toHaveLength(2)
    expect(p.ItemList[0]).toMatchObject({ SlNo: '1', HsnCd: '6205', Unit: 'NOS', IsServc: 'N', CgstAmt: 0, SgstAmt: 0, GstRt: 5 })
    expect(p.ItemList[0].IgstAmt).toBeGreaterThan(0)
    // the portal checks the items against the totals
    const items = p.ItemList.reduce((t, i) => t + i.TotItemVal, 0)
    expect(Math.abs(items + p.ValDtls.RndOffAmt - p.ValDtls.TotInvVal)).toBeLessThan(0.011)
    expect(p.ValDtls.TotInvVal).toBe(bill.total)
    expect(p.ValDtls.IgstVal).toBe(bill.igstTotal)
    expect(JSON.parse(eInvoiceFile([p]))).toEqual([p])
  })
  test('a local B2B invoice carries CGST and SGST', () => {
    const { s, bill } = sold(1, { customerId: 'c1', info: { placeOfSupply: '27' } })
    const { payload: p, problems } = buildEInvoice({ bill, store: s.store!, settings, customer: s.customers.c1, record: { buyer } })
    expect(problems).toEqual([])
    expect(p.ValDtls.IgstVal).toBe(0)
    expect(p.ValDtls.CgstVal).toBeGreaterThan(0)
    expect(p.BuyerDtls.Pos).toBe('27')
  })
  test('says everything the portal would refuse', () => {
    const { s, bill } = sold()
    const none = buildEInvoice({ bill, store: s.store!, settings: null, customer: s.customers.c1 }).problems.join('\n')
    expect(none).toMatch(/pincode in the e-invoice settings/)
    expect(none).toMatch(/buyer’s address/)
    expect(none).toMatch(/buyer’s city/)
    expect(none).toMatch(/buyer’s 6-digit pincode/)
    const noHsn = { ...bill, items: bill.items.map((i) => ({ ...i, hsn: '' })) }
    expect(buildEInvoice({ bill: noHsn, store: s.store!, settings, customer: s.customers.c1, record: { buyer } }).problems.join()).toMatch(/HSN code must be 4, 6 or 8 digits/)
    expect(buildEInvoice({ bill: { ...bill, no: 'INV-0000000000000001' }, store: s.store!, settings, customer: s.customers.c1, record: { buyer } }).problems.join()).toMatch(/cannot go to the portal/)
  })
  test('not for walk-in retail, a bill of supply or a composition dealer', () => {
    const r = sold(1, { customerId: 'c2' })
    expect(eInvoiceSkipReason(r.bill, r.s.store, r.s.customers.c2)).toMatch(/no buyer GSTIN/)
    const comp = shop({ registrationType: 'composition' })
    const cb = saveBill(comp, sale(comp, [cartLine(comp, 'v1')], { customerId: 'c1' }), ctx()).bill
    expect(eInvoiceSkipReason(cb, comp.store, comp.customers.c1)).toMatch(/Composition/)
  })
  test('a credit note is a CRN against the invoice, with positive amounts', () => {
    const { s, bill } = sold(2)
    const ret = processReturn(s, bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', ctx({ now: bill.date + 1000 }))
    const cn = ret.creditNote
    const { payload: p, problems } = buildEInvoice({ bill: cn, store: s.store!, settings, customer: s.customers.c1, record: { buyer }, original: bill })
    expect(problems).toEqual([])
    expect(p.DocDtls.Typ).toBe('CRN')
    expect(p.PrecDocDtls).toEqual([{ InvNo: bill.no, InvDt: '19/10/2026' }])
    expect(p.ValDtls.TotInvVal).toBe(Math.abs(cn.total))
    expect(p.ItemList.every((i) => i.TotAmt > 0)).toBe(true)
    expect(buildEInvoice({ bill: cn, store: s.store!, settings, customer: s.customers.c1, record: { buyer } }).problems.join()).toMatch(/invoice it is against/)
  })
  test('helpers: dates, financial year, units', () => {
    expect(portalDate(new Date(2026, 3, 1).getTime())).toBe('01/04/2026')
    expect(financialYear(new Date(2026, 2, 31).getTime())).toBe('2025-26')
    expect(financialYear(new Date(2026, 3, 1).getTime())).toBe('2026-27')
    expect([uqc('kg'), uqc('pc'), uqc('plate'), uqc(undefined)]).toEqual(['KGS', 'PCS', 'OTH', 'NOS'])
  })
})

describe('the portal’s answer', () => {
  const irn = 'a'.repeat(32) + 'B'.repeat(32)
  test('reads the IRN, acknowledgement and signed QR wherever they sit', () => {
    const r = parseIrpResponse(JSON.stringify({ Status: 1, Data: { AckNo: 112010012345678, AckDt: '2026-10-19 10:30:00', Irn: irn, SignedInvoice: 'eyJ.inv', SignedQRCode: 'eyJ.qr' } }))
    expect(r).toEqual({ ok: true, ack: { irn: irn.toLowerCase(), ackNo: '112010012345678', ackDate: '2026-10-19 10:30:00', signedQr: 'eyJ.qr', signedInvoice: 'eyJ.inv' } })
  })
  test('refuses what is not a registration', () => {
    expect(parseIrpResponse('hello')).toMatchObject({ ok: false, message: expect.stringMatching(/not JSON/) })
    expect(parseIrpResponse('{"Status":0}')).toMatchObject({ ok: false, message: expect.stringMatching(/No IRN/) })
    expect(parseIrpResponse('{"Irn":"abc","AckNo":1}')).toMatchObject({ ok: false, message: expect.stringMatching(/64/) })
    expect(parseIrpResponse(`{"Irn":"${irn}"}`)).toMatchObject({ ok: false, message: expect.stringMatching(/acknowledgement/) })
  })
})

describe('e-way bill payload', () => {
  const transport = { mode: 'road' as const, distanceKm: 840, vehicleNo: 'mh 12 ab 1234' }
  test('Part A and Part B in the portal’s format, and the bulk file', () => {
    const { s, bill } = sold(60)
    const { payload: p, problems } = buildEway({ bill, store: s.store!, settings, customer: s.customers.c1, buyer, record: { transport } })
    expect(problems).toEqual([])
    expect(p).toMatchObject({ supplyType: 'O', subSupplyType: 1, docType: 'INV', docNo: bill.no, docDate: '19/10/2026', fromGstin: s.store!.gstin, fromPincode: 411001, fromStateCode: 27, toGstin: KA, toPincode: 560001, toStateCode: 29, transMode: 1, transDistance: 840, vehicleNo: 'MH12AB1234', vehicleType: 'R' })
    expect(p.totInvValue).toBe(bill.total)
    expect(p.igstValue).toBe(bill.igstTotal)
    expect(p.totalValue + p.igstValue + p.cgstValue + p.sgstValue + p.otherValue).toBeCloseTo(p.totInvValue, 2)
    expect(p.itemList[0]).toMatchObject({ hsnCode: 6205, qtyUnit: 'NOS', igstRate: 5, cgstRate: 0, sgstRate: 0 })
    expect(JSON.parse(ewayFile([p]))).toEqual({ version: '1.0.0621', billLists: [p] })
  })
  test('needs a vehicle or a transporter, pincodes and sensible numbers', () => {
    const { s, bill } = sold(60)
    const text = buildEway({ bill, store: s.store!, settings: null, customer: s.customers.c1, record: { transport: { mode: 'road', distanceKm: 9000, vehicleNo: 'X1' } } }).problems.join('\n')
    expect(text).toMatch(/dispatch pincode/)
    expect(text).toMatch(/delivery pincode/)
    expect(text).toMatch(/0 and 4000/)
    expect(text).toMatch(/MH12AB1234/)
    const t = buildEway({ bill, store: s.store!, settings, customer: s.customers.c1, buyer, record: { transport: { mode: 'road', distanceKm: 0, transporterId: s.store!.gstin } } })
    expect(t.problems).toEqual([])
    expect(buildEway({ bill, store: s.store!, settings, customer: s.customers.c1, buyer, record: { transport: { mode: 'road', distanceKm: 10 } } }).problems.join()).toMatch(/vehicle number, or the transporter/)
  })
  test('a sale to an unregistered buyer goes to URP', () => {
    const { s, bill } = sold(60, { customerId: 'c2', info: { placeOfSupply: '29' } })
    expect(buildEway({ bill, store: s.store!, settings, customer: s.customers.c2, buyer, record: { transport } }).payload.toGstin).toBe('URP')
  })
  test('when one is needed, how long it lasts, vehicle numbers', () => {
    const { s, bill } = sold(60)
    expect(ewbNeeded(bill, settings).needed).toBe(true)
    const small = sold(1).bill
    expect(ewbNeeded(small, settings)).toMatchObject({ needed: false })
    expect(ewbNeeded(small, { ...settings, ewbThreshold: 1000 }).needed).toBe(true)
    expect(ewbNeeded({ ...bill, total: -5 }, settings).needed).toBe(false)
    expect(ewbValidityDays(840)).toBe(5)
    expect(ewbValidityDays(0)).toBe(1)
    expect(ewbValidityDays(100, true)).toBe(5)
    expect(vehicleProblem('MH12AB1234')).toBeNull()
    expect(vehicleProblem('22BH1234AA')).toBeNull()
    expect(vehicleProblem('hello')).not.toBeNull()
    expect(s).toBeTruthy()
  })
})

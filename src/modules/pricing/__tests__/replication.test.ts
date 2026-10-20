import { ctx, NOW } from '@/data/__tests__/helpers'
import { saveBill, processReturn } from '@/data/ops'
import { rig, actorWith } from '@/replication/testkit'
import { adjustLines } from '../../registry'
import { assignPriceList, recordEwayBill, recordIrn, saveBreakRule, saveEInvoiceDetails, saveEwayDetails, savePriceList, savePricingSettings, savePromotion, setListPrices } from '../ops'
import { eInvoiceId } from '../types'
import { cartLine, shop, sale } from './helpers'

const IRN = '0123456789abcdef'.repeat(4)
const POOLS = ['priceLists', 'priceListItems', 'qtyBreakRules', 'promotions', 'pricingSettings', 'eInvoices', 'ewayBills', 'bills', 'customers'] as const

describe('the server ends up with exactly what the phone has', () => {
  test('price lists, rules, promotions and settings', async () => {
    const r = rig(shop())
    await r.seed()
    const made = await r.run((s) => savePriceList(s, { name: 'Trade', tier: 'dealer', basis: 'cost', pct: 25, roundTo: 5 }, undefined, ctx({ now: NOW + 1 })))
    await r.run((s) => setListPrices(s, made.list.id, [{ variantId: 'v1', price: 700 }, { variantId: 'v3', price: 1100 }], ctx({ now: NOW + 2 })))
    await r.run((s) => assignPriceList(s, 'c2', made.list.id, ctx({ now: NOW + 3 })))
    await r.run((s) => saveBreakRule(s, { name: 'Shirts', target: 'product', targetId: 'p1', listId: '', breaks: [{ minQty: 6, kind: 'pct', value: 5 }] }, undefined, ctx({ now: NOW + 4 })))
    await r.run((s) => savePromotion(s, { kind: 'happy_hour', name: 'Tea time', active: true, priority: 0, scope: { all: true }, startTime: '16:00', endTime: '18:00', off: { type: 'pct', value: 10 } }, undefined, ctx({ now: NOW + 5 })))
    await r.run((s) => savePromotion(s, { kind: 'bundle', name: 'Outfit', active: true, priority: 1, items: [{ variantId: 'v1', qty: 1 }, { variantId: 'v3', qty: 1 }], price: 2000 }, undefined, ctx({ now: NOW + 6 })))
    await r.run((s) => savePricingSettings(s, { scale: { enabled: true, valueDigits: 5 }, defaultListId: made.list.id, sellerPin: '411001' }, ctx({ now: NOW + 7 })))
    await r.run((s) => setListPrices(s, made.list.id, [{ variantId: 'v1', price: null }], ctx({ now: NOW + 8 })))
    const server = await r.serverView()
    for (const k of POOLS) expect(server[k]).toEqual(r.phone[k])
    expect(Object.keys(server.priceListItems)).toEqual([`${made.list.id}:v3`])
  })

  test('a B2B sale, its e-invoice and e-way bill records, a return', async () => {
    const r = rig(shop())
    await r.seed()
    const lines = [cartLine(r.phone, 'v1', 60)]
    const { bill } = await r.run((s) => saveBill(s, sale(s, lines, { customerId: 'c1', info: { buyerGstin: r.phone.customers.c1.gstin, reverseCharge: false } }), ctx({ now: NOW + 1 })))
    expect(bill.igstTotal).toBeGreaterThan(0)
    await r.run((s) => saveEInvoiceDetails(s, bill.id, { addr1: '5 Brigade Rd', loc: 'Bengaluru', pin: '560001' }, ctx({ now: NOW + 2 })))
    await r.run((s) => recordIrn(s, bill.id, { irn: IRN, ackNo: '1120', ackDate: '2026-10-19 10:30:00', signedQr: 'eyJ.qr' }, ctx({ now: NOW + 3 })))
    await r.run((s) => saveEwayDetails(s, bill.id, { transport: { mode: 'road', distanceKm: 840, vehicleNo: 'MH12AB1234' } }, ctx({ now: NOW + 4 })))
    await r.run((s) => recordEwayBill(s, bill.id, { ewbNo: '271000123456', validUpto: '2026-10-24' }, ctx({ now: NOW + 5 })))
    await r.run((s) => processReturn(s, bill.id, [{ variantId: 'v1', qty: 2 }], 'cash', ctx({ now: NOW + 6 })))
    const server = await r.serverView()
    for (const k of POOLS) expect(server[k]).toEqual(r.phone[k])
    expect(server.bills[bill.id].ext).toEqual({ pricing: expect.objectContaining({ interState: true, taxMode: 'tax_invoice' }) })
    expect(server.eInvoices[eInvoiceId(bill.id)]).toMatchObject({ status: 'registered', irn: IRN })
    expect(Object.values(server.bills).find((b) => b.refundOfBillId)?.igstTotal).toBeGreaterThan(0)
  })

  test('the bill the phone priced is the bill the server holds, promotions and list prices included', async () => {
    const r = rig(shop())
    await r.seed()
    await r.run((s) => savePromotion(s, { kind: 'category_sale', name: 'Jeans sale', active: true, priority: 0, scope: { categoryIds: ['cat_jeans'] }, off: { type: 'pct', value: 20 } }, undefined, ctx({ now: NOW + 1 })))
    const lines = [cartLine(r.phone, 'v1', 2), cartLine(r.phone, 'v3', 1)]
    const priced = adjustLines(lines, { state: r.phone, customerId: 'c1', extras: {} })
    const { bill } = await r.run((s) => saveBill(s, sale(s, lines, { customerId: 'c1' }), ctx({ now: NOW + 2 })))
    expect(priced.map((l) => l.price)).toEqual(bill.items.map((i) => i.price))
    expect(bill.items[1].ext).toMatchObject({ pricing: { listId: 'pl_ws', promos: [{ name: 'Jeans sale' }] } })
    expect((await r.serverView()).bills[bill.id]).toEqual(bill)
  })

  test('only a manager changes prices; a cashier can read them and sell on them', async () => {
    const cashier = actorWith(['pos', 'customers'], 'u_cash')
    const owner = rig(shop())
    await owner.seed()
    await owner.run((s) => savePriceList(s, { name: 'Trade', tier: 'dealer', basis: 'cost', pct: 25, roundTo: 0 }, undefined, ctx({ now: NOW + 1 })))
    // a cashier’s attempt to change a price list is refused by the server
    const attempt = savePriceList(shop(), { name: 'Sneaky', tier: 'retail', basis: 'price', pct: -90, roundTo: 0 }, undefined, ctx())
    const forbidden = rig(shop(), cashier)
    await expect(forbidden.send([{ mid: 'c:1', coll: 'priceLists', id: attempt.list.id, op: 'create', data: attempt.list as never, at: 1 }])).rejects.toThrow(/forbidden/)
    // …but reads the shop's lists
    const view = await owner.serverView(cashier)
    expect(Object.keys(view.priceLists)).toHaveLength(3)
    // and a document that breaks a rule is invalid even for the owner
    await expect(owner.send([{ mid: 'o:1', coll: 'promotions', id: 'pr_bad', op: 'create', data: { id: 'pr_bad', kind: 'bundle', name: 'x', items: [], price: 0, active: true, priority: 0 }, at: 1 }])).rejects.toThrow(/invalid/)
    await expect(owner.send([{ mid: 'o:2', coll: 'eInvoices', id: 'ei_b', op: 'create', data: { id: 'ei_b', billId: 'b', status: 'registered', irn: 'short' }, at: 1 }])).rejects.toThrow(/invalid/)
  })
})

import { ctx, NOW } from '@/data/__tests__/helpers'
import { OpError, receivePurchase } from '@/data/ops'
import { applyChanges, listOf } from '@/data/state'
import { isBalanced, postingsFor } from '@/modules/postings'
import '@/modules/accounting/postings'
import { rig } from '@/replication/testkit'
import { allocateLanded, capitalised, claimableGst, shares } from '../landed'
import { itcRegister } from '../itc'
import { payables } from '../payables'
import { recordLandedCost, reverseLandedCost } from '../ops-landed'
import { recordPurchaseInvoice } from '../ops-invoices'
import { paySupplier } from '../ops-payables'
import { recordPurchaseReturn, reversePurchaseReturn } from '../ops-returns'
import { returnableQty, returnsList, returnTotals } from '../returns'
import { purchasingState, withReceipt, DAY } from './helpers'

describe('purchase returns and debit notes', () => {
  test('totals: goods at cost plus the GST charged on them', () => {
    expect(returnTotals([{ qty: 2, cost: 400, rate: 5 }, { qty: 1, cost: 410, rate: 12 }], false)).toEqual({ taxable: 1210, cgst: 44.6, sgst: 44.6, igst: 0, total: 1299.2 })
    expect(returnTotals([{ qty: 2, cost: 400, rate: 5 }], true)).toMatchObject({ igst: 40, cgst: 0, total: 840 })
  })

  test('stock goes out, what is owed goes down, and it is numbered', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const r = recordPurchaseReturn(state, { supplierId: 's1', purchaseId: purchase.id, reason: 'damaged', items: [{ variantId: 'v1', qty: 3, rate: 5 }] }, ctx({ now: NOW + 1 }))
    expect(r.debitNote).toMatchObject({ no: 'DN-0001', taxable: 1200, cgst: 30, sgst: 30, total: 1260, itcReversed: false })
    const after = applyChanges(state, r.changes)
    expect(after.variants.v1.stock).toBe(state.variants.v1.stock - 3)
    expect(listOf(after.moves).find((m) => m.type === 'return' && m.ref === 'DN-0001')).toMatchObject({ qty: -3, variantId: 'v1' })
    expect(payables(after).bySupplier.s1.net).toBe(6050 - 1260)
  })

  test('only what arrived, and only what is still in stock, can go back', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const d = (qty: number) => ({ supplierId: 's1', purchaseId: purchase.id, reason: 'excess' as const, items: [{ variantId: 'v2', qty, rate: 0 }] })
    expect(() => recordPurchaseReturn(state, d(6), ctx())).toThrow('left to send back') // 5 arrived
    const one = applyChanges(state, recordPurchaseReturn(state, d(4), ctx()).changes)
    expect(returnableQty(one, purchase.id)).toEqual({ v1: 10, v2: 1 })
    expect(() => recordPurchaseReturn(one, d(2), ctx())).toThrow('1 of')
    const empty = { ...state, variants: { ...state.variants, v2: { ...state.variants.v2, stock: 1 } } }
    expect(() => recordPurchaseReturn(empty, d(3), ctx())).toThrow('in stock')
  })

  test('other refusals', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const ok = { supplierId: 's1', purchaseId: purchase.id, reason: 'wrong' as const, items: [{ variantId: 'v1', qty: 1, rate: 5 }] }
    expect(() => recordPurchaseReturn(state, { ...ok, items: [] }, ctx())).toThrow('Choose the goods')
    expect(() => recordPurchaseReturn(state, { ...ok, supplierId: 'nope' }, ctx())).toThrow(OpError)
    expect(() => recordPurchaseReturn(state, { ...ok, supplierId: 's2' }, ctx())).toThrow('different supplier')
    expect(() => recordPurchaseReturn(state, { ...ok, items: [{ variantId: 'v1', qty: 0, rate: 5 }] }, ctx())).toThrow('quantity')
    expect(() => recordPurchaseReturn(state, { ...ok, items: [{ variantId: 'v1', qty: 1, rate: 5 }, { variantId: 'v1', qty: 1, rate: 5 }] }, ctx())).toThrow('once')
    expect(() => recordPurchaseReturn(state, { ...ok, refund: 99999, refundMode: 'cash' }, ctx())).toThrow('more than the debit note')
    expect(() => recordPurchaseReturn(state, { ...ok, refund: 100 }, ctx())).toThrow('how the supplier')
  })

  test('credit that was claimed is given back; the register shows it', () => {
    let { state, purchase } = withReceipt(purchasingState(), { total: 6300 })
    state = applyChanges(state, recordPurchaseInvoice(state, { supplierId: 's1', invoiceNo: 'G-1', invoiceDate: NOW, kind: 'goods', purchaseId: purchase.id, lines: [{ description: '', hsn: '', taxable: 6000, rate: 5 }] }, ctx({ now: NOW })).changes)
    const r = recordPurchaseReturn(state, { supplierId: 's1', purchaseId: purchase.id, reason: 'quality', items: [{ variantId: 'v1', qty: 4, rate: 5 }] }, ctx({ now: NOW + 1 }))
    expect(r.debitNote).toMatchObject({ itcReversed: true, invoiceId: expect.any(String), total: 1680 })
    state = applyChanges(state, r.changes)
    const reg = itcRegister(state, NOW - DAY, NOW + DAY)
    expect(reg.eligible.total).toBe(300)
    expect(reg.reversed).toEqual({ cgst: 40, sgst: 40, igst: 0, total: 80 })
    expect(reg.net.total).toBe(220)
    const dn = postingsFor(state).find((p) => p.sourceColl === 'purchaseReturns')!
    expect(isBalanced(dn)).toBe(true)
    expect(dn.lines).toEqual([
      { account: 'payables', debit: 1680, party: { type: 'supplier', id: 's1' } }, { account: 'inventory', credit: 1600 },
      { account: 'gst_input_cgst', credit: 40 }, { account: 'gst_input_sgst', credit: 40 },
    ])
  })

  test('money handed back at once: books balance and the debt falls by the rest only', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const r = recordPurchaseReturn(state, { supplierId: 's1', purchaseId: purchase.id, reason: 'damaged', items: [{ variantId: 'v1', qty: 2, rate: 0 }], refund: 300, refundMode: 'upi' }, ctx())
    const after = applyChanges(state, r.changes)
    expect(payables(after).bySupplier.s1.net).toBe(6050 - 500)
    const dn = postingsFor(after).find((p) => p.sourceColl === 'purchaseReturns')!
    expect(isBalanced(dn)).toBe(true)
    expect(dn.lines).toContainEqual({ account: 'upi', debit: 300 })
  })

  test('cancelling puts the goods back and the debt returns', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const made = recordPurchaseReturn(state, { supplierId: 's1', purchaseId: purchase.id, reason: 'damaged', items: [{ variantId: 'v1', qty: 2, rate: 5 }] }, ctx({ now: NOW + 1 }))
    const have = applyChanges(state, made.changes)
    const back = applyChanges(have, reversePurchaseReturn(have, made.debitNote.id, '', ctx({ now: NOW + 2 })).changes)
    expect(back.variants.v1.stock).toBe(state.variants.v1.stock)
    expect(payables(back).total).toBe(6050)
    expect(returnsList(back)).toHaveLength(1)
    expect(returnsList(back)[0].reversed).toBe(true)
    expect(returnableQty(back, purchase.id).v1).toBe(10)
    expect(postingsFor(back).filter((p) => p.sourceColl === 'purchaseReturns').every(isBalanced)).toBe(true)
  })

  test('replicates: server == phone for debit notes, stock and the supplier balance', async () => {
    const r = rig(purchasingState())
    await r.seed()
    const got = await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B', items: [{ variantId: 'v1', qty: 10, cost: 400 }], total: 4000, paid: 0, notes: '' }, ctx({ now: NOW })))
    const dn = await r.run((s) => recordPurchaseReturn(s, { supplierId: 's1', purchaseId: got.purchase.id, reason: 'damaged', items: [{ variantId: 'v1', qty: 2, rate: 5 }], refund: 100, refundMode: 'cash' }, ctx({ now: NOW + 1 })))
    await r.run((s) => recordPurchaseReturn(s, { supplierId: 's1', reason: 'other', items: [{ variantId: 'v2', qty: 1, rate: 0 }] }, ctx({ now: NOW + 2 })))
    await r.run((s) => reversePurchaseReturn(s, dn.debitNote.id, 'oops', ctx({ now: NOW + 3 })))
    const server = await r.serverView()
    expect(server.purchaseReturns).toEqual(r.phone.purchaseReturns)
    expect(server.variants).toEqual(r.phone.variants)
    expect(server.suppliers).toEqual(r.phone.suppliers)
    expect(server.suppliers.s1.payableAdjust).toBe(-400) // the one standing note: 1 × 400 (no stock-cost on v2 → avg 400)
  })
})

describe('landed cost', () => {
  test('shares cut to the paisa, the last part taking the rounding', () => {
    expect(shares(100, [1, 1, 1])).toEqual([33.33, 33.33, 33.34])
    expect(shares(10, [0, 0])).toEqual([0, 10])
    expect(shares(10, [])).toEqual([])
  })

  test('by value or by quantity, with ineligible GST capitalised', () => {
    const charges = [{ kind: 'freight' as const, label: 'Transport', amount: 1000, gst: 50, itcEligible: true }, { kind: 'duty' as const, label: 'Duty', amount: 200, gst: 20, itcEligible: false }]
    expect(capitalised(charges)).toBe(1220)
    expect(claimableGst(charges)).toBe(50)
    const lines = [{ variantId: 'v1', qty: 10, cost: 400 }, { variantId: 'v2', qty: 5, cost: 410 }]
    const byValue = allocateLanded(lines, { v1: 10, v2: 5 }, 1220, 'value')
    expect(byValue.map((l) => l.alloc)).toEqual([806.61, 413.39])
    expect(byValue.reduce((s, l) => s + l.alloc, 0)).toBeCloseTo(1220, 2)
    expect(allocateLanded(lines, { v1: 10, v2: 5 }, 1220, 'qty').map((l) => l.alloc)).toEqual([813.33, 406.67])
  })

  test('units already sold take their share to cost of goods sold', () => {
    const [l] = allocateLanded([{ variantId: 'v1', qty: 10, cost: 400 }], { v1: 4 }, 1000, 'value')
    expect(l).toMatchObject({ alloc: 1000, toStock: 400, toCogs: 600, perUnit: 100 })
  })

  const charges = [{ kind: 'freight' as const, label: 'Transport', amount: 1000, gst: 50, itcEligible: true }, { kind: 'duty' as const, label: 'Duty', amount: 200, gst: 20, itcEligible: false }]

  test('item costs rise by their share; the latest cost moves only when this receipt set it', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const stock = state.variants
    const r = recordLandedCost(state, { purchaseId: purchase.id, charges, payeeId: 's2' }, ctx({ now: NOW + 1 }))
    expect(r.landed).toMatchObject({ no: 'LC-0001', total: 1270, itc: 50 })
    const after = applyChanges(state, r.changes)
    const v1 = r.landed.lines.find((l) => l.variantId === 'v1')!
    expect(after.variants.v1.avgCost).toBeCloseTo((stock.v1.avgCost ?? 0) + v1.toStock / stock.v1.stock, 2)
    expect(after.variants.v1.cost).toBeCloseTo(stock.v1.cost + v1.alloc / 10, 2)
    expect(after.variants.v1.stock).toBe(stock.v1.stock)
    // a later receipt at a different cost: the latest cost is that receipt's, so it stays
    const later = receivePurchase(after, { supplierId: 's1', date: NOW + 5, invoiceRef: 'x', items: [{ variantId: 'v1', qty: 1, cost: 500 }], total: 500, paid: 0, notes: '' }, ctx({ now: NOW + 5 }))
    const s2 = applyChanges(after, later.changes)
    const r2 = recordLandedCost(s2, { purchaseId: purchase.id, charges: [charges[0]], payeeId: 's2' }, ctx({ now: NOW + 6 }))
    expect(r2.landed.lines.find((l) => l.variantId === 'v1')!.latestUp).toBe(0)
  })

  test('the transporter is owed the bill; paid on the spot it is not', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const owed = applyChanges(state, recordLandedCost(state, { purchaseId: purchase.id, charges, payeeId: 's2' }, ctx()).changes)
    expect(payables(owed).bySupplier.s2.net).toBe(1270)
    expect(payables(owed).bySupplier.s1.net).toBe(6050)
    const cash = applyChanges(state, recordLandedCost(state, { purchaseId: purchase.id, charges, mode: 'cash' }, ctx()).changes)
    expect(payables(cash).bySupplier.s2).toBeUndefined()
  })

  test('postings balance, with credit for the claimable GST and cost for the rest', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const owed = applyChanges(state, recordLandedCost(state, { purchaseId: purchase.id, charges, payeeId: 's2' }, ctx()).changes)
    const p = postingsFor(owed).find((x) => x.sourceColl === 'landedCosts')!
    expect(isBalanced(p)).toBe(true)
    expect(p.lines).toEqual([
      { account: 'inventory', debit: 1220 }, { account: 'gst_input_igst', debit: 50 }, // s2 is in another state
      { account: 'payables', credit: 1270, party: { type: 'supplier', id: 's2' } },
    ])
    const cash = applyChanges(state, recordLandedCost(state, { purchaseId: purchase.id, charges, mode: 'bank', interState: true }, ctx()).changes)
    const q = postingsFor(cash).find((x) => x.sourceColl === 'landedCosts')!
    expect(isBalanced(q)).toBe(true)
    expect(q.lines).toContainEqual({ account: 'gst_input_igst', debit: 50 })
    expect(q.lines).toContainEqual({ account: 'bank', credit: 1270 })
  })

  test('sold units go to cost of goods sold', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const sold = { ...state, variants: { ...state.variants, v1: { ...state.variants.v1, stock: 0 }, v2: { ...state.variants.v2, stock: 0 } } }
    const r = recordLandedCost(sold, { purchaseId: purchase.id, charges: [charges[0]], mode: 'cash' }, ctx())
    expect(r.landed.lines.every((l) => l.toStock === 0)).toBe(true)
    const p = postingsFor(applyChanges(sold, r.changes)).find((x) => x.sourceColl === 'landedCosts')!
    expect(p.lines.find((l) => l.account === 'cogs')).toMatchObject({ debit: 1000 })
    expect(isBalanced(p)).toBe(true)
    expect(applyChanges(sold, r.changes).variants.v1.avgCost).toBe(sold.variants.v1.avgCost)
  })

  test('cancelling restores the costs and the debt', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const made = recordLandedCost(state, { purchaseId: purchase.id, charges, payeeId: 's2' }, ctx({ now: NOW + 1 }))
    const have = applyChanges(state, made.changes)
    const back = applyChanges(have, reverseLandedCost(have, made.landed.id, '', ctx({ now: NOW + 2 })).changes)
    expect(back.variants.v1.avgCost).toBeCloseTo(state.variants.v1.avgCost as number, 2)
    expect(back.variants.v1.cost).toBeCloseTo(state.variants.v1.cost, 2)
    expect(payables(back).bySupplier.s2).toBeUndefined()
    expect(postingsFor(back).filter((p) => p.sourceColl === 'landedCosts').every(isBalanced)).toBe(true)
  })

  test('refusals', () => {
    const { state, purchase } = withReceipt(purchasingState())
    expect(() => recordLandedCost(state, { purchaseId: 'nope', charges, mode: 'cash' }, ctx())).toThrow('receipt')
    expect(() => recordLandedCost(state, { purchaseId: purchase.id, charges: [], mode: 'cash' }, ctx())).toThrow('at least one')
    expect(() => recordLandedCost(state, { purchaseId: purchase.id, charges }, ctx())).toThrow('who bills')
    expect(() => recordLandedCost(state, { purchaseId: purchase.id, charges, payeeId: 'zz' }, ctx())).toThrow('no longer exists')
  })

  test('replicates: server == phone for landed costs, item costs and the transporter’s balance', async () => {
    const r = rig(purchasingState())
    await r.seed()
    const got = await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B', items: [{ variantId: 'v1', qty: 10, cost: 400 }, { variantId: 'v2', qty: 5, cost: 410 }], total: 6050, paid: 0, notes: '' }, ctx({ now: NOW })))
    const lc = await r.run((s) => recordLandedCost(s, { purchaseId: got.purchase.id, charges, payeeId: 's2' }, ctx({ now: NOW + 1 })))
    await r.run((s) => recordLandedCost(s, { purchaseId: got.purchase.id, charges: [charges[0]], mode: 'cash' }, ctx({ now: NOW + 2 })))
    await r.run((s) => reverseLandedCost(s, lc.landed.id, '', ctx({ now: NOW + 3 })))
    await r.run((s) => paySupplier(s, { supplierId: 's2', amount: 10, mode: 'cash' }, ctx({ now: NOW + 4 })))
    const server = await r.serverView()
    expect(server.landedCosts).toEqual(r.phone.landedCosts)
    expect(server.variants).toEqual(r.phone.variants)
    expect(server.suppliers).toEqual(r.phone.suppliers)
    expect(server.suppliers.s2.payableAdjust).toBe(-10)
  })
})

import { ctx, NOW } from '@/data/__tests__/helpers'
import { receivePurchase } from '@/data/ops'
import { applyChanges, listOf } from '@/data/state'
import { isBalanced, postingsFor } from '@/modules/postings'
import '@/modules/accounting/postings'
import { rig } from '@/replication/testkit'
import { compareQuotes, listPrice, priceOptions, quotesFromLists, suggestedCost } from '../quotes'
import { recordLandedCost } from '../ops-landed'
import { awardRfq, closeRfq, createRfq, deleteSupplierPrice, recordQuote, saveSupplierPrice } from '../ops-sourcing'
import { setPoStatus } from '../ops'
import { purchasingState, DAY } from './helpers'

function priced() {
  let s = purchasingState()
  const put = (d: Parameters<typeof saveSupplierPrice>[1], at: number) => { s = applyChanges(s, saveSupplierPrice(s, d, ctx({ now: at })).changes) }
  put({ supplierId: 's1', variantId: 'v1', price: 420 }, NOW)
  put({ supplierId: 's1', variantId: 'v1', price: 380, minQty: 50 }, NOW + 1)
  put({ supplierId: 's2', variantId: 'v1', price: 400, leadDays: 5 }, NOW + 2)
  put({ supplierId: 's2', variantId: 'v2', price: 395 }, NOW + 3)
  return s
}

describe('supplier price lists', () => {
  test('quantity breaks and validity dates', () => {
    const s = priced()
    const rows = listOf(s.supplierPrices)
    expect(listPrice(rows, 's1', 'v1', 10, NOW)?.price).toBe(420)
    expect(listPrice(rows, 's1', 'v1', 50, NOW)?.price).toBe(380)
    expect(listPrice(rows, 's1', 'v2', 1, NOW)).toBeNull()
    const expired = applyChanges(s, saveSupplierPrice(s, { supplierId: 's2', variantId: 'v2', price: 300, validTo: NOW + DAY }, ctx()).changes)
    expect(listPrice(listOf(expired.supplierPrices), 's2', 'v2', 1, NOW)?.price).toBe(300) // same row replaced…
    expect(listPrice(listOf(expired.supplierPrices), 's2', 'v2', 1, NOW + 2 * DAY)).toBeNull() // …and it has ended
  })

  test('saving the same supplier, item and break replaces the row', () => {
    const s = priced()
    expect(listOf(s.supplierPrices)).toHaveLength(4)
    const again = applyChanges(s, saveSupplierPrice(s, { supplierId: 's1', variantId: 'v1', price: 415 }, ctx()).changes)
    expect(listOf(again.supplierPrices)).toHaveLength(4)
    expect(listPrice(listOf(again.supplierPrices), 's1', 'v1', 1, NOW)?.price).toBe(415)
    const gone = applyChanges(again, deleteSupplierPrice(again, listOf(again.supplierPrices)[0].id, ctx()).changes)
    expect(listOf(gone.supplierPrices)).toHaveLength(3)
  })

  test('refusals', () => {
    const s = purchasingState()
    expect(() => saveSupplierPrice(s, { supplierId: 'x', variantId: 'v1', price: 1 }, ctx())).toThrow('supplier')
    expect(() => saveSupplierPrice(s, { supplierId: 's1', variantId: 'x', price: 1 }, ctx())).toThrow('item')
    expect(() => saveSupplierPrice(s, { supplierId: 's1', variantId: 'v1', price: 0 }, ctx())).toThrow('price')
    expect(() => saveSupplierPrice(s, { supplierId: 's1', variantId: 'v1', price: 5, validFrom: NOW, validTo: NOW - 1 }, ctx())).toThrow('end before')
  })

  test('suggested cost: the list, else what was paid last; options are cheapest first', () => {
    let s = priced()
    expect(suggestedCost(s, 's1', 'v1', 5, NOW)).toEqual({ cost: 420, from: 'list' })
    expect(suggestedCost(s, 's1', 'v2', 5, NOW)).toBeNull()
    s = applyChanges(s, receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'x', items: [{ variantId: 'v2', qty: 1, cost: 410 }], total: 410, paid: 0, notes: '' }, ctx()).changes)
    expect(suggestedCost(s, 's1', 'v2', 5, NOW)).toEqual({ cost: 410, from: 'last' })
    expect(priceOptions(s, 'v2', 1, NOW).map((o) => [o.supplierId, o.price, o.source])).toEqual([['s2', 395, 'list'], ['s1', 410, 'last']])
  })
})

describe('requests for quotation', () => {
  const ask = { title: 'Autumn shirts', items: [{ variantId: 'v1', qty: 20 }, { variantId: 'v2', qty: 10 }], supplierIds: ['s1', 's2'] }

  function quoted() {
    let s = purchasingState()
    const rfq = createRfq(s, ask, ctx()).rfq
    s = applyChanges(s, { put: { rfqs: [rfq] } })
    const q = (d: Omit<Parameters<typeof recordQuote>[1], 'rfqId'>, at: number) => { s = applyChanges(s, recordQuote(s, { ...d, rfqId: rfq.id }, ctx({ now: at })).changes) }
    q({ supplierId: 's1', prices: { v1: 400, v2: 400 }, freight: 100 }, NOW + 1)
    q({ supplierId: 's2', prices: { v1: 390, v2: 405 }, freight: 0, leadDays: 4 }, NOW + 2)
    return { s, rfq }
  }

  test('creating', () => {
    const s = purchasingState()
    const { rfq } = createRfq(s, { ...ask, items: [...ask.items, { variantId: 'v1', qty: 5 }], supplierIds: ['s1', 's1', 'ghost'] }, ctx())
    expect(rfq).toMatchObject({ no: 'RFQ-0001', status: 'open', supplierIds: ['s1'], items: [{ variantId: 'v1', qty: 25 }, { variantId: 'v2', qty: 10 }] })
    expect(() => createRfq(s, { ...ask, title: ' ' }, ctx())).toThrow('name')
    expect(() => createRfq(s, { ...ask, items: [] }, ctx())).toThrow('at least one')
    expect(() => createRfq(s, { ...ask, supplierIds: [] }, ctx())).toThrow('suppliers')
  })

  test('a quote is replaced, not duplicated, and a blank price means not quoted', () => {
    const { s, rfq } = quoted()
    expect(listOf(s.rfqQuotes)).toHaveLength(2)
    const again = applyChanges(s, recordQuote(s, { rfqId: rfq.id, supplierId: 's1', prices: { v1: 380 } }, ctx({ now: NOW + 9 })).changes)
    expect(listOf(again.rfqQuotes)).toHaveLength(2)
    expect(again.rfqQuotes[`${rfq.id}:s1`].prices).toEqual({ v1: 380 })
    expect(() => recordQuote(s, { rfqId: rfq.id, supplierId: 's1', prices: {} }, ctx())).toThrow('at least one')
    expect(() => recordQuote(s, { rfqId: rfq.id, supplierId: 's1', prices: { v1: -3 } }, ctx())).toThrow('more than zero')
  })

  test('the comparison: best single supplier, cheapest per item, and what splitting saves', () => {
    const { s, rfq } = quoted()
    const cmp = compareQuotes(rfq, listOf(s.rfqQuotes))
    // s1: 20×400 + 10×400 + 100 = 12,100   s2: 20×390 + 10×405 = 11,850
    expect(cmp.columns.map((c) => [c.supplierId, c.total, c.complete])).toEqual([['s1', 12_100, true], ['s2', 11_850, true]])
    expect(cmp.bestSingle?.supplierId).toBe('s2')
    expect(cmp.cheapest).toEqual({ v1: 's2', v2: 's1' })
    // split: v1 from s2 (7,800) + v2 from s1 (4,000) + s1's freight 100 = 11,900 — dearer than s2 alone
    expect(cmp.split?.total).toBe(11_900)
    expect(cmp.splitSaves).toBe(0)
  })

  test('a supplier that skipped an item is flagged and cannot win on total', () => {
    const { s, rfq } = quoted()
    const part = applyChanges(s, recordQuote(s, { rfqId: rfq.id, supplierId: 's2', prices: { v1: 100 } }, ctx({ now: NOW + 5 })).changes)
    const cmp = compareQuotes(rfq, listOf(part.rfqQuotes))
    expect(cmp.columns.find((c) => c.supplierId === 's2')).toMatchObject({ complete: false, missing: 1 })
    expect(cmp.bestSingle?.supplierId).toBe('s1')
    expect(cmp.splitSaves).toBe(100 * 0 + Math.max(0, 12_100 - cmp.split!.total))
    expect(cmp.splitSaves).toBeGreaterThan(0)
  })

  test('quotes can be prefilled from the price lists', () => {
    const s = priced()
    const rfq = createRfq(s, ask, ctx()).rfq
    const pre = quotesFromLists(s, rfq, NOW)
    expect(pre).toEqual([{ supplierId: 's1', prices: { v1: 420 }, leadDays: undefined }, { supplierId: 's2', prices: { v1: 400, v2: 395 }, leadDays: 5 }])
  })

  test('awarding creates one draft order per supplier at the quoted prices and closes the request', () => {
    const { s, rfq } = quoted()
    const single = awardRfq(s, rfq.id, { mode: 'single', supplierId: 's2' }, ctx({ now: NOW + 10 }))
    expect(single.orders).toHaveLength(1)
    expect(single.orders[0]).toMatchObject({ supplierId: 's2', status: 'draft', total: 11_850, items: [{ variantId: 'v1', qty: 20, cost: 390 }, { variantId: 'v2', qty: 10, cost: 405 }] })
    const done = applyChanges(s, single.changes)
    expect(done.rfqs[rfq.id]).toMatchObject({ status: 'awarded', poIds: [single.orders[0].id] })
    expect(() => awardRfq(done, rfq.id, { mode: 'single', supplierId: 's2' }, ctx())).toThrow('already')
    expect(() => recordQuote(done, { rfqId: rfq.id, supplierId: 's1', prices: { v1: 1 } }, ctx())).toThrow('closed')
    expect(setPoStatus(done, single.orders[0].id, 'sent', ctx()).order.status).toBe('sent')

    const split = awardRfq(s, rfq.id, { mode: 'cheapest-each' }, ctx({ now: NOW + 10 }))
    expect(split.orders.map((o) => [o.supplierId, o.total, o.no])).toEqual([['s2', 7_800, 'PO-0001'], ['s1', 4_000, 'PO-0002']])
    expect(() => awardRfq(s, rfq.id, { mode: 'single', supplierId: 'ghost' }, ctx())).toThrow('not quoted')
  })

  test('closing without an award', () => {
    const { s, rfq } = quoted()
    expect(applyChanges(s, closeRfq(s, rfq.id, ctx()).changes).rfqs[rfq.id].status).toBe('closed')
  })

  test('replicates: server == phone for price lists, requests, quotes and the orders an award makes', async () => {
    const r = rig(purchasingState())
    await r.seed()
    await r.run((s) => saveSupplierPrice(s, { supplierId: 's1', variantId: 'v1', price: 420 }, ctx({ now: NOW + 1 })))
    const made = await r.run((s) => createRfq(s, ask, ctx({ now: NOW + 2 })))
    await r.run((s) => recordQuote(s, { rfqId: made.rfq.id, supplierId: 's1', prices: { v1: 400, v2: 400 }, freight: 50 }, ctx({ now: NOW + 3 })))
    await r.run((s) => recordQuote(s, { rfqId: made.rfq.id, supplierId: 's2', prices: { v1: 390, v2: 405 } }, ctx({ now: NOW + 4 })))
    await r.run((s) => recordQuote(s, { rfqId: made.rfq.id, supplierId: 's2', prices: { v1: 380, v2: 405 } }, ctx({ now: NOW + 5 })))
    await r.run((s) => awardRfq(s, made.rfq.id, { mode: 'cheapest-each' }, ctx({ now: NOW + 6 })))
    const server = await r.serverView()
    expect(server.supplierPrices).toEqual(r.phone.supplierPrices)
    expect(server.rfqs).toEqual(r.phone.rfqs)
    expect(server.rfqQuotes).toEqual(r.phone.rfqQuotes)
    expect(server.purchaseOrders).toEqual(r.phone.purchaseOrders)
    expect(listOf(server.purchaseOrders)).toHaveLength(2)
    expect(listOf(server.rfqQuotes)).toHaveLength(2)
  })
})

describe('landed cost split of GST heads', () => {
  test('inside the state the credit is half CGST, half SGST', () => {
    const s = purchasingState()
    const r = receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'x', items: [{ variantId: 'v1', qty: 1, cost: 100 }], total: 100, paid: 0, notes: '' }, ctx())
    const st = applyChanges(s, r.changes)
    const lc = recordLandedCost(st, { purchaseId: r.purchase.id, charges: [{ kind: 'freight', label: '', amount: 100, gst: 5, itcEligible: true }], payeeId: 's1' }, ctx())
    const p = postingsFor(applyChanges(st, lc.changes)).find((x) => x.sourceColl === 'landedCosts')!
    expect(p.lines).toContainEqual({ account: 'gst_input_cgst', debit: 2.5 })
    expect(p.lines).toContainEqual({ account: 'gst_input_sgst', debit: 2.5 })
    expect(isBalanced(p)).toBe(true)
  })
})

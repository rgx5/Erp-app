import { OpError, processReturn, receivePurchase, saveBill } from '@/data/ops'
import { applyChanges, listOf, type DataState } from '@/data/state'
import { billInput, line } from '@/data/__tests__/helpers'
import { createBundle, dispatchTransfer, receiveTransfer, saveItemRule, saveLocation } from '../ops'
import { batchId, kitAvailable, serialId, stockAt } from '../logic'
import { baseState, ctx, DAY, NOW, useWarehouseHooks, warehouseState } from './helpers'

useWarehouseHooks()

const at = (n: number) => ctx({ now: NOW + n })
const withExt = (l: ReturnType<typeof line>, ext: Record<string, unknown>) => ({ ...l, ext: { warehouse: ext } })

/** Receives 100 paracetamol in two batches. */
function stocked(): DataState {
  let s = warehouseState()
  const r1 = receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'A', items: [{ variantId: 'v3', qty: 60, cost: 2 }], total: 120, paid: 0, notes: '', ext: { warehouse: { lines: { v3: { batchNo: 'b-late', expiry: NOW + 200 * DAY } } } } }, at(1))
  s = applyChanges(s, r1.changes)
  const r2 = receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B', items: [{ variantId: 'v3', qty: 40, cost: 2 }], total: 80, paid: 0, notes: '', ext: { warehouse: { lines: { v3: { batchNo: 'b-soon', expiry: NOW + 20 * DAY } } } } }, at(2))
  return applyChanges(s, r2.changes)
}

describe('receiving batches and serials', () => {
  test('a receipt creates the batches with their quantities and expiry', () => {
    const s = stocked()
    expect(s.variants.v3.stock).toBe(100)
    expect(s.batches[batchId('v3', 'b-late')]).toMatchObject({ batchNo: 'B-LATE', qty: 60, expiry: NOW + 200 * DAY, supplierId: 's1' })
    expect(s.batches[batchId('v3', 'b-soon')].qty).toBe(40)
    expect(listOf(s.batchMoves)).toHaveLength(2)
  })

  test('a tracked item without its batch number is refused', () => {
    const s = warehouseState()
    expect(() => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v3', qty: 5, cost: 2 }], total: 10, paid: 0, notes: '' }, at(1))).toThrow('batch number')
    const bad = { warehouse: { lines: { v3: { batchNo: 'x', expiry: NOW - DAY } } } }
    expect(() => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v3', qty: 5, cost: 2 }], total: 10, paid: 0, notes: '', ext: bad }, at(1))).toThrow('already expired')
    const order = { warehouse: { lines: { v3: { batchNo: 'x', mfgDate: NOW, expiry: NOW - DAY } } } }
    expect(() => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v3', qty: 5, cost: 2 }], total: 10, paid: 0, notes: '', ext: order }, at(1))).toThrow(OpError)
  })

  test('a receipt registers serial numbers and needs one per unit', () => {
    const s = warehouseState()
    const rec = (serials: string[], qty = 2) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v4', qty, cost: 8000 }], total: 8000 * qty, paid: 0, notes: '', ext: { warehouse: { lines: { v4: { serials } } } } }, at(1))
    expect(() => rec(['111'])).toThrow('2 serial numbers')
    expect(() => rec(['111', '111'])).toThrow('twice')
    const ok = applyChanges(s, rec(['imei-1', 'imei-2']).changes)
    expect(ok.serials[serialId('v4', 'IMEI-1')]).toMatchObject({ status: 'in_stock', serial: 'IMEI-1', warrantyMonths: 12, supplierId: 's1' })
    expect(() => receivePurchase(ok, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v4', qty: 1, cost: 1 }], total: 1, paid: 0, notes: '', ext: { warehouse: { lines: { v4: { serials: ['IMEI-2'] } } } } }, at(2))).toThrow('already in stock')
  })

  test('a receipt into a location raises that location, not main', () => {
    let s = warehouseState()
    const r = receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v1', qty: 6, cost: 400 }], total: 2400, paid: 0, notes: '', ext: { warehouse: { locationId: 'locA' } } }, at(1))
    s = applyChanges(s, r.changes)
    expect(s.variants.v1.stock).toBe(16)
    expect(stockAt(s, 'v1', 'locA')).toBe(6)
    expect(stockAt(s, 'v1')).toBe(10)
    expect(listOf(s.moves).every((m) => m.locationId === 'locA')).toBe(true)
    expect(() => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v1', qty: 1, cost: 1 }], total: 1, paid: 0, notes: '', ext: { warehouse: { locationId: 'nope' } } }, at(2))).toThrow('not available')
  })
})

describe('selling batch-tracked stock', () => {
  test('first-expiry-first-out takes the batch that expires soonest, then the next', () => {
    let s = stocked()
    const sale = saveBill(s, billInput(s, [line(s.variants.v3, 50)]), at(10))
    s = applyChanges(s, sale.changes)
    expect(s.batches[batchId('v3', 'b-soon')].qty).toBe(0)
    expect(s.batches[batchId('v3', 'b-late')].qty).toBe(50)
    expect(s.variants.v3.stock).toBe(50)
    const moves = listOf(s.batchMoves).filter((m) => m.reason === 'sale')
    expect(moves.map((m) => [m.batchId, m.qty])).toEqual([[batchId('v3', 'b-soon'), -40], [batchId('v3', 'b-late'), -10]])
    expect(moves.every((m) => m.billId === sale.bill.id)).toBe(true)
  })

  test('the seller can pick a batch', () => {
    let s = stocked()
    const sale = saveBill(s, billInput(s, [withExt(line(s.variants.v3, 5), { batchId: batchId('v3', 'b-late') })]), at(10))
    s = applyChanges(s, sale.changes)
    expect(s.batches[batchId('v3', 'b-late')].qty).toBe(55)
    expect(s.batches[batchId('v3', 'b-soon')].qty).toBe(40)
    expect(() => saveBill(s, billInput(s, [withExt(line(s.variants.v3, 5), { batchId: 'bt_nope' })]), at(11))).toThrow('not one of')
  })

  test('expired stock is never sold by accident', () => {
    const s = stocked()
    const later = ctx({ now: NOW + 30 * DAY }) // b-soon expired 10 days ago
    // 60 are in date; asking for 70 would reach into the expired batch
    expect(() => saveBill(s, billInput(s, [line(s.variants.v3, 70)]), later)).toThrow('within date')
    expect(() => saveBill(s, billInput(s, [withExt(line(s.variants.v3, 1), { batchId: batchId('v3', 'b-soon') })]), later)).toThrow('expired on')
    const ok = saveBill(s, billInput(s, [line(s.variants.v3, 60)]), later)
    expect(applyChanges(s, ok.changes).batches[batchId('v3', 'b-late')].qty).toBe(0)
    // a manager can knowingly sell past the date
    const forced = saveBill(s, billInput(s, [withExt(line(s.variants.v3, 70), { allowExpired: true })]), later)
    expect(applyChanges(s, forced.changes).batches[batchId('v3', 'b-soon')].qty).toBe(0)
  })

  test('stock that was never put in a batch still sells', () => {
    const s = warehouseState()
    s.variants.v3 = { ...s.variants.v3, stock: 10 }
    const r = saveBill(s, billInput(s, [line(s.variants.v3, 4)]), at(1))
    expect(applyChanges(s, r.changes).variants.v3.stock).toBe(6)
    expect(listOf(applyChanges(s, r.changes).batchMoves)).toHaveLength(0)
  })

  test('a return puts the goods back into the batches they came from, once', () => {
    let s = stocked()
    const sale = saveBill(s, billInput(s, [line(s.variants.v3, 50)]), at(10))
    s = applyChanges(s, sale.changes)
    const r1 = processReturn(s, sale.bill.id, [{ variantId: 'v3', qty: 45 }], 'cash', at(20))
    s = applyChanges(s, r1.changes)
    // the sale took 40 from soon and 10 from late; 45 back = 40 + 5
    expect(s.batches[batchId('v3', 'b-soon')].qty).toBe(40)
    expect(s.batches[batchId('v3', 'b-late')].qty).toBe(55)
    const r2 = processReturn(s, sale.bill.id, [{ variantId: 'v3', qty: 5 }], 'cash', at(30))
    s = applyChanges(s, r2.changes)
    expect(s.batches[batchId('v3', 'b-late')].qty).toBe(60)
    expect(s.variants.v3.stock).toBe(100)
  })
})

describe('selling serial-tracked stock', () => {
  function withPhones(): DataState {
    const s = warehouseState()
    const r = receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v4', qty: 3, cost: 8000 }], total: 24000, paid: 0, notes: '', ext: { warehouse: { lines: { v4: { serials: ['A1', 'A2', 'A3'] } } } } }, at(1))
    return applyChanges(s, r.changes)
  }

  test('the sale needs the serial numbers, marks them sold and starts the warranty', () => {
    let s = withPhones()
    expect(() => saveBill(s, billInput(s, [line(s.variants.v4, 1)], { customerId: 'c1' }), at(5))).toThrow('serial number')
    expect(() => saveBill(s, billInput(s, [withExt(line(s.variants.v4, 1), { serials: ['ZZ'] })]), at(5))).toThrow('not in the system')
    const sale = saveBill(s, billInput(s, [withExt(line(s.variants.v4, 2), { serials: ['a1', 'A2'] })], { customerId: 'c1' }), at(5))
    s = applyChanges(s, sale.changes)
    const sold = s.serials[serialId('v4', 'A1')]
    expect(sold).toMatchObject({ status: 'sold', billNo: sale.bill.no, customerId: 'c1', soldAt: sale.bill.date, warrantyMonths: 12 })
    expect(new Date(sold.warrantyUntil!).getFullYear()).toBe(2027)
    expect(s.serials[serialId('v4', 'A3')].status).toBe('in_stock')
    // the same unit cannot be sold twice
    expect(() => saveBill(s, billInput(s, [withExt(line(s.variants.v4, 1), { serials: ['A1'] })]), at(6))).toThrow('already sold')
  })

  test('returning every unit of a bill frees its serial numbers', () => {
    let s = withPhones()
    const sale = saveBill(s, billInput(s, [withExt(line(s.variants.v4, 1), { serials: ['A1'] })]), at(5))
    s = applyChanges(s, sale.changes)
    s = applyChanges(s, processReturn(s, sale.bill.id, [{ variantId: 'v4', qty: 1 }], 'cash', at(9)).changes)
    expect(s.serials[serialId('v4', 'A1')].status).toBe('returned')
    // …and it can be sold again
    expect(() => saveBill(s, billInput(s, [withExt(line(s.variants.v4, 1), { serials: ['A1'] })]), at(10))).not.toThrow()
  })
})

describe('kits', () => {
  test('selling a kit takes its components off the shelf; a return gives them back', () => {
    let s = warehouseState()
    const made = createBundle(s, { name: 'Shirt pair', categoryId: 'cat_mshirt', components: [{ variantId: 'v1', qty: 2 }, { variantId: 'v2', qty: 1 }], price: 1800 }, at(1))
    s = applyChanges(s, made.changes)
    expect(kitAvailable(s, made.bundle)).toBe(4)
    const kit = s.variants[made.bundle.variantId]
    expect(kit.price).toBe(1800)
    const sale = saveBill(s, billInput(s, [line(kit, 2)]), at(2))
    s = applyChanges(s, sale.changes)
    expect(s.variants.v1.stock).toBe(6)
    expect(s.variants.v2.stock).toBe(2)
    expect(listOf(s.moves).filter((m) => m.ref === sale.bill.no).map((m) => m.qty).sort((a, b) => a - b)).toEqual([-4, -2])
    s = applyChanges(s, processReturn(s, sale.bill.id, [{ variantId: kit.id, qty: 1 }], 'cash', at(3)).changes)
    expect(s.variants.v1.stock).toBe(8)
    expect(s.variants.v2.stock).toBe(3)
  })

  test('a kit cannot be sold without its parts, nor contain a kit', () => {
    let s = warehouseState()
    const made = createBundle(s, { name: 'Big pack', categoryId: 'cat_mshirt', components: [{ variantId: 'v2', qty: 3 }], price: 2500 }, at(1))
    s = applyChanges(s, made.changes)
    const kit = s.variants[made.bundle.variantId]
    expect(() => saveBill(s, billInput(s, [line(kit, 2)]), at(2))).toThrow('Not enough')
    expect(() => createBundle(s, { name: 'Nest', categoryId: 'cat_mshirt', components: [{ variantId: kit.id, qty: 1 }], price: 10 }, at(3))).toThrow('another kit')
  })
})

describe('selling from a shelf', () => {
  test('a sale from a location lowers that location, not main', () => {
    let s = warehouseState()
    s = applyChanges(s, receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: '', items: [{ variantId: 'v1', qty: 6, cost: 400 }], total: 2400, paid: 0, notes: '', ext: { warehouse: { locationId: 'locA' } } }, at(1)).changes)
    const sale = saveBill(s, billInput(s, [withExt(line(s.variants.v1, 4), { locationId: 'locA' })]), at(2))
    s = applyChanges(s, sale.changes)
    expect(s.variants.v1.stock).toBe(12)
    expect(stockAt(s, 'v1', 'locA')).toBe(2)
    expect(stockAt(s, 'v1')).toBe(10)
    expect(() => saveBill(s, billInput(s, [withExt(line(s.variants.v1, 3), { locationId: 'locA' })]), at(3))).toThrow('Only 2')
    s = applyChanges(s, processReturn(s, sale.bill.id, [{ variantId: 'v1', qty: 4 }], 'cash', at(4)).changes)
    expect(stockAt(s, 'v1', 'locA')).toBe(6)
    expect(stockAt(s, 'v1')).toBe(10)
  })
})

describe('plain sales are untouched', () => {
  test('an ordinary bill produces no warehouse documents', () => {
    const s = baseState()
    const r = saveBill(s, billInput(s, [line(s.variants.v1, 2)]), at(1))
    expect(r.changes.put?.batchMoves).toBeUndefined()
    expect(r.changes.put?.serials).toBeUndefined()
    expect(r.changes.put?.variants).toHaveLength(1)
  })
})

describe('transfers keep the totals right', () => {
  test('dispatch, part receipt and closing short', () => {
    let s = warehouseState()
    s = applyChanges(s, saveLocation(s, { name: 'Outlet 2', type: 'warehouse' }, undefined, at(1)).changes)
    const outlet = listOf(s.locations).find((l) => l.name === 'Outlet 2')!
    const sent = dispatchTransfer(s, { fromId: 'main', toId: outlet.id, lines: [{ variantId: 'v1', qty: 6 }] }, at(2))
    s = applyChanges(s, sent.changes)
    expect(s.variants.v1.stock).toBe(4)
    const part = receiveTransfer(s, sent.transfer.id, [{ variantId: 'v1', qty: 4 }], {}, at(3))
    s = applyChanges(s, part.changes)
    expect(stockAt(s, 'v1', outlet.id)).toBe(4)
    expect(s.variants.v1.stock).toBe(8)
    expect(() => receiveTransfer(s, sent.transfer.id, [{ variantId: 'v1', qty: 5 }], {}, at(4))).toThrow('still on the way')
    const closed = receiveTransfer(s, sent.transfer.id, [], { closed: true }, at(5))
    expect(closed.receipt.lossValue).toBe(800)
  })
})

void saveItemRule

import { applyChanges, listOf } from '@/data/state'
import { postingsFor, isBalanced } from '@/modules/postings'
import {
  addMonths, allocateFefo, batchWise, blendedPrice, daysToExpiry, expiryReport, expirySummary, expiredValue, findSerials, formatUnits, fromBase, isExpired, kitAvailable, levelId, locationOptions,
  locationSummary, onlyExpiredLeft, restorePlan, serialAvailable, stockAt, stockByLocation, toBase, transferProgress, warrantyState, warrantyUntil, wouldCycle, lossesByReason, writeOffTotal,
} from '../logic'
import { transferLossPosting, writeOffPosting } from '../posting'
import { addOpeningBatch, dispatchTransfer, postWriteOff, receiveTransfer, registerSerial, setLocationStock } from '../ops'
import type { Batch, Transfer, TransferReceipt } from '../types'
import { DAY, NOW, ctx, warehouseState } from './helpers'

const batch = (id: string, qty: number, expiry: number | undefined, receivedAt = 0): Batch => ({ id, variantId: 'v3', batchNo: id, qty, expiry, receivedAt })

describe('expiry and first-expiry-first-out', () => {
  test('dates count from the start of today', () => {
    const b = batch('a', 1, NOW + 3 * DAY)
    expect(daysToExpiry(b, NOW)).toBe(3)
    expect(isExpired({ expiry: NOW - DAY }, NOW)).toBe(true)
    expect(isExpired({ expiry: NOW }, NOW)).toBe(false)
    expect(isExpired({}, NOW)).toBe(false)
  })

  test('soonest expiry first, undated last, expired skipped, a picked batch first', () => {
    const list = [batch('none', 10, undefined), batch('late', 10, NOW + 90 * DAY), batch('soon', 10, NOW + 5 * DAY), batch('dead', 10, NOW - 5 * DAY)]
    expect(allocateFefo(list, 15, { now: NOW })).toEqual({ alloc: [{ batchId: 'soon', qty: 10 }, { batchId: 'late', qty: 5 }], short: 0 })
    expect(allocateFefo(list, 35, { now: NOW }).short).toBe(5)
    expect(allocateFefo(list, 35, { now: NOW, allowExpired: true }).short).toBe(0)
    expect(allocateFefo(list, 4, { now: NOW, preferId: 'late' }).alloc).toEqual([{ batchId: 'late', qty: 4 }])
    expect(onlyExpiredLeft([batch('d', 1, NOW - DAY), batch('e', 0, NOW + DAY)], NOW)).toBe(true)
  })

  test('the expiry report orders by days and values the stock', () => {
    const s = warehouseState()
    s.batches = {
      a: { ...batch('a', 10, NOW + 10 * DAY), cost: 3 }, b: batch('b', 5, NOW - 2 * DAY), c: batch('c', 5, NOW + 200 * DAY), d: batch('d', 0, NOW - DAY),
    }
    s.variants.v3 = { ...s.variants.v3, avgCost: 2 }
    const rows = expiryReport(s, NOW, 30)
    expect(rows.map((r) => r.batch.id)).toEqual(['b', 'a'])
    expect(rows.map((r) => r.value)).toEqual([10, 30])
    expect(expiredValue(rows)).toBe(10)
    expect(expirySummary(s, NOW, 30)).toEqual({ expired: 1, soon: 1, value: 40 })
    expect(batchWise(s)[0].batches.map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('locations', () => {
  test('main is the remainder; shelves are counted separately', () => {
    let s = warehouseState()
    s = applyChanges(s, setLocationStock(s, { variantId: 'v1', locationId: 'locA', qty: 3 }, ctx()).changes)
    expect(s.variants.v1.stock).toBe(13)
    expect(stockAt(s, 'v1')).toBe(10)
    expect(stockAt(s, 'v1', 'locA')).toBe(3)
    expect(stockByLocation(s, 'v1').map((r) => [r.name, r.qty])).toEqual([['Main', 10], ['Godown', 3]])
    expect(s.stockLevels[levelId('v1', 'locA')].qty).toBe(3)
    const sum = locationSummary(s)
    expect(sum.map((r) => r.name)).toEqual(['Main', 'Godown', 'Shelf A1'])
    expect(sum[0]).toMatchObject({ items: 2, units: 14 })
    expect(sum[1]).toMatchObject({ items: 1, units: 3, value: 1200 })
  })

  test('locations nest but never in a loop', () => {
    const s = warehouseState()
    expect(locationOptions(s).map((o) => o.label)).toEqual(['Main', 'Godown', 'Godown › Shelf A1'])
    expect(wouldCycle(s.locations, 'locA', 'locB')).toBe(true)
    expect(wouldCycle(s.locations, 'locB', 'locA')).toBe(false)
  })
})

describe('transfers', () => {
  const t: Transfer = { id: 't', no: 'TR-1', fromId: 'a', toId: 'b', lines: [{ variantId: 'v1', qty: 10 }, { variantId: 'v2', qty: 4 }], date: NOW, userId: 'u', notes: '' }
  const r = (lines: Array<[string, number]>, closed = false): TransferReceipt => ({ id: `r${lines.length}${closed}`, transferId: 't', lines: lines.map(([variantId, qty]) => ({ variantId, qty })), date: NOW, userId: 'u', closed, notes: '' })

  test('in transit → part received → received', () => {
    expect(transferProgress(t, []).status).toBe('in_transit')
    const part = transferProgress(t, [r([['v1', 10]])])
    expect(part.status).toBe('partial')
    expect(part.outstandingTotal).toBe(4)
    expect(transferProgress(t, [r([['v1', 10], ['v2', 4]])]).status).toBe('received')
  })

  test('closing short records what was lost', () => {
    const p = transferProgress(t, [r([['v1', 10], ['v2', 1]], true)])
    expect(p.status).toBe('closed_short')
    expect(p.lines.find((l) => l.variantId === 'v2')).toMatchObject({ received: 1, outstanding: 0, lost: 3 })
  })

  test('refusals', () => {
    let s = warehouseState()
    expect(() => dispatchTransfer(s, { fromId: 'main', toId: 'main', lines: [{ variantId: 'v1', qty: 1 }] }, ctx())).toThrow('two different')
    expect(() => dispatchTransfer(s, { fromId: 'main', toId: 'locA', lines: [] }, ctx())).toThrow('at least one')
    expect(() => dispatchTransfer(s, { fromId: 'main', toId: 'locA', lines: [{ variantId: 'v1', qty: 11 }] }, ctx())).toThrow('Only 10')
    expect(() => dispatchTransfer(s, { fromId: 'main', toId: 'nope', lines: [{ variantId: 'v1', qty: 1 }] }, ctx())).toThrow('does not exist')
    const sent = dispatchTransfer(s, { fromId: 'main', toId: 'locA', lines: [{ variantId: 'v1', qty: 4 }, { variantId: 'v1', qty: 1 }] }, ctx())
    expect(sent.transfer.lines).toEqual([{ variantId: 'v1', qty: 5 }])
    expect(sent.transfer.no).toBe('TR-0001')
    s = applyChanges(s, sent.changes)
    const done = receiveTransfer(s, sent.transfer.id, [{ variantId: 'v1', qty: 5 }], {}, ctx())
    s = applyChanges(s, done.changes)
    expect(() => receiveTransfer(s, sent.transfer.id, [{ variantId: 'v1', qty: 1 }], {}, ctx())).toThrow('already complete')
    expect(s.variants.v1.stock).toBe(10)
    expect(stockAt(s, 'v1', 'locA')).toBe(5)
  })
})

describe('units and prices', () => {
  test('box ↔ piece', () => {
    expect(toBase({ factor: 12 }, 3)).toBe(36)
    expect(fromBase(40, { factor: 12 })).toEqual({ big: 3, rest: 4 })
    expect(formatUnits(40, 'pc', { factor: 12, unit: 'box' })).toBe('3 box + 4 pc')
    expect(formatUnits(36, 'pc', { factor: 12, unit: 'box' })).toBe('3 box')
    expect(formatUnits(5, 'pc', { factor: 12, unit: 'box' })).toBe('5 pc')
    expect(formatUnits(7, 'pc')).toBe('7 pc')
  })

  test('whole boxes sell at the box price, the rest at the piece price', () => {
    const conv = { factor: 12, price: 10_000 }
    expect(blendedPrice({ price: 999, qty: 12 }, conv, 1)).toBe(833.33)
    expect(blendedPrice({ price: 999, qty: 14 }, conv, 1)).toBe(round((10_000 + 2 * 999) / 14))
    expect(blendedPrice({ price: 999, qty: 14 }, conv, 5)).toBe(round((10_000 + 2 * 999) / 14)) // cannot claim more boxes than fit
    expect(blendedPrice({ price: 999, qty: 5 }, conv, 1)).toBe(999)
    expect(blendedPrice({ price: 999, qty: 12 }, { factor: 12 }, 1)).toBe(999)
  })
})

const round = (n: number) => Math.round(n * 100) / 100

describe('serial numbers and warranty', () => {
  test('months are added by calendar, clamped to the month end', () => {
    expect(new Date(addMonths(new Date('2026-01-31T10:00:00').getTime(), 1)).getDate()).toBe(28)
    expect(warrantyUntil(NOW, 0)).toBeUndefined()
    expect(new Date(warrantyUntil(NOW, 12)!).getFullYear()).toBe(2027)
  })

  test('warranty state', () => {
    expect(warrantyState({ status: 'sold', warrantyUntil: NOW + 10 * DAY }, NOW)).toEqual({ kind: 'active', days: 10 })
    expect(warrantyState({ status: 'sold', warrantyUntil: NOW - 3 * DAY }, NOW)).toEqual({ kind: 'expired', days: 3 })
    expect(warrantyState({ status: 'in_stock', warrantyUntil: NOW + DAY }, NOW)).toEqual({ kind: 'none' })
    expect(serialAvailable({ status: 'returned' })).toBe(true)
    expect(serialAvailable({ status: 'sold' })).toBe(false)
  })

  test('look-up by the whole serial or its last digits', () => {
    let s = warehouseState()
    for (const sn of ['356938035643809', '356938035643817', 'ABC-9']) s = applyChanges(s, registerSerial(s, { variantId: 'v4', serial: sn }, ctx()).changes)
    expect(findSerials(s, '356938035643809')).toHaveLength(1)
    expect(findSerials(s, '3817').map((x) => x.serial)).toEqual(['356938035643817'])
    expect(findSerials(s, 'ab')).toEqual([])
    expect(() => registerSerial(s, { variantId: 'v4', serial: 'abc-9' }, ctx())).toThrow('already in stock')
  })
})

describe('kits', () => {
  test('availability is limited by the scarcest component', () => {
    const s = warehouseState()
    const kit = { id: 'b', variantId: 'k', name: 'K', components: [{ variantId: 'v1', qty: 3 }, { variantId: 'v2', qty: 1 }], price: 1, active: true, createdAt: NOW }
    expect(kitAvailable(s, kit)).toBe(3) // v1: 10/3 = 3, v2: 4
  })
})

describe('write-offs and the books', () => {
  test('a write-off takes stock out at cost and posts a balanced entry', () => {
    let s = warehouseState()
    s = applyChanges(s, addOpeningBatch(s, { variantId: 'v3', batchNo: 'x1', qty: 20, expiry: NOW - DAY }, ctx()).changes)
    s.variants.v3 = { ...s.variants.v3, stock: 20 }
    const r = postWriteOff(s, { reason: 'expiry', lines: [{ variantId: 'v3', qty: 8, batchId: 'bt_v3_X1' }, { variantId: 'v1', qty: 2 }], notes: ' old ' }, ctx())
    s = applyChanges(s, r.changes)
    expect(r.writeOff.no).toBe('WO-0001')
    expect(r.writeOff.total).toBe(8 * 2 + 2 * 400)
    expect(r.writeOff.notes).toBe('old')
    expect(s.variants.v1.stock).toBe(8)
    expect(s.variants.v3.stock).toBe(12)
    expect(s.batches.bt_v3_X1.qty).toBe(12)
    const posts = postingsFor(s)
    expect(posts).toHaveLength(1)
    expect(isBalanced(posts[0])).toBe(true)
    expect(posts[0].lines).toEqual([{ account: 'stock_adjustments', debit: 816 }, { account: 'inventory', credit: 816 }])
    expect(lossesByReason(listOf(s.writeOffs), 0, NOW + DAY)).toEqual([{ reason: 'expiry', count: 1, total: 816 }])
    expect(writeOffTotal([{ qty: 3, cost: 1.1 }])).toBe(3.3)
  })

  test('refusals: nothing to write off, more than is there, a serial item without its serial', () => {
    const s = warehouseState()
    expect(() => postWriteOff(s, { reason: 'damage', lines: [] }, ctx())).toThrow('at least one')
    expect(() => postWriteOff(s, { reason: 'damage', lines: [{ variantId: 'v1', qty: 11 }] }, ctx())).toThrow('Only 10')
    expect(() => postWriteOff(s, { reason: 'damage', lines: [{ variantId: 'v1', qty: 0 }] }, ctx())).toThrow('quantity')
    s.variants.v4 = { ...s.variants.v4, stock: 2 }
    expect(() => postWriteOff(s, { reason: 'damage', lines: [{ variantId: 'v4', qty: 1 }] }, ctx())).toThrow('serial number')
  })

  test('a transfer closed short is a loss in the books; one received in full is not', () => {
    const base = { id: 'r', transferId: 't', lines: [], date: NOW, userId: 'u', notes: '' }
    const p = transferLossPosting({ ...base, closed: true, lossValue: 400 })
    expect(p && isBalanced(p)).toBe(true)
    expect(p?.lines[0]).toEqual({ account: 'stock_adjustments', debit: 400 })
    expect(transferLossPosting({ ...base, closed: true })).toBeNull()
    expect(transferLossPosting({ ...base, closed: false, lossValue: 5 })).toBeNull()
    expect(writeOffPosting({ id: 'w', no: 'WO-1', date: NOW, reason: 'damage', lines: [{ variantId: 'v1', qty: 0, cost: 5 }], total: 0, notes: '', userId: 'u' })).toBeNull()
  })

  test('restorePlan is empty for a bill that sold nothing from batches', () => {
    expect(restorePlan(warehouseState(), 'nobill', 'v3', 5)).toEqual([])
  })
})

import { adjustStock, processReturn, receivePurchase, saveBill } from '@/data/ops'
import { listOf, type DataState } from '@/data/state'
import { billInput, line } from '@/data/__tests__/helpers'
import { mutationsFromChanges } from '@/replication/client'
import { actorWith, rig } from '@/replication/testkit'
import { applyMutations } from '@/replication/apply'
import type { Mutation } from '@/replication/types'
import { addOpeningBatch, adjustBatch, createBundle, dispatchTransfer, postWriteOff, receiveTransfer, saveLocation, setLocationStock } from '../ops'
import { batchId, serialId, stockAt } from '../logic'
import { ctx, DAY, NOW, useWarehouseHooks, warehouseState } from './helpers'

useWarehouseHooks()

const at = (n: number) => ctx({ now: NOW + n })
const COLLS = ['variants', 'moves', 'bills', 'purchases', 'batches', 'batchMoves', 'serials', 'stockLevels', 'transfers', 'transferReceipts', 'writeOffs', 'bundles', 'locations', 'products'] as const
const withExt = (l: ReturnType<typeof line>, ext: Record<string, unknown>) => ({ ...l, ext: { warehouse: ext } })

async function same(r: ReturnType<typeof rig>) {
  const server = await r.serverView()
  for (const c of COLLS) expect({ [c]: server[c] }).toEqual({ [c]: r.phone[c] })
  return server
}

describe('the server ends with exactly what the phone has', () => {
  test('a working day: receive into batches and locations, sell FEFO, return, kit, transfer, write off', async () => {
    const r = rig(warehouseState())
    await r.seed()

    // goods arrive: shirts onto a shelf, medicine in two batches, phones with serial numbers
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'A', items: [{ variantId: 'v1', qty: 6, cost: 400 }], total: 2400, paid: 0, notes: '', ext: { warehouse: { locationId: 'locA' } } }, at(1)))
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B', items: [{ variantId: 'v3', qty: 60, cost: 2 }, { variantId: 'v4', qty: 2, cost: 8000 }], total: 16120, paid: 0, notes: '',
      ext: { warehouse: { lines: { v3: { batchNo: 'M-1', expiry: NOW + 100 * DAY }, v4: { serials: ['IMEI-1', 'IMEI-2'] } } } } }, at(2)))
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'C', items: [{ variantId: 'v3', qty: 40, cost: 2 }], total: 80, paid: 0, notes: '',
      ext: { warehouse: { lines: { v3: { batchNo: 'M-2', expiry: NOW + 10 * DAY } } } } }, at(3)))
    let server = await same(r)
    expect(server.batches[batchId('v3', 'M-2')].qty).toBe(40)
    expect(server.stockLevels['v1@locA'].qty).toBe(6)

    // sales: FEFO across batches; a phone with its serial number; shirts from the shelf; a kit
    const made = await r.run((s) => createBundle(s, { name: 'Pair', categoryId: 'cat_mshirt', components: [{ variantId: 'v1', qty: 1 }, { variantId: 'v2', qty: 1 }], price: 1900 }, at(4)))
    const sale1 = await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v3, 50), withExt(line(s.variants.v4, 1), { serials: ['imei-1'] }), withExt(line(s.variants.v1, 2), { locationId: 'locA' })], { customerId: 'c1' }), at(5)))
    await r.run((s) => saveBill(s, billInput(s, [line(s.variants[made.bundle.variantId], 2), line(s.variants.v3, 3)]), at(6)))
    server = await same(r)
    expect(server.batches[batchId('v3', 'M-2')].qty).toBe(0)
    expect(server.batches[batchId('v3', 'M-1')].qty).toBe(47)
    expect(server.serials[serialId('v4', 'IMEI-1')].status).toBe('sold')
    expect(server.stockLevels['v1@locA'].qty).toBe(4)

    // returns restore batches, the shelf, serials
    await r.run((s) => processReturn(s, sale1.bill.id, [{ variantId: 'v3', qty: 12 }, { variantId: 'v4', qty: 1 }, { variantId: 'v1', qty: 1 }], 'cash', at(7)))
    server = await same(r)
    expect(server.serials[serialId('v4', 'IMEI-1')].status).toBe('returned')

    // transfers: out, part in, closed short
    const loc = await r.run((s) => saveLocation(s, { name: 'Outlet 2', type: 'warehouse' }, undefined, at(8)))
    const tr = await r.run((s) => dispatchTransfer(s, { fromId: 'main', toId: loc.location.id, lines: [{ variantId: 'v2', qty: 2 }] }, at(9)))
    await r.run((s) => receiveTransfer(s, tr.transfer.id, [{ variantId: 'v2', qty: 1 }], {}, at(10)))
    await r.run((s) => receiveTransfer(s, tr.transfer.id, [], { closed: true }, at(11)))
    server = await same(r)
    expect(server.stockLevels[`v2@${loc.location.id}`].qty).toBe(1)
    expect(server.transferReceipts[listOf(r.phone.transferReceipts)[1].id].lossValue).toBe(400)

    // counts and write-offs
    await r.run((s) => setLocationStock(s, { variantId: 'v1', locationId: 'locB', qty: 3 }, at(12)))
    await r.run((s) => addOpeningBatch(s, { variantId: 'v3', batchNo: 'OLD', qty: 5, expiry: NOW - DAY }, at(13)))
    await r.run((s) => adjustBatch(s, batchId('v3', 'OLD'), -1, 'count', at(14)))
    await r.run((s) => postWriteOff(s, { reason: 'expiry', lines: [{ variantId: 'v3', qty: 4, batchId: batchId('v3', 'OLD') }] }, at(15)))
    await r.run((s) => postWriteOff(s, { reason: 'damage', lines: [{ variantId: 'v1', qty: 2, locationId: 'locA' }] }, at(16)))
    await r.run((s) => adjustStock(s, 'v2', -1, 'adjust', 'MANUAL', 'Damaged', at(17)))
    server = await same(r)

    // the numbers agree with what the documents say, whichever way you add them
    for (const v of listOf(r.phone.variants)) {
      const fromMoves = listOf(r.phone.moves).filter((m) => m.variantId === v.id).reduce((n, m) => n + m.qty, 0)
      expect(server.variants[v.id].stock).toBe(r.phone.variants[v.id].stock)
      if (listOf(r.phone.moves).some((m) => m.variantId === v.id)) expect(Math.round((v.stock - fromMoves) * 1000) / 1000).toBe(warehouseState().variants[v.id].stock)
    }
    for (const b of listOf(server.batches)) {
      const fromMoves = listOf(server.batchMoves).filter((m) => m.batchId === b.id).reduce((n, m) => n + m.qty, 0)
      expect(Math.round(b.qty * 1000) / 1000).toBe(Math.round(fromMoves * 1000) / 1000)
    }
    expect(stockAt(server, 'v1', 'locA')).toBe(r.phone.stockLevels['v1@locA'].qty)
  })

  test('two phones selling the same batch at once: the server adds both, exactly', async () => {
    const base = warehouseState()
    const r = rig(base)
    await r.seed()
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B', items: [{ variantId: 'v3', qty: 10, cost: 2 }], total: 20, paid: 0, notes: '', ext: { warehouse: { lines: { v3: { batchNo: 'M-1', expiry: NOW + 100 * DAY } } } } }, at(1)))
    const snapshot: DataState = r.phone
    // phone A sells 6 through the rig; phone B (working from the same snapshot) sells 6 as well, sent separately
    await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v3, 6)]), at(2)))
    const other = saveBill(snapshot, billInput(snapshot, [line(snapshot.variants.v3, 6)]), at(3))
    let n = 1000
    await r.send(mutationsFromChanges(snapshot, other.changes, { deviceId: 'dev2', nextSeq: () => ++n }))
    const server = await r.serverView()
    // both sales are real documents, so the server's batch is −2: the add-up is exact and the oversell is visible, never silently lost
    expect(server.batches[batchId('v3', 'M-1')].qty).toBe(-2)
    expect(server.variants.v3.stock).toBe(-2)
  })
})

describe('who may write what', () => {
  const cashier = actorWith(['pos', 'customers'], 'u_cash')
  const mut = (coll: string, id: string, op: Mutation['op'], data?: Record<string, unknown>, n = 1): Mutation => ({ mid: `t:${n}`, coll, id, op, ...(data ? { data } : {}), at: NOW })

  test('a cashier cannot write off stock, move locations or edit conversions', async () => {
    const r = rig(warehouseState())
    await r.seed()
    const wo = { id: 'wo1', no: 'WO-1', lines: [{ variantId: 'v1', qty: 1, cost: 1 }], reason: 'damage', total: 1, date: NOW, notes: '', userId: 'x' }
    const res = await applyMutations(r.db, [
      mut('writeOffs', 'wo1', 'create', wo, 1),
      mut('locations', 'locZ', 'create', { id: 'locZ', name: 'Z', type: 'shelf', active: true, createdAt: NOW }, 2),
      mut('unitConversions', 'ucZ', 'create', { id: 'ucZ', productId: 'p1', unit: 'x', factor: 2 }, 3),
      mut('transfers', 'trZ', 'create', { id: 'trZ', no: 'TR-1', fromId: 'a', toId: 'b', lines: [{ variantId: 'v1', qty: 1 }], date: NOW, userId: 'x', notes: '' }, 4),
    ], cashier)
    expect(res.map((x) => x.code)).toEqual(['forbidden', 'forbidden', 'forbidden', 'forbidden'])
  })

  test('a client can never set the quantity of a batch or a location level', async () => {
    const r = rig(warehouseState())
    await r.seed()
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B', items: [{ variantId: 'v3', qty: 10, cost: 2 }], total: 20, paid: 0, notes: '', ext: { warehouse: { lines: { v3: { batchNo: 'M-1' } } } } }, at(1)))
    const bid = batchId('v3', 'M-1')
    const res = await applyMutations(r.db, [mut('batches', bid, 'patch', { qty: 9999, batchNo: 'RENAMED' }, 5)], cashier)
    expect(res[0].status).toBe('ok')
    const server = await r.serverView()
    expect(server.batches[bid].qty).toBe(10)
    expect(server.batches[bid].batchNo).toBe('RENAMED')
    // a stock movement cannot be edited or removed once posted
    const mv = listOf(r.phone.moves)[0]
    const edit = await applyMutations(r.db, [mut('moves', mv.id, 'patch', { qty: 1 }, 6), mut('batchMoves', listOf(r.phone.batchMoves)[0].id, 'delete', undefined, 7)], actorWith('all'))
    expect(edit.map((x) => x.code)).toEqual(['immutable', 'immutable'])
  })

  test('a transfer to itself or without lines is refused', async () => {
    const r = rig(warehouseState())
    await r.seed()
    const bad = await applyMutations(r.db, [
      mut('transfers', 't1', 'create', { id: 't1', no: 'TR-1', fromId: 'a', toId: 'a', lines: [{ variantId: 'v1', qty: 1 }], date: NOW, userId: 'x', notes: '' }, 1),
      mut('transfers', 't2', 'create', { id: 't2', no: 'TR-2', fromId: 'a', toId: 'b', lines: [], date: NOW, userId: 'x', notes: '' }, 2),
    ], actorWith('all'))
    expect(bad.map((x) => x.code)).toEqual(['invalid', 'invalid'])
  })
})

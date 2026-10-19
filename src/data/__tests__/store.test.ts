import { listOf } from '../state'
import { flushWrites, perform, useApp, makeCtx } from '../store'
import { getStorage, setStorage } from '../storage'
import { MemoryStorage } from '../memory'
import { createItem, saveBill, processReturn } from '../ops'
import { snapshotToData } from '../snapshot'
import { baseState, billInput, line } from './helpers'
import type { Workspace } from '../store'
import type { Snapshot } from '../api'

const ws = (mode: 'local' | 'remote'): Workspace => ({ id: 'w1', name: 'Test', mode, industry: 'apparel', deviceTag: 'M4X', barcodeBase: 300_000_000, createdAt: 1 })

async function fresh(mode: 'local' | 'remote') {
  setStorage(new MemoryStorage())
  useApp.setState({ ready: false, workspace: null, outbox: [], session: null })
  await useApp.getState().boot()
  await useApp.getState().replaceData(baseState())
  await useApp.getState().setWorkspace(ws(mode))
  await useApp.getState().setSession({ userId: 'u_owner' })
  await flushWrites()
}

describe('store', () => {
  test('an offline workspace queues nothing for a server', async () => {
    await fresh('local')
    perform((s, c) => saveBill(s, billInput(s, [line(s.variants.v1)]), c))
    expect(useApp.getState().outbox).toHaveLength(0)
    expect(listOf(useApp.getState().data.bills)).toHaveLength(1)
  })

  test('a connected workspace queues writes in order and numbers from its own series', async () => {
    await fresh('remote')
    const { product } = perform((s, c) => createItem(s, { name: 'Tee', styleCode: 'MT-1', categoryId: 'cat_mshirt', brand: '', fabric: '', season: '', hsn: '', sizes: ['M'], colors: [''], cost: 1, mrp: 9, price: 9 }, c))
    const { bill } = perform((s, c) => saveBill(s, billInput(s, [line(useApp.getState().data.variants.v1)]), c))
    expect(bill.no).toBe('INV-M4X-0001')
    const rows = useApp.getState().outbox
    expect(rows.map((o) => o.entity)).toEqual(['product', 'variant', 'bill'])
    expect(rows.map((o) => o.id)).toEqual([1, 2, 3])
    expect(rows.every((o) => o.synced === 0)).toBe(true)
    expect((rows[0].payload as { id: string }).id).toBe(product.id)
  })

  test('everything survives a restart', async () => {
    await fresh('remote')
    perform((s, c) => saveBill(s, billInput(s, [line(s.variants.v1, 2)]), c))
    await flushWrites()
    const storage = getStorage()
    // a "new launch": empty memory, same storage
    useApp.setState({ data: baseState(), outbox: [], workspace: null, session: null, ready: false })
    useApp.setState({ data: { ...useApp.getState().data, bills: {}, moves: {} } })
    await useApp.getState().boot()
    const s = useApp.getState()
    expect(s.workspace?.mode).toBe('remote')
    expect(s.session?.userId).toBe('u_owner')
    expect(listOf(s.data.bills)).toHaveLength(1)
    expect(s.data.variants.v1.stock).toBe(8)
    expect(s.outbox).toHaveLength(1)
    expect(storage).toBe(getStorage())
  })

  test('outbox ids keep counting after a restart (no id is ever reused)', async () => {
    await fresh('remote')
    perform((s, c) => saveBill(s, billInput(s, [line(s.variants.v1)]), c))
    await flushWrites()
    await useApp.getState().boot()
    perform((s, c) => saveBill(s, billInput(s, [line(s.variants.v1)]), c))
    expect(useApp.getState().outbox.map((o) => o.id)).toEqual([1, 2])
  })

  test('a return commits both credit note and updated original, atomically', async () => {
    await fresh('remote')
    const { bill } = perform((s, c) => saveBill(s, billInput(s, [line(s.variants.v1, 2)]), c))
    perform((s, c) => processReturn(s, bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', c))
    const d = useApp.getState().data
    expect(d.bills[bill.id].status).toBe('partial-return')
    expect(listOf(d.bills).filter((b) => b.refundOfBillId === bill.id)).toHaveLength(1)
    expect(d.variants.v1.stock).toBe(9)
  })

  test('replacing data (a refresh from the server) keeps parked bills and the audit log', async () => {
    await fresh('remote')
    perform((s, c) => saveBill(s, billInput(s, [line(s.variants.v1)], { status: 'held', payments: [], paid: 0 }), c))
    const before = useApp.getState().data
    const snap = { serverTime: 1, store: { ...before.store!, plan: 'active' }, users: [{ id: 'u_owner', name: 'Asha', role: 'owner', active: true }],
      categories: [], products: [], variants: [], customers: [], bills: [], suppliers: [], purchases: [], moves: [], expenses: [], sessions: [] } as unknown as Snapshot
    await useApp.getState().replaceData(snapshotToData(snap, before), { keepOutbox: true })
    const after = useApp.getState().data
    expect(listOf(after.bills).map((b) => b.status)).toEqual(['held'])
    expect(after.store!.plan).toBe('active')
    expect(Object.keys(after.variants)).toHaveLength(0)
  })

  test('makeCtx reflects who is signed in and the device series', async () => {
    await fresh('remote')
    expect(makeCtx(5)).toEqual({ now: 5, userId: 'u_owner', series: 'M4X', barcodeBase: 300_000_000 })
    await fresh('local')
    expect(makeCtx(5)).toEqual({ now: 5, userId: 'u_owner', series: '', barcodeBase: 1 })
  })

  test('wipe forgets the business', async () => {
    await fresh('local')
    await useApp.getState().wipe()
    expect(useApp.getState().workspace).toBeNull()
    await useApp.getState().boot()
    expect(useApp.getState().data.store).toBeNull()
  })
})

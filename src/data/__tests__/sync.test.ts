import type { OutboxEntry, SyncEntity } from '@/domain/types'
import { CloudError, type Api, type Snapshot } from '../api'
import { createSyncEngine, initialSyncState, MAX_ATTEMPTS, withoutPin, type SyncState } from '../sync'

const entry = (id: number, entity: SyncEntity, payload: Record<string, unknown> = {}, over: Partial<OutboxEntry> = {}): OutboxEntry =>
  ({ id, entity, payload, createdAt: 1000 + id, synced: 0, attempts: 0, ...over })

const res = (status: number, body = ''): Response => ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response

/** A scripted server: `respond` decides each answer; every call is recorded. */
function harness(rows: OutboxEntry[], respond: (method: string, path: string, body: unknown) => Response | Promise<Response> | 'offline') {
  const outbox = [...rows]
  let state: SyncState = initialSyncState()
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  let online = true
  const billExists = jest.fn(async (_id: string): Promise<unknown> => ({}))
  const applied: Snapshot[] = []
  const api = {
    raw: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      const r = await respond(method, path, body)
      if (r === 'offline') throw new CloudError('Cannot reach the server.')
      return r
    },
    bill: billExists,
    refresh: jest.fn(async () => ({ token: 'new.token.x' })),
    snapshot: jest.fn(async () => ({ serverTime: 1 }) as unknown as Snapshot),
  } as unknown as Api
  let token: string | null = 'a.b.c'
  const engine = createSyncEngine({
    api: () => api, token: () => token, setToken: (t) => { token = t },
    outbox: () => outbox,
    updateOutbox: async (id, patch) => { const i = outbox.findIndex((o) => o.id === id); outbox[i] = { ...outbox[i], ...patch } },
    applySnapshot: async (s) => { applied.push(s) },
    isOnline: () => online,
    getState: () => state, setState: (p) => { state = { ...state, ...p } },
    now: () => 5000,
  })
  return { engine, outbox, calls, get state() { return state }, setOnline: (v: boolean) => { online = v }, billExists, applied, api }
}

describe('flush', () => {
  test('uploads in order, to the right routes', async () => {
    const h = harness([
      entry(1, 'product', { id: 'p1' }), entry(2, 'variant', { id: 'v1' }), entry(3, 'variantUpdate', { id: 'v1', price: 5 }),
      entry(4, 'billReturn', { id: 'cn', refundOfBillId: 'b9' }), entry(5, 'categoryDelete', { id: 'c1' }),
    ], () => res(200))
    await h.engine.flush()
    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /products', 'POST /variants', 'PUT /variants/v1', 'POST /bills/b9/return', 'DELETE /categories/c1',
    ])
    expect(h.outbox.every((o) => o.synced === 1)).toBe(true)
    expect(h.state.pending).toBe(0)
    expect(h.state.lastSyncedAt).toBe(5000)
  })

  test('a server hiccup stops the queue in place so order is preserved', async () => {
    const h = harness([entry(1, 'expense'), entry(2, 'expense'), entry(3, 'expense')], (_m, _p, b) => res((b as { n?: number })?.n === 2 ? 500 : 200))
    h.outbox[1].payload = { n: 2 }
    await h.engine.flush()
    expect(h.outbox.map((o) => o.synced)).toEqual([1, 0, 0])
    expect(h.outbox[1].attempts).toBe(1)
    expect(h.state.lastError).toContain('stalled')
    expect(h.state.pending).toBe(2)
  })

  test('offline: nothing is lost, state says offline', async () => {
    const h = harness([entry(1, 'bill', { id: 'b1' })], () => 'offline')
    await h.engine.flush()
    expect(h.outbox[0].synced).toBe(0)
    expect(h.state.online).toBe(false)
    h.setOnline(false)
    await h.engine.flush()
    expect(h.calls).toHaveLength(1) // did not even try
  })

  test('a permanent refusal is retried, then set aside so the queue moves on', async () => {
    const h = harness([entry(1, 'customer'), entry(2, 'expense')], (_m, p) => res(p === '/customers' ? 422 : 200, 'bad data'))
    for (let i = 0; i < MAX_ATTEMPTS; i++) await h.engine.flush()
    expect(h.outbox[0].synced).toBe(2)
    expect(h.outbox[0].lastError).toContain('422')
    expect(h.outbox[1].synced).toBe(1)
    expect(h.state.rejected).toBe(1)
  })

  test('401 pauses everything and asks for a new sign-in', async () => {
    const h = harness([entry(1, 'expense'), entry(2, 'expense')], () => res(401))
    await h.engine.flush()
    expect(h.state.authenticated).toBe(false)
    expect(h.state.lastError).toContain('sign in again')
    expect(h.outbox.every((o) => o.synced === 0)).toBe(true)
  })

  test('409 on an ordinary record means "already there" — done', async () => {
    const h = harness([entry(1, 'customer')], () => res(409))
    await h.engine.flush()
    expect(h.outbox[0].synced).toBe(1)
    expect(h.billExists).not.toHaveBeenCalled()
  })

  test('409 on a bill is double-checked: our bill exists → done', async () => {
    const h = harness([entry(1, 'bill', { id: 'b1', no: 'INV-1' })], () => res(409))
    await h.engine.flush()
    expect(h.billExists).toHaveBeenCalledWith('b1')
    expect(h.outbox[0].synced).toBe(1)
  })

  test('409 on a bill that is NOT on the server means another device took the number — never silently dropped', async () => {
    const h = harness([entry(1, 'bill', { id: 'b1', no: 'INV-0042' }), entry(2, 'expense')], (_m, p) => res(p === '/bills' ? 409 : 200))
    h.billExists.mockRejectedValueOnce(new CloudError('Bill not found', 404))
    await h.engine.flush()
    expect(h.outbox[0].synced).toBe(2)
    expect(h.outbox[0].lastError).toContain('another device')
    expect(h.state.lastError).toContain('INV-0042')
    expect(h.outbox[1].synced).toBe(1) // the rest of the queue still goes
  })

  test('the staff PIN is dropped from the stored payload once the server has it', async () => {
    const h = harness([entry(1, 'user', { id: 'u1', name: 'Dev', pin: '4321' })], () => res(200))
    await h.engine.flush()
    expect(h.calls[0].body).toEqual({ id: 'u1', name: 'Dev', pin: '4321' })
    expect(h.outbox[0].payload).toEqual({ id: 'u1', name: 'Dev' })
    expect(withoutPin({ a: 1 })).toEqual({ a: 1 })
  })

  test('only one flush runs at a time', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const h = harness([entry(1, 'expense')], async () => { await gate; return res(200) })
    const a = h.engine.flush()
    const b = h.engine.flush()
    release()
    await Promise.all([a, b])
    expect(h.calls).toHaveLength(1)
  })

  test('refreshes the token when it is close to expiring', async () => {
    const exp = Math.floor(5000 / 1000) + 3600 // 1 h left
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64')
    const h = harness([entry(1, 'expense')], () => res(200))
    const engine = createSyncEngine({
      api: () => h.api, token: () => `h.${payload}.s`, setToken: jest.fn(), outbox: () => h.outbox,
      updateOutbox: async (id, patch) => { const i = h.outbox.findIndex((o) => o.id === id); h.outbox[i] = { ...h.outbox[i], ...patch } },
      applySnapshot: async () => undefined, isOnline: () => true, getState: () => h.state, setState: () => undefined, now: () => 5000,
    })
    await engine.flush()
    expect((h.api as unknown as { refresh: jest.Mock }).refresh).toHaveBeenCalled()
  })
})

describe('pull', () => {
  test('replaces local data only when nothing is waiting to upload', async () => {
    const waiting = harness([entry(1, 'bill', { id: 'b1' })], () => res(200))
    expect(await waiting.engine.pull()).toBe(false)
    expect(waiting.applied).toHaveLength(0)

    const clean = harness([entry(1, 'bill', { id: 'b1' }, { synced: 1 })], () => res(200))
    expect(await clean.engine.pull()).toBe(true)
    expect(clean.applied).toHaveLength(1)
    expect(clean.state.lastPulledAt).toBe(5000)
  })

  test('a bill rung up while the download was in flight is not wiped by it', async () => {
    const h = harness([], () => res(200))
    ;(h.api as unknown as { snapshot: jest.Mock }).snapshot.mockImplementation(async () => {
      h.outbox.push(entry(9, 'bill', { id: 'late' }))
      return { serverTime: 1 } as unknown as Snapshot
    })
    expect(await h.engine.pull()).toBe(false)
    expect(h.applied).toHaveLength(0)
  })

  test('syncNow uploads, then downloads', async () => {
    const h = harness([entry(1, 'expense')], () => res(200))
    await h.engine.syncNow()
    expect(h.calls).toHaveLength(1)
    expect(h.applied).toHaveLength(1)
  })
})

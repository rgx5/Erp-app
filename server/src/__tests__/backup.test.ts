import { addStaff, billDoc, customerDoc, maybe, moveDoc, mut, pgAvailable, pull, push, signup, startServer, variantDoc, type Biz, type TestServer } from './helpers'

jest.setTimeout(60_000)

maybe('backup and restore', pgAvailable(), () => {
  let s: TestServer
  let src: Biz
  let backup: any
  let secondBranch: string

  const worldOf = async (token: string) => {
    const r = await pull(s, token, 0, 2000)
    return new Map<string, any>(r.json.upserts.map((u: { coll: string; id: string; data: any }) => [`${u.coll}/${u.id}`, u.data]))
  }

  beforeAll(async () => {
    s = await startServer('backup')
    src = await signup(s, 'Source Shop', { pin: '1234' })
    const b2 = await s.call('POST', '/branches', { token: src.token, body: { name: 'Outlet Two', code: 'O2' } })
    secondBranch = b2.json.id
    await s.call('POST', '/roles', { token: src.token, body: { name: 'Floor staff', permissions: ['pos', 'stock'] } })
    const cashier = await addStaff(s, src, 'cashier', 'Ravi')
    const r = await push(s, src.token, [
      mut('categories', 'cat1', 'create', { id: 'cat1', name: 'Shirts' }),
      mut('products', 'p1', 'create', { id: 'p1', name: 'Oxford' }),
      mut('variants', 'v1', 'create', variantDoc('v1', { stock: 0 })),
      mut('moves', 'm1', 'create', moveDoc('m1', 'v1', 20)),
      mut('customers', 'c1', 'create', customerDoc('c1')),
      mut('quotations', 'q1', 'create', { id: 'q1', no: 'Q-1', items: [{ variantId: 'v1', qty: 1 }], branchId: secondBranch }),
      mut('quotations', 'q0', 'create', { id: 'q0', no: 'Q-0', items: [{ variantId: 'v1', qty: 1 }], branchId: src.branchId }),
      mut('products', 'gone', 'create', { id: 'gone', name: 'Deleted later' }),
    ])
    expect(r.json.results.every((x: { status: string }) => x.status === 'ok')).toBe(true)
    await push(s, src.token, [mut('products', 'gone', 'delete')])
    await push(s, cashier.token, [mut('bills', 'b1', 'create', billDoc('b1', { customerId: 'c1', loyaltyEarned: 25, soldBy: cashier.id, cashierId: cashier.id, branchId: secondBranch }))])
    const bk = await s.call('GET', '/backup', { token: src.token })
    expect(bk.status).toBe(200)
    backup = bk.json
  })
  afterAll(async () => { await s.close() })

  test('a backup is one JSON file with the whole business, deleted records left out, and no credentials', async () => {
    expect(backup).toMatchObject({ format: 'kosh-backup', version: 1, org: { name: 'Source Shop' } })
    const keys = backup.docs.map((d: { coll: string; id: string }) => `${d.coll}/${d.id}`)
    expect(keys).toEqual(expect.arrayContaining(['products/p1', 'variants/v1', 'bills/b1', 'customers/c1', 'moves/m1']))
    expect(keys).not.toContain('products/gone')
    expect(backup.branches).toHaveLength(2)
    expect(backup.roles.map((r: { name: string }) => r.name)).toEqual(['Floor staff'])
    const text = JSON.stringify(backup)
    expect(text).not.toMatch(/hash|\$2[aby]\$|password|pin_|secret/i)
    const raw = await s.call('GET', '/backup', { token: src.token })
    expect(String(raw.headers['content-disposition'])).toMatch(/^attachment; filename="kosh-backup-\d{4}-\d{2}-\d{2}\.json"$/)
  })

  test('only the owner can take or restore one', async () => {
    const manager = await addStaff(s, src, 'manager', 'Boss-ish')
    expect((await s.call('GET', '/backup', { token: manager.token })).status).toBe(403)
    expect((await s.call('POST', '/restore', { token: manager.token, body: backup })).status).toBe(403)
    expect((await s.call('GET', '/backup')).status).toBe(401)
    const key = await s.call('POST', '/api-keys', { token: src.token, body: { name: 'bk', permissions: ['settings', 'reports'] } })
    expect((await s.call('GET', '/backup', { token: key.json.key })).status).toBe(403)
  })

  test('restoring into a new, empty business brings everything back — stock and balances as they were, not recomputed', async () => {
    const dst = await signup(s, 'Destination Shop')
    const r = await s.call('POST', '/restore', { token: dst.token, body: backup })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)

    const was = await worldOf(src.token), now = await worldOf(dst.token)
    expect(now.get('variants/v1').stock).toBe(20) // the 20 from the movement, once
    expect(now.get('customers/c1').loyaltyPoints).toBe(25)
    expect({ ...now.get('bills/b1'), branchId: undefined }).toEqual({ ...was.get('bills/b1'), branchId: undefined })
    expect(now.get('products/p1')).toEqual(was.get('products/p1'))
    expect(now.has('products/gone')).toBe(false)
    // the restored business keeps working: new movements move the restored stock
    await push(s, dst.token, [mut('moves', 'm2', 'create', moveDoc('m2', 'v1', -3))])
    expect((await worldOf(dst.token)).get('variants/v1').stock).toBe(17)

    // branches are new ids in this business, and documents point at them
    const brs = (await s.call('GET', '/branches', { token: dst.token })).json
    expect(brs).toHaveLength(2)
    const o2 = brs.find((b: { name: string }) => b.name === 'Outlet Two')
    expect(o2.id).not.toBe(secondBranch)
    expect(now.get('quotations/q1').branchId).toBe(o2.id)
    expect(now.get('bills/b1').branchId).toBe(o2.id) // also where the collection itself is not branch-scoped
    expect(now.get('quotations/q0').branchId).toBe(dst.branchId) // the main branch maps to this business's main branch
    expect((await s.call('GET', '/roles', { token: dst.token })).json.map((x: { name: string }) => x.name)).toEqual(['Floor staff'])

    // the former staff are kept as inactive records so bills still say who served; nobody can sign in as them
    const former = [...now.entries()].filter(([k]) => k.startsWith('users/'))
    expect(former.length).toBe(3) // this owner, plus the source's owner and cashier
    const ravi = now.get(`users/${was.get('bills/b1').soldBy}`)
    expect(ravi).toMatchObject({ name: 'Ravi', active: false })
    const staff = await s.call('GET', `/auth/staff?orgId=${dst.orgId}`)
    expect(staff.json.map((u: { name: string }) => u.name)).toEqual(['Destination Shop Owner'])
    expect((await s.call('POST', '/auth/pin-login', { body: { orgId: dst.orgId, userId: ravi.id, pin: '4321', deviceId: 'x' } })).status).toBe(401)

    // a backup of the restored business is a backup of the same business
    const again = await s.call('GET', '/backup', { token: dst.token })
    const names = (b: any) => b.docs.filter((d: { coll: string }) => d.coll !== 'users' && d.coll !== 'moves').map((d: { coll: string; id: string }) => `${d.coll}/${d.id}`).sort()
    expect(names(again.json)).toEqual(names(backup))
  })

  test('a business that already has records is never overwritten', async () => {
    const r = await s.call('POST', '/restore', { token: src.token, body: backup })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('not_empty')
    const busy = await signup(s, 'Busy')
    await push(s, busy.token, [mut('products', 'mine', 'create', { id: 'mine', name: 'Mine' })])
    expect((await s.call('POST', '/restore', { token: busy.token, body: backup })).status).toBe(409)
    expect((await worldOf(busy.token)).has('variants/v1')).toBe(false)
  })

  test('a damaged or foreign file is refused before anything is written', async () => {
    const dst = await signup(s, 'Strict Shop')
    const bad = async (body: unknown, status: number) => expect((await s.call('POST', '/restore', { token: dst.token, body })).status).toBe(status)
    await bad({ hello: 'world' }, 400)
    await bad({ ...backup, version: 2 }, 400)
    await bad({ ...backup, docs: 'nope' }, 400)
    await bad({ ...backup, docs: [...backup.docs, { coll: 'martians', id: 'x', data: { id: 'x' } }] }, 422)
    await bad({ ...backup, docs: [...backup.docs, { coll: 'products', id: 'x', data: { id: 'y' } }] }, 422)
    await bad({ ...backup, docs: [...backup.docs, { coll: 'products', id: 'x', data: null }] }, 422)
    await bad({ ...backup, docs: [...backup.docs, { coll: 'products', id: 'x' }] }, 422)
    expect([...(await worldOf(dst.token)).keys()].filter((k) => !k.startsWith('users/'))).toEqual([])
    // and the business is still empty enough to take the good one
    expect((await s.call('POST', '/restore', { token: dst.token, body: backup })).status).toBe(200)
  })

  test('a restore cannot smuggle in server-only collections or someone else’s branch', async () => {
    const dst = await signup(s, 'Smuggle Shop')
    const evil = { ...backup, docs: [{ coll: 'quotations', id: 'qx', data: { id: 'qx', no: 'Q', items: [1], branchId: 'br_someone_elses' } }], branches: [] }
    expect((await s.call('POST', '/restore', { token: dst.token, body: evil })).status).toBe(200)
    const q = (await worldOf(dst.token)).get('quotations/qx')
    expect(q.branchId).toBeUndefined() // an unknown branch is dropped, never kept as a pointer into another business
  })
})

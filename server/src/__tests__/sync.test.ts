import { addStaff, billDoc, customerDoc, maybe, moveDoc, mut, pgAvailable, pull, push, signup, startServer, variantDoc, type Biz, type TestServer } from './helpers'

jest.setTimeout(60_000)

const results = (r: { json: any }) => r.json.results as Array<{ mid: string; status: string; code?: string; rev?: number }>
const find = (r: { json: any }, coll: string, id: string) => (r.json.upserts as Array<{ coll: string; id: string; data: any; rev: number }>).find((u) => u.coll === coll && u.id === id)

maybe('sync', pgAvailable(), () => {
  let s: TestServer
  beforeAll(async () => { s = await startServer('sync') })
  afterAll(async () => { await s.close() })

  /** A pull of everything, as `{ coll/id: data }`. */
  const world = async (token: string) => {
    const r = await pull(s, token, 0, 2000)
    const m = new Map<string, any>()
    for (const u of r.json.upserts) m.set(`${u.coll}/${u.id}`, u.data)
    return m
  }

  describe('create, patch, delete and idempotency', () => {
    let biz: Biz
    beforeAll(async () => { biz = await signup(s, 'Sync Basics') })

    test('create, patch and delete a master record; the delete reaches other devices as a tombstone', async () => {
      const t = biz.token
      const c = await push(s, t, [mut('categories', 'cat1', 'create', { id: 'cat1', name: 'Shirts', group: 'Men' })])
      expect(c.status).toBe(200)
      expect(results(c)[0]).toMatchObject({ status: 'ok' })
      const first = await pull(s, t, 0)
      expect(find(first, 'categories', 'cat1')!.data.name).toBe('Shirts')

      const p = await push(s, t, [mut('categories', 'cat1', 'patch', { name: 'Formal shirts', note: 'x' })])
      expect(results(p)[0].status).toBe('ok')
      const afterPatch = await pull(s, t, first.json.cursor)
      expect(afterPatch.json.upserts).toHaveLength(1)
      expect(afterPatch.json.upserts[0].data).toMatchObject({ id: 'cat1', name: 'Formal shirts', group: 'Men', note: 'x' })

      // null removes a field
      await push(s, t, [mut('categories', 'cat1', 'patch', { note: null })])
      expect(Object.keys((await world(t)).get('categories/cat1'))).not.toContain('note')

      const cursor = (await pull(s, t, 0)).json.cursor
      const d = await push(s, t, [mut('categories', 'cat1', 'delete')])
      expect(results(d)[0].status).toBe('ok')
      const gone = await pull(s, t, cursor)
      expect(gone.json.upserts).toEqual([])
      expect(gone.json.deletes).toEqual([{ coll: 'categories', id: 'cat1', rev: expect.any(Number) }])
      expect((await world(t)).has('categories/cat1')).toBe(false)
      // deleting again is harmless; patching a deleted record is not_found
      expect(results(await push(s, t, [mut('categories', 'cat1', 'delete')]))[0].status).toBe('duplicate')
      expect(results(await push(s, t, [mut('categories', 'cat1', 'patch', { name: 'again' })]))[0]).toMatchObject({ status: 'rejected', code: 'not_found' })
      // a record can be created again after its delete
      expect(results(await push(s, t, [mut('categories', 'cat1', 'create', { id: 'cat1', name: 'Back', group: 'Men' })]))[0].status).toBe('ok')
      expect((await world(t)).get('categories/cat1').name).toBe('Back')
    })

    test('the same mutation id is applied once: a retry after a lost reply changes nothing', async () => {
      const t = biz.token
      const batch = [
        mut('variants', 'v_idem', 'create', variantDoc('v_idem'), 'dev:idem-1'),
        mut('moves', 'm_idem', 'create', moveDoc('m_idem', 'v_idem', 10), 'dev:idem-2'),
      ]
      const a = await push(s, t, batch)
      expect(results(a).map((r) => r.status)).toEqual(['ok', 'ok'])
      const cursor = (await pull(s, t, 0)).json.cursor
      const b = await push(s, t, batch)
      expect(results(b).map((r) => r.status)).toEqual(['duplicate', 'duplicate'])
      const w = await world(t)
      expect(w.get('variants/v_idem').stock).toBe(10) // not 20
      expect((await pull(s, t, cursor)).json.upserts).toEqual([]) // nothing was rewritten
    })

    test('a refused write leaves no trace and does not stop the writes behind it', async () => {
      const t = biz.token
      const r = await push(s, t, [
        mut('products', 'p_ok1', 'create', { id: 'p_ok1', name: 'One' }),
        mut('products', 'p_bad', 'create', { id: 'someone-else', name: 'Mismatched id' }),
        mut('nothing', 'x', 'create', { id: 'x' }),
        mut('users', 'u1', 'create', { id: 'u1', name: 'sneaky', role: 'owner' }),
        mut('moves', 'm_bad', 'create', { id: 'm_bad', qty: 'lots' }),
        { mid: '', coll: 'products', id: 'z', op: 'create' },
        mut('products', 'p_ok2', 'create', { id: 'p_ok2', name: 'Two' }),
      ])
      expect(results(r).map((x) => x.status === 'rejected' ? x.code : x.status)).toEqual(['ok', 'invalid', 'unknown_collection', 'managed', 'invalid', 'invalid', 'ok'])
      const w = await world(t)
      expect(w.has('products/p_ok1') && w.has('products/p_ok2')).toBe(true)
      expect(w.has('products/p_bad') || w.has('products/someone-else') || w.has('users/u1')).toBe(false)
      // a refused mutation id was not remembered: the corrected write with the same id goes through
      const m = mut('products', 'p_late', 'create', { id: 'wrong' }, 'dev:late')
      expect(results(await push(s, t, [m]))[0].status).toBe('rejected')
      expect(results(await push(s, t, [{ ...m, data: { id: 'p_late', name: 'Fixed' } }]))[0].status).toBe('ok')
    })

    test('records over the size limit are refused', async () => {
      const r = await push(s, biz.token, [mut('products', 'p_big', 'create', { id: 'p_big', name: 'x'.repeat(300 * 1024) })])
      expect(results(r)[0]).toMatchObject({ status: 'rejected', code: 'too_large' })
    })

    test('batches are bounded and must be a list', async () => {
      const many = Array.from({ length: 201 }, (_, i) => mut('products', `p_many${i}`, 'create', { id: `p_many${i}`, name: 'n' }))
      expect((await push(s, biz.token, many)).status).toBe(413)
      expect((await s.call('POST', '/sync/push', { token: biz.token, body: { mutations: 'nope' } })).status).toBe(400)
      expect((await s.call('POST', '/sync/push', { token: biz.token, body: {} })).status).toBe(400)
      expect(results(await push(s, biz.token, [null, 7, 'x']))).toHaveLength(3)
      expect((await s.call('POST', '/sync/push', { token: biz.token, body: { mutations: Array.from({ length: 200 }, (_, i) => mut('products', `p_two${i}`, 'create', { id: `p_two${i}`, name: 'n' })) } })).status).toBe(200)
    })

    test('pull validates its parameters', async () => {
      expect((await s.call('GET', '/sync/pull?since=abc', { token: biz.token })).status).toBe(400)
      expect((await s.call('GET', '/sync/pull?since=-1', { token: biz.token })).status).toBe(400)
      expect((await s.call('GET', '/sync/pull?limit=0', { token: biz.token })).status).toBe(400)
    })

    test('/sync/info lists the registry, including module collections', async () => {
      const r = await s.call('GET', '/sync/info', { token: biz.token })
      expect(r.status).toBe(200)
      const names = r.json.collections.map((c: { name: string }) => c.name)
      expect(names).toEqual(expect.arrayContaining(['bills', 'moves', 'variants', 'collections', 'batches', 'quotations', 'vouchers']))
      expect(r.json.collections.find((c: { name: string }) => c.name === 'variants')).toMatchObject({ kind: 'master', owned: expect.arrayContaining(['stock']) })
    })
  })

  describe('ledgers and server-owned fields', () => {
    let biz: Biz
    beforeAll(async () => {
      biz = await signup(s, 'Ledger Shop')
      await push(s, biz.token, [mut('variants', 'v1', 'create', variantDoc('v1', { stock: 5 })), mut('customers', 'c1', 'create', customerDoc('c1'))])
    })

    test('a posted bill is created once; a second create is a duplicate and changes nothing', async () => {
      const bill = billDoc('b1', { customerId: 'c1', loyaltyEarned: 10, payments: [{ mode: 'cash', amount: 999 }] })
      expect(results(await push(s, biz.token, [mut('bills', 'b1', 'create', bill)]))[0].status).toBe('ok')
      const again = await push(s, biz.token, [mut('bills', 'b1', 'create', { ...bill, total: 1 })])
      expect(results(again)[0].status).toBe('duplicate')
      const w = await world(biz.token)
      expect(w.get('bills/b1').total).toBe(999)
      expect(w.get('customers/c1').loyaltyPoints).toBe(10) // the effect ran once
    })

    test('a posted bill cannot be edited or deleted — except its note', async () => {
      const t = biz.token
      expect(results(await push(s, t, [mut('bills', 'b1', 'patch', { total: 1 })]))[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
      expect(results(await push(s, t, [mut('bills', 'b1', 'delete')]))[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
      expect(results(await push(s, t, [mut('bills', 'b1', 'patch', { total: 1, notes: 'gift wrapped' })]))[0].status).toBe('ok')
      const b = (await world(t)).get('bills/b1')
      expect(b).toMatchObject({ total: 999, notes: 'gift wrapped' })
      expect(results(await push(s, t, [mut('moves', 'm_imm', 'create', moveDoc('m_imm', 'v1', 1))]))[0].status).toBe('ok')
      expect(results(await push(s, t, [mut('moves', 'm_imm', 'patch', { qty: 100 })]))[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
      expect(results(await push(s, t, [mut('moves', 'm_imm', 'delete')]))[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
    })

    test('a patch to a server-owned field is ignored; a re-create keeps the server’s number', async () => {
      const t = biz.token
      await push(s, t, [mut('moves', 'm_own', 'create', moveDoc('m_own', 'v1', 4))])
      const before = (await world(t)).get('variants/v1')
      const p = await push(s, t, [mut('variants', 'v1', 'patch', { stock: 9999, price: 1111 })])
      expect(results(p)[0].status).toBe('ok')
      const after = (await world(t)).get('variants/v1')
      expect(after.price).toBe(1111)
      expect(after.stock).toBe(before.stock)
      // only an owned field: nothing to write
      const cursor = (await pull(s, t, 0)).json.cursor
      expect(results(await push(s, t, [mut('customers', 'c1', 'patch', { loyaltyPoints: 1e6, storeCredit: 1e6 })]))[0].status).toBe('ok')
      expect((await pull(s, t, cursor)).json.upserts).toEqual([])
      // creating the record again (a phone re-publishing) cannot overwrite the server's stock
      await push(s, t, [mut('variants', 'v1', 'create', variantDoc('v1', { stock: 777, price: 1234 }))])
      const re = (await world(t)).get('variants/v1')
      expect(re).toMatchObject({ price: 1234, stock: before.stock })
    })

    test('stock movements move stock, in the same write', async () => {
      const t = biz.token
      await push(s, t, [mut('variants', 'v_fx', 'create', variantDoc('v_fx', { stock: 0 }))])
      const r = await push(s, t, [
        mut('moves', 'fx1', 'create', moveDoc('fx1', 'v_fx', 12)),
        mut('moves', 'fx2', 'create', moveDoc('fx2', 'v_fx', -5)),
        mut('moves', 'fx3', 'create', moveDoc('fx3', 'v_missing', 3)), // a missing target is skipped, the movement is still recorded
      ])
      expect(results(r).map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
      const w = await world(t)
      expect(w.get('variants/v_fx').stock).toBe(7)
      expect(w.has('moves/fx3')).toBe(true)
      // the effect's revision is after the movement's
      const pulled = await pull(s, t, 0)
      expect(find(pulled, 'variants', 'v_fx')!.rev).toBeGreaterThan(find(pulled, 'moves', 'fx1')!.rev)
    })

    test('sales and credit notes keep loyalty points, store credit and the original bill', async () => {
      const t = biz.token
      await push(s, t, [mut('customers', 'c_loy', 'create', customerDoc('c_loy'))])
      await push(s, t, [mut('moves', 'seed_loy', 'create', moveDoc('seed_loy', 'v1', 0))])
      const sale = billDoc('b_sale', { customerId: 'c_loy', loyaltyEarned: 40, loyaltyRedeemed: 10, creditUsed: 0 })
      await push(s, t, [mut('bills', 'b_sale', 'create', sale)])
      expect((await world(t)).get('customers/c_loy')).toMatchObject({ loyaltyPoints: 30, storeCredit: 0 })
      // a customer with store credit spends some of it
      await push(s, t, [mut('customers', 'c_cr', 'create', customerDoc('c_cr')), mut('bills', 'b_cr0', 'create', billDoc('b_cr0', { customerId: 'c_cr', loyaltyEarned: 0, payments: [{ mode: 'cash', amount: 999 }] }))])
      const topup = await push(s, t, [mut('creditTopups', 'tu1', 'create', { id: 'tu1', customerId: 'c_cr', amount: 500, date: 1, mode: 'cash' })])
      expect(results(topup)[0].status).toBe('ok')
      await push(s, t, [mut('bills', 'b_cr1', 'create', billDoc('b_cr1', { customerId: 'c_cr', creditUsed: 200, payments: [{ mode: 'cash', amount: 799 }] }))])
      expect((await world(t)).get('customers/c_cr').storeCredit).toBe(300)
      // a credit note for the first sale: points reversed (floored at 0), original marked returned
      const note = billDoc('b_ret', {
        customerId: 'c_loy', refundOfBillId: 'b_sale', total: 999, loyaltyEarned: -20, status: 'refund',
        items: [{ variantId: 'v1', productId: 'p1', name: 'Oxford Shirt', qty: 1, returnedQty: 0, price: 999, discountAmount: 0, lineTotal: 999 }],
        payments: [{ mode: 'cash', amount: 999 }],
      })
      expect(results(await push(s, t, [mut('bills', 'b_ret', 'create', note)]))[0].status).toBe('ok')
      const w = await world(t)
      expect(w.get('customers/c_loy').loyaltyPoints).toBe(10) // 30 − 20
      expect(w.get('bills/b_sale')).toMatchObject({ status: 'returned' })
      expect(w.get('bills/b_sale').items[0].returnedQty).toBe(1)
    })

    test('effects and the write commit together: an invalid movement changes no stock', async () => {
      const t = biz.token
      await push(s, t, [mut('variants', 'v_atom', 'create', variantDoc('v_atom', { stock: 3 }))])
      const r = await push(s, t, [mut('moves', 'm_atom', 'create', { id: 'm_atom', variantId: 'v_atom', qty: Number.NaN })])
      expect(results(r)[0].status).toBe('rejected')
      expect((await world(t)).get('variants/v_atom').stock).toBe(3)
      expect((await world(t)).has('moves/m_atom')).toBe(false)
    })
  })

  describe('permissions, roles and branches', () => {
    let owner: Biz
    let cashier: { id: string; token: string }
    let manager: { id: string; token: string }
    beforeAll(async () => {
      owner = await signup(s, 'Perm Shop')
      cashier = await addStaff(s, owner, 'cashier', 'Ravi')
      manager = await addStaff(s, owner, 'manager', 'Meera')
      await push(s, owner.token, [
        mut('products', 'p1', 'create', { id: 'p1', name: 'Shirt' }),
        mut('suppliers', 's1', 'create', { id: 's1', name: 'Fab Mills' }),
        mut('variants', 'v1', 'create', variantDoc('v1')),
        mut('expenses', 'e1', 'create', { id: 'e1', title: 'Rent', amount: 100 }),
        mut('moves', 'm0', 'create', moveDoc('m0', 'v1', 3)),
      ])
    })

    test('a role can only write what it has permission for', async () => {
      const r = await push(s, cashier.token, [
        mut('products', 'p_c', 'create', { id: 'p_c', name: 'Not allowed' }),
        mut('customers', 'c_c', 'create', customerDoc('c_c')),
        mut('bills', 'b_c', 'create', billDoc('b_c')),
        mut('settings', 'store', 'patch', { name: 'Hijack' }),
      ])
      expect(results(r).map((x) => x.status === 'rejected' ? x.code : x.status)).toEqual(['forbidden', 'ok', 'ok', 'forbidden'])
      const m = await push(s, manager.token, [mut('products', 'p_m', 'create', { id: 'p_m', name: 'Allowed' }), mut('coupons', 'cp', 'create', { id: 'cp', code: 'X' })])
      expect(results(m).map((x) => x.status === 'rejected' ? x.code : x.status)).toEqual(['ok', 'forbidden'])
    })

    test('a pull carries only the collections the role may read', async () => {
      const mine = await world(cashier.token)
      const keys = [...mine.keys()]
      expect(keys).toEqual(expect.arrayContaining(['products/p1', 'variants/v1', 'customers/c_c', 'bills/b_c']))
      expect(keys.some((k) => k.startsWith('suppliers/'))).toBe(false)
      expect(keys.some((k) => k.startsWith('expenses/'))).toBe(false)
      expect(keys.some((k) => k.startsWith('moves/'))).toBe(false) // readPerm: stock
      expect(keys.some((k) => k.startsWith('audit/'))).toBe(false)
      const all = [...(await world(owner.token)).keys()]
      expect(all).toEqual(expect.arrayContaining(['suppliers/s1', 'expenses/e1', 'moves/m0']))
      // the cashier's cursor still reaches the end, so they are not told to re-ask for ranges they cannot see
      const first = await pull(s, cashier.token, 0)
      expect((await pull(s, cashier.token, first.json.cursor)).json.cursor).toBe(first.json.cursor)
    })

    test('a custom role replaces the built-in permissions; changing it takes effect at once', async () => {
      const role = await s.call('POST', '/roles', { token: owner.token, body: { name: 'Stock clerk', permissions: ['stock', 'inventory'] } })
      expect(role.status).toBe(201)
      const staff = await addStaff(s, owner, 'cashier', 'Clerk', { roleId: role.json.id })
      const me = await s.call('GET', '/auth/me', { token: staff.token })
      expect(me.json.permissions).toEqual(['inventory', 'stock'])
      const r = await push(s, staff.token, [mut('products', 'p_k', 'create', { id: 'p_k', name: 'By clerk' }), mut('bills', 'b_k', 'create', billDoc('b_k')), mut('moves', 'm_k', 'create', moveDoc('m_k', 'v1', 1))])
      expect(results(r).map((x) => x.status === 'rejected' ? x.code : x.status)).toEqual(['ok', 'forbidden', 'ok'])
      expect((await world(staff.token)).has('moves/m_k')).toBe(true)
      await s.call('PUT', `/roles/${role.json.id}`, { token: owner.token, body: { permissions: ['pos'] } })
      const after = await push(s, staff.token, [mut('products', 'p_k2', 'create', { id: 'p_k2', name: 'Now refused' })])
      expect(results(after)[0]).toMatchObject({ status: 'rejected', code: 'forbidden' })
    })

    test('a person limited to some branches only writes and receives those', async () => {
      const b2 = await s.call('POST', '/branches', { token: owner.token, body: { name: 'Second outlet' } })
      expect(b2.status).toBe(201)
      const b1 = owner.branchId, other = b2.json.id as string
      const limited = await addStaff(s, owner, 'cashier', 'Branch1 only', { branches: [b1] })
      const quote = (id: string, branchId?: string) => ({ id, no: `Q-${id}`, items: [{ variantId: 'v1', qty: 1 }], ...(branchId ? { branchId } : {}) })
      const ownerPush = await push(s, owner.token, [
        mut('quotations', 'q_b1', 'create', quote('q_b1', b1)),
        mut('quotations', 'q_b2', 'create', quote('q_b2', other)),
        mut('quotations', 'q_org', 'create', quote('q_org')),
      ])
      expect(results(ownerPush).every((x) => x.status === 'ok')).toBe(true)

      const keys = [...(await world(limited.token)).keys()].filter((k) => k.startsWith('quotations/')).sort()
      expect(keys).toEqual(['quotations/q_b1', 'quotations/q_org'])
      expect([...(await world(owner.token)).keys()].filter((k) => k.startsWith('quotations/'))).toHaveLength(3)

      const w = await push(s, limited.token, [mut('quotations', 'q_new2', 'create', quote('q_new2', other)), mut('quotations', 'q_new1', 'create', quote('q_new1', b1)), mut('quotations', 'q_b2', 'delete'), mut('quotations', 'q_b2', 'patch', { note: 'x' })])
      expect(results(w).map((x) => x.status === 'rejected' ? x.code : x.status)).toEqual(['branch_forbidden', 'ok', 'branch_forbidden', 'branch_forbidden'])
      // nothing about the out-of-branch record changed
      expect((await world(owner.token)).has('quotations/q_b2')).toBe(true)
      expect((await world(owner.token)).get('quotations/q_b2').note).toBeUndefined()
    })
  })

  describe('the delta cursor', () => {
    test('a puller sees everything once: pages, empty pulls, then only what changed', async () => {
      const biz = await signup(s, 'Cursor Shop')
      const t = biz.token
      const ids = Array.from({ length: 25 }, (_, i) => `p${String(i).padStart(2, '0')}`)
      await push(s, t, ids.map((id) => mut('products', id, 'create', { id, name: id })))

      // page through with a small limit
      let cursor = 0
      const seen: string[] = []
      for (let guard = 0; guard < 20; guard++) {
        const page = await pull(s, t, cursor, 10)
        expect(page.status).toBe(200)
        expect(page.json.cursor).toBeGreaterThanOrEqual(cursor)
        for (const u of page.json.upserts) seen.push(`${u.coll}/${u.id}`)
        cursor = page.json.cursor
        if (!page.json.hasMore) break
      }
      expect(seen.filter((k) => k.startsWith('products/')).sort()).toEqual(ids.map((i) => `products/${i}`))
      expect(new Set(seen).size).toBe(seen.length)

      const idle = await pull(s, t, cursor)
      expect(idle.json).toEqual({ cursor, hasMore: false, upserts: [], deletes: [] })

      await push(s, t, [mut('products', 'p00', 'patch', { name: 'renamed' }), mut('products', 'p01', 'delete')])
      const delta = await pull(s, t, cursor)
      expect(delta.json.upserts.map((u: { id: string }) => u.id)).toEqual(['p00'])
      expect(delta.json.deletes.map((d: { id: string }) => d.id)).toEqual(['p01'])
      expect(delta.json.cursor).toBeGreaterThan(cursor)
      // revisions are strictly increasing within a page
      const revs = [...delta.json.upserts, ...delta.json.deletes].map((x: { rev: number }) => x.rev)
      expect(new Set(revs).size).toBe(revs.length)
    })

    test('the push answer carries a cursor that is not behind the writes it just made', async () => {
      const biz = await signup(s, 'Cursor Two')
      const r = await push(s, biz.token, [mut('products', 'pp', 'create', { id: 'pp', name: 'n' })])
      const pulled = await pull(s, biz.token, 0)
      expect(r.json.cursor).toBe(pulled.json.cursor)
      const rev = results(r)[0].rev!
      expect(r.json.cursor).toBeGreaterThanOrEqual(rev)
    })

    test('two devices of one business converge', async () => {
      const biz = await signup(s, 'Two Phones')
      const second = await s.call('POST', '/auth/login', { body: { email: biz.email, password: 'correct horse battery', deviceId: 'phone-two', deviceName: 'Second' } })
      const a = biz.token, b = second.json.token as string
      await push(s, a, [mut('products', 'shared', 'create', { id: 'shared', name: 'Shirt', brand: 'Acme' })])
      const cursorB = (await pull(s, b, 0)).json.cursor
      // each edits a different field, concurrently
      await Promise.all([push(s, a, [mut('products', 'shared', 'patch', { name: 'Shirt Pro' })]), push(s, b, [mut('products', 'shared', 'patch', { brand: 'Acme Co' })])])
      expect((await world(a)).get('products/shared')).toMatchObject({ name: 'Shirt Pro', brand: 'Acme Co' })
      expect((await pull(s, b, cursorB)).json.upserts).toHaveLength(1)
    })
  })
})

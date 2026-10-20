import { signToken } from '../tokens'
import { addStaff, billDoc, maybe, mut, pgAvailable, pull, push, signup, startServer, variantDoc, type Biz, type TestServer } from './helpers'

jest.setTimeout(60_000)

maybe('multi-tenant isolation', pgAvailable(), () => {
  let s: TestServer
  let a: Biz, b: Biz
  let staffA: { id: string; token: string }
  let roleA: string, keyA: string, keyIdA: string, fileA: string, shareA: string, branchA: string

  beforeAll(async () => {
    s = await startServer('tenancy')
    a = await signup(s, 'Org A')
    b = await signup(s, 'Org B')
    staffA = await addStaff(s, a, 'cashier', 'A cashier')
    // Both businesses use the very same ids (a phone chooses its own ids).
    for (const [biz, tag] of [[a, 'A'], [b, 'B']] as const) {
      const r = await push(s, biz.token, [
        mut('products', 'p1', 'create', { id: 'p1', name: `Product of ${tag}` }),
        mut('variants', 'v1', 'create', variantDoc('v1', { stock: tag === 'A' ? 10 : 20 }), 'same:1'),
        mut('bills', 'b1', 'create', billDoc('b1', { notes: `bill of ${tag}` }), 'same:2'),
      ])
      expect(r.json.results.map((x: { status: string }) => x.status)).toEqual(['ok', 'ok', 'ok'])
    }
    roleA = (await s.call('POST', '/roles', { token: a.token, body: { name: 'A role', permissions: ['pos'] } })).json.id
    const k = await s.call('POST', '/api-keys', { token: a.token, body: { name: 'A key', permissions: ['pos', 'inventory'] } })
    keyA = k.json.key; keyIdA = k.json.id
    const up = await s.call('POST', '/files', { token: a.token, raw: Buffer.from('secret of A'), headers: { 'content-type': 'text/plain', 'x-filename': 'a.txt' } })
    expect(up.status).toBe(201)
    fileA = up.json.id
    shareA = (await s.call('POST', '/share', { token: a.token, body: { coll: 'bills', id: 'b1' } })).json.token
    branchA = a.branchId
  })
  afterAll(async () => { await s.close() })

  const docsOf = async (biz: Biz) => {
    const r = await pull(s, biz.token, 0)
    return new Map<string, any>(r.json.upserts.map((u: { coll: string; id: string; data: any }) => [`${u.coll}/${u.id}`, u.data]))
  }

  test('identical ids and mutation ids in two businesses are two different records', async () => {
    const da = await docsOf(a), db = await docsOf(b)
    expect(da.get('products/p1').name).toBe('Product of A')
    expect(db.get('products/p1').name).toBe('Product of B')
    expect(da.get('variants/v1').stock).toBe(10)
    expect(db.get('variants/v1').stock).toBe(20)
    expect(da.get('bills/b1').notes).toBe('bill of A')
    expect(db.get('bills/b1').notes).toBe('bill of B')
    // a pull holds nothing of the other business
    expect(JSON.stringify([...da.values()])).not.toMatch(/Org B|of B/)
    expect(JSON.stringify([...db.values()])).not.toMatch(/Org A|of A|A cashier/)
  })

  test('B cannot change or delete A’s records, and writes of one never land in the other', async () => {
    await push(s, b.token, [mut('products', 'only_a', 'create', { id: 'only_a', name: 'x' })])
    // only A has this id; B patching/deleting "A's" record is simply not_found for B
    await push(s, a.token, [mut('products', 'a_private', 'create', { id: 'a_private', name: 'A private' })])
    const r = await push(s, b.token, [mut('products', 'a_private', 'patch', { name: 'hacked' }), mut('products', 'a_private', 'delete'), mut('bills', 'a_nothing', 'patch', { notes: 'x' })])
    expect(r.json.results.map((x: { status: string; code?: string }) => x.code ?? x.status)).toEqual(['not_found', 'duplicate', 'not_found'])
    expect((await docsOf(a)).get('products/a_private').name).toBe('A private')
    expect((await docsOf(b)).has('products/a_private')).toBe(false)
    expect((await docsOf(a)).has('products/only_a')).toBe(false)
  })

  test('a token cannot be re-pointed at another business', async () => {
    // A well-formed token (right secret) for B's owner but claiming A's org, and the reverse: the user must exist in that org.
    const cfg = s.app.ctx.cfg
    const forged1 = signToken(cfg, { sub: b.userId, org: a.orgId, dev: b.deviceId, ver: 0, sv: 0 })
    const forged2 = signToken(cfg, { sub: a.userId, org: b.orgId, dev: a.deviceId, ver: 0, sv: 0 })
    for (const t of [forged1, forged2]) {
      expect((await s.call('GET', '/auth/me', { token: t })).status).toBe(401)
      expect((await pull(s, t, 0)).status).toBe(401)
    }
    // a token signed with some other secret
    const other = signToken({ ...cfg, jwtSecret: 'another-secret-another-secret-another-secret' }, { sub: a.userId, org: a.orgId, dev: a.deviceId, ver: 0, sv: 0 })
    expect((await s.call('GET', '/auth/me', { token: other })).status).toBe(401)
  })

  test('management endpoints only ever show and touch the caller’s own business', async () => {
    const users = await s.call('GET', '/users', { token: b.token })
    expect(users.json.map((u: { id: string }) => u.id)).toEqual([b.userId])
    expect((await s.call('GET', '/roles', { token: b.token })).json).toEqual([])
    expect((await s.call('GET', '/api-keys', { token: b.token })).json).toEqual([])
    expect((await s.call('GET', '/devices', { token: b.token })).json.map((d: { id: string }) => d.id)).toEqual([b.deviceId])
    expect((await s.call('GET', '/org', { token: b.token })).json.name).toBe('Org B')
    expect((await s.call('GET', '/branches', { token: b.token })).json.map((x: { id: string }) => x.id)).not.toContain(branchA)
    const staff = await s.call('GET', `/auth/staff?orgId=${b.orgId}`)
    expect(JSON.stringify(staff.json)).not.toContain('A cashier')

    expect((await s.call('PUT', `/users/${staffA.id}`, { token: b.token, body: { name: 'pwned' } })).status).toBe(404)
    expect((await s.call('POST', `/users/${staffA.id}/pin`, { token: b.token, body: { pin: '9999' } })).status).toBe(404)
    expect((await s.call('DELETE', `/users/${staffA.id}`, { token: b.token })).status).toBe(404)
    expect((await s.call('PUT', `/roles/${roleA}`, { token: b.token, body: { name: 'pwned' } })).status).toBe(404)
    expect((await s.call('DELETE', `/roles/${roleA}`, { token: b.token })).status).toBe(404)
    expect((await s.call('PUT', `/branches/${branchA}`, { token: b.token, body: { name: 'pwned' } })).status).toBe(404)
    expect((await s.call('DELETE', `/devices/${a.deviceId}`, { token: b.token })).status).toBe(404)
    expect((await s.call('DELETE', `/api-keys/${keyIdA}`, { token: b.token })).status).toBeGreaterThanOrEqual(400)
    expect((await s.call('DELETE', `/share/${shareA}`, { token: b.token })).status).toBe(404)

    // none of it happened
    expect((await s.call('GET', '/auth/me', { token: staffA.token })).json.user.name).toBe('A cashier')
    expect((await s.call('GET', '/roles', { token: a.token })).json).toHaveLength(1)
    expect((await s.call('GET', '/devices', { token: a.token })).json.find((d: { id: string }) => d.id === a.deviceId).revoked).toBe(false)
    expect((await s.call('GET', '/api-keys', { token: a.token })).json[0].revoked).toBe(false)
    expect((await s.call('GET', `/p/${shareA}`)).status).toBe(200)
  })

  test('B cannot attach A’s roles or branches to its own people', async () => {
    const mk = await s.call('POST', '/users', { token: b.token, body: { name: 'Mallory', role: 'cashier', pin: '1111', roleId: roleA } })
    expect(mk.status).toBe(422)
    const mk2 = await s.call('POST', '/users', { token: b.token, body: { name: 'Mallory', role: 'cashier', pin: '1111', branches: [branchA] } })
    expect(mk2.status).toBe(422)
    const sameId = await s.call('POST', '/users', { token: b.token, body: { id: staffA.id, name: 'Same id elsewhere', role: 'cashier', pin: '1111' } })
    expect(sameId.status).toBe(201) // ids are per business …
    expect((await s.call('GET', '/auth/me', { token: staffA.token })).json.user.name).toBe('A cashier') // … and this did not touch A's person
  })

  test('files, shares and backups are per business', async () => {
    expect((await s.call('GET', `/files/${fileA}`, { token: b.token })).status).toBe(404)
    expect((await s.call('DELETE', `/files/${fileA}`, { token: b.token })).status).toBe(404)
    expect((await s.call('GET', `/files/${fileA}`, { token: a.token })).body).toBe('secret of A')
    // B cannot mint a link to A's bill id — B's own b1 is a different bill
    const mine = await s.call('POST', '/share', { token: b.token, body: { coll: 'bills', id: 'b1' } })
    expect(mine.status).toBe(201)
    const page = (await s.call('GET', `/p/${mine.json.token}`)).body
    expect(page).toContain('INV-b1')
    expect(page).toContain('Org B')
    expect(page).not.toContain('Org A')
    expect((await s.call('POST', '/share', { token: b.token, body: { coll: 'bills', id: 'a_private_bill' } })).status).toBe(404)
    const bk = await s.call('GET', '/backup', { token: b.token })
    expect(bk.status).toBe(200)
    expect(JSON.stringify(bk.json)).not.toMatch(/Org A|of A|A cashier|A private/)
  })

  test('an API key belongs to its business', async () => {
    const me = await s.call('GET', '/auth/me', { token: keyA })
    expect(me.status).toBe(200)
    expect(me.json.org.name).toBe('Org A')
    const pulled = await pull(s, keyA, 0)
    expect(pulled.status).toBe(200)
    expect(JSON.stringify(pulled.json)).not.toMatch(/of B|Org B/)
    expect((await s.call('GET', '/users', { token: keyA })).status).toBe(403)
  })

  test('hostile ids and collection names are only data', async () => {
    const nasty = "p'; DROP TABLE docs; --"
    const r = await push(s, a.token, [mut('products', nasty, 'create', { id: nasty, name: 'Bobby' }), mut("docs'; --", 'x', 'create', { id: 'x' })])
    expect(r.json.results.map((x: { status: string; code?: string }) => x.code ?? x.status)).toEqual(['ok', 'unknown_collection'])
    expect((await docsOf(a)).get(`products/${nasty}`).name).toBe('Bobby')
    expect((await s.call('GET', "/auth/staff?orgId=x' OR '1'='1")).json).toEqual([])
    expect((await s.call('POST', '/auth/login', { body: { email: "a@b.co' OR 1=1 --", password: 'x', deviceId: 'd' } })).status).toBe(400)
  })

  test('nothing changed hands: each business still has exactly its own counts', async () => {
    const q = await s.pool.query<{ org_id: string; n: number }>('SELECT org_id, count(*)::int AS n FROM docs GROUP BY org_id')
    const byOrg = new Map(q.rows.map((r) => [r.org_id, r.n]))
    expect(byOrg.get(a.orgId)).toBeGreaterThan(0)
    expect(byOrg.get(b.orgId)).toBeGreaterThan(0)
    expect(byOrg.get(a.orgId)).not.toBe(byOrg.get(b.orgId))
  })
})

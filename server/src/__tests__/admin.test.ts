import { addStaff, billDoc, maybe, mut, pgAvailable, pull, push, signup, startServer, type Biz, type TestServer } from './helpers'

jest.setTimeout(60_000)

maybe('staff, roles, branches, org, devices and API keys', pgAvailable(), () => {
  let s: TestServer
  beforeAll(async () => { s = await startServer('admin') })
  afterAll(async () => { await s.close() })

  const usersDocs = async (biz: Biz) => {
    const r = await pull(s, biz.token, 0, 2000)
    return new Map<string, any>(r.json.upserts.filter((u: { coll: string }) => u.coll === 'users').map((u: { id: string; data: any }) => [u.id, u.data]))
  }

  describe('users', () => {
    let biz: Biz
    beforeAll(async () => { biz = await signup(s, 'Staff Shop') })

    test('adding a person creates their account and their record; no credential ever leaves the server', async () => {
      const r = await s.call('POST', '/users', { token: biz.token, body: { name: 'Ravi', role: 'cashier', pin: '4321', code: '07', email: 'Ravi@Example.test', password: 'ravi-password' } })
      expect(r.status).toBe(201)
      expect(r.json).toMatchObject({ name: 'Ravi', role: 'cashier', active: true, code: '07', email: 'ravi@example.test', hasPin: true, hasPassword: true })
      expect(r.body).not.toMatch(/\$2[aby]\$|hash/i)
      const docs = await usersDocs(biz)
      expect(docs.get(r.json.id)).toEqual({ id: r.json.id, name: 'Ravi', role: 'cashier', active: true, code: '07' })
      const list = await s.call('GET', '/users', { token: biz.token })
      expect(list.json.map((u: { name: string }) => u.name)).toEqual(['Staff Shop Owner', 'Ravi'])
      expect(list.body).not.toMatch(/\$2[aby]\$|hash/i)
      // the new person can sign in with the PIN and with the password
      expect((await s.call('POST', '/auth/pin-login', { body: { orgId: biz.orgId, userId: r.json.id, pin: '4321', deviceId: 'ravi-till' } })).status).toBe(200)
      expect((await s.call('POST', '/auth/login', { body: { email: 'ravi@example.test', password: 'ravi-password', deviceId: 'ravi-phone' } })).status).toBe(200)
    })

    test('a client may choose the id; sending the same add again is a conflict the app treats as done', async () => {
      const body = { id: 'usr_from_phone', name: 'Meera', role: 'manager', pin: '2468' }
      expect((await s.call('POST', '/users', { token: biz.token, body })).status).toBe(201)
      const again = await s.call('POST', '/users', { token: biz.token, body })
      expect(again.status).toBe(409)
      expect(again.json.code).toBe('id_taken')
      // the phone's payload shape: code null, extra keys ignored
      expect((await s.call('POST', '/users', { token: biz.token, body: { id: 'usr_p2', name: 'Phone shaped', role: 'cashier', active: true, code: null, pin: '1357' } })).status).toBe(201)
    })

    test('input is validated and unique things stay unique', async () => {
      const t = biz.token
      const post = (body: Record<string, unknown>) => s.call('POST', '/users', { token: t, body })
      expect((await post({ name: 'No pin', role: 'cashier' })).status).toBe(400)
      expect((await post({ name: 'Bad pin', role: 'cashier', pin: '12' })).status).toBe(400)
      expect((await post({ name: 'Bad pin', role: 'cashier', pin: 'abcd' })).status).toBe(400)
      expect((await post({ role: 'cashier', pin: '1234' })).status).toBe(400)
      expect((await post({ name: 'x', role: 'superuser', pin: '1234' })).status).toBe(400)
      expect((await post({ name: 'x', role: 'cashier', pin: '1234', email: 'nope' })).status).toBe(400)
      expect((await post({ name: 'x', role: 'cashier', pin: '1234', email: 'y@example.test', password: 'short' })).status).toBe(400)
      expect((await post({ name: 'x', role: 'cashier', pin: '1234', id: 'has space' })).status).toBe(400)
      const dupMail = await post({ name: 'Dup', role: 'cashier', pin: '1234', email: 'ravi@example.test' })
      expect([dupMail.status, dupMail.json.code]).toEqual([409, 'email_taken'])
      const dupCode = await post({ name: 'Dup', role: 'cashier', pin: '1234', code: '07' })
      expect([dupCode.status, dupCode.json.code]).toEqual([409, 'code_taken'])
      expect((await post({ name: 'Ghost role', role: 'cashier', pin: '1234', roleId: 'role_nope' })).status).toBe(422)
      expect((await post({ name: 'Ghost branch', role: 'cashier', pin: '1234', branches: ['br_nope'] })).status).toBe(422)
    })

    test('only people with the settings permission manage staff; only an owner touches an owner', async () => {
      const cashier = await addStaff(s, biz, 'cashier', 'Plain')
      const manager = await addStaff(s, biz, 'manager', 'Mgr')
      for (const tok of [cashier.token, manager.token]) {
        expect((await s.call('GET', '/users', { token: tok })).status).toBe(403)
        expect((await s.call('POST', '/users', { token: tok, body: { name: 'x', role: 'cashier', pin: '1234' } })).status).toBe(403)
        expect((await s.call('PUT', `/users/${biz.userId}`, { token: tok, body: { name: 'x' } })).status).toBe(403)
      }
      // a custom role carrying "settings" can manage staff, but still not the owner
      const role = await s.call('POST', '/roles', { token: biz.token, body: { name: 'HR', permissions: ['settings'] } })
      const hr = await addStaff(s, biz, 'manager', 'HR person', { roleId: role.json.id })
      expect((await s.call('POST', '/users', { token: hr.token, body: { name: 'New cashier', role: 'cashier', pin: '1234' } })).status).toBe(201)
      expect((await s.call('POST', '/users', { token: hr.token, body: { name: 'New owner', role: 'owner', pin: '1234' } })).status).toBe(403)
      expect((await s.call('PUT', `/users/${biz.userId}`, { token: hr.token, body: { name: 'Mine now' } })).status).toBe(403)
      expect((await s.call('PUT', `/users/${manager.id}`, { token: hr.token, body: { role: 'owner' } })).status).toBe(403)
    })

    test('editing a person updates their record on every device; a change of role applies at once', async () => {
      const p = await addStaff(s, biz, 'cashier', 'Edit me')
      const before = await pull(s, biz.token, 0)
      const put = await s.call('PUT', `/users/${p.id}`, { token: biz.token, body: { name: 'Edited', role: 'manager', code: '55' } })
      expect(put.status).toBe(200)
      const delta = await pull(s, biz.token, before.json.cursor)
      expect(delta.json.upserts.map((u: { coll: string; id: string; data: unknown }) => [u.coll, u.id, u.data])).toEqual([['users', p.id, { id: p.id, name: 'Edited', role: 'manager', active: true, code: '55' }]])
      expect((await s.call('GET', '/auth/me', { token: p.token })).json.role).toBe('manager')
      expect((await s.call('PUT', `/users/nobody`, { token: biz.token, body: { name: 'x' } })).status).toBe(404)
      // setting a staff number to nothing clears it
      await s.call('PUT', `/users/${p.id}`, { token: biz.token, body: { code: null } })
      expect((await usersDocs(biz)).get(p.id).code).toBeUndefined()
    })

    test('the business always keeps an active owner; you cannot remove yourself; a removed person is out at once', async () => {
      const t = biz.token
      const demote = await s.call('PUT', `/users/${biz.userId}`, { token: t, body: { role: 'manager' } })
      expect([demote.status, demote.json.code]).toEqual([422, 'last_owner'])
      const off = await s.call('PUT', `/users/${biz.userId}`, { token: t, body: { active: false } })
      expect([off.status, off.json.code]).toEqual([422, 'last_owner'])
      expect((await s.call('DELETE', `/users/${biz.userId}`, { token: t })).json.code).toBe('self')
      // with a second owner, the first may step down
      const second = await s.call('POST', '/users', { token: t, body: { name: 'Co-owner', role: 'owner', pin: '1111', email: 'co@example.test', password: 'co-owner-pass' } })
      expect(second.status).toBe(201)
      const co = await s.call('POST', '/auth/login', { body: { email: 'co@example.test', password: 'co-owner-pass', deviceId: 'co-dev' } })
      expect((await s.call('PUT', `/users/${biz.userId}`, { token: co.json.token, body: { role: 'manager' } })).status).toBe(200)
      expect((await s.call('GET', '/auth/me', { token: t })).json.role).toBe('manager')
      // and now the co-owner is the last one
      expect((await s.call('DELETE', `/users/${second.json.id}`, { token: co.json.token })).json.code).toBe('self')
      const staff = await addStaff(s, { ...biz, token: co.json.token }, 'cashier', 'Leaver')
      expect((await s.call('DELETE', `/users/${staff.id}`, { token: co.json.token })).status).toBe(200)
      expect((await s.call('GET', '/auth/me', { token: staff.token })).status).toBe(401)
      expect((await usersDocs({ ...biz, token: co.json.token })).get(staff.id).active).toBe(false) // their sales keep their author
      const staffList = await s.call('GET', `/auth/staff?orgId=${biz.orgId}`)
      expect(staffList.json.map((u: { id: string }) => u.id)).not.toContain(staff.id)
    })
  })

  describe('roles', () => {
    let biz: Biz
    beforeAll(async () => { biz = await signup(s, 'Role Shop') })

    test('owners define roles from known permissions', async () => {
      const t = biz.token
      const mk = await s.call('POST', '/roles', { token: t, body: { name: 'Auditor', permissions: ['reports', 'viewProfit'] } })
      expect(mk.status).toBe(201)
      expect(mk.json).toMatchObject({ name: 'Auditor', permissions: ['reports', 'viewProfit'] })
      expect((await s.call('POST', '/roles', { token: t, body: { name: 'Auditor', permissions: [] } })).status).toBe(409)
      expect((await s.call('POST', '/roles', { token: t, body: { name: 'Bad', permissions: ['launch-missiles'] } })).json.code).toBe('unknown_permission')
      expect((await s.call('POST', '/roles', { token: t, body: { permissions: [] } })).status).toBe(400)
      // a module's permission is known too
      expect((await s.call('POST', '/roles', { token: t, body: { name: 'Books', permissions: ['accounting'] } })).status).toBe(201)
      const put = await s.call('PUT', `/roles/${mk.json.id}`, { token: t, body: { name: 'Senior auditor' } })
      expect(put.json).toMatchObject({ name: 'Senior auditor', permissions: ['reports', 'viewProfit'] })
      expect((await s.call('PUT', `/roles/${mk.json.id}`, { token: t, body: { permissions: ['nope'] } })).status).toBe(422)
      expect((await s.call('PUT', '/roles/missing', { token: t, body: { name: 'x' } })).status).toBe(404)
      expect((await s.call('GET', '/roles', { token: t })).json.map((r: { name: string }) => r.name)).toEqual(['Books', 'Senior auditor'])
    })

    test('a role in use cannot be deleted; an unused one can; only the owner manages roles', async () => {
      const t = biz.token
      const role = await s.call('POST', '/roles', { token: t, body: { name: 'Temp', permissions: ['pos'] } })
      const person = await addStaff(s, biz, 'cashier', 'Has role', { roleId: role.json.id })
      const del = await s.call('DELETE', `/roles/${role.json.id}`, { token: t })
      expect([del.status, del.json.code]).toEqual([409, 'role_in_use'])
      await s.call('PUT', `/users/${person.id}`, { token: t, body: { roleId: null } })
      expect((await s.call('DELETE', `/roles/${role.json.id}`, { token: t })).status).toBe(200)
      expect((await s.call('DELETE', `/roles/${role.json.id}`, { token: t })).status).toBe(404)
      const manager = await addStaff(s, biz, 'manager', 'Mgr')
      expect((await s.call('GET', '/roles', { token: manager.token })).status).toBe(403)
      expect((await s.call('POST', '/roles', { token: manager.token, body: { name: 'x', permissions: [] } })).status).toBe(403)
    })
  })

  describe('branches and the business', () => {
    let biz: Biz
    beforeAll(async () => { biz = await signup(s, 'Branch Shop') })

    test('outlets: owner adds and edits; the main one cannot be switched off', async () => {
      const t = biz.token
      const mk = await s.call('POST', '/branches', { token: t, body: { name: 'Hinjewadi', code: 'HJ', address: 'Phase 1', phone: '020' } })
      expect(mk.status).toBe(201)
      expect(mk.json).toMatchObject({ name: 'Hinjewadi', code: 'HJ', active: true, isDefault: false })
      const put = await s.call('PUT', `/branches/${mk.json.id}`, { token: t, body: { name: 'Hinjewadi 2', active: false } })
      expect(put.json).toMatchObject({ name: 'Hinjewadi 2', active: false, code: 'HJ', address: 'Phase 1' })
      const main = await s.call('PUT', `/branches/${biz.branchId}`, { token: t, body: { active: false } })
      expect([main.status, main.json.code]).toEqual([422, 'default_branch'])
      expect((await s.call('PUT', `/branches/${biz.branchId}`, { token: t, body: { name: 'Head office' } })).json.name).toBe('Head office')
      expect((await s.call('GET', '/branches', { token: t })).json.map((b: { name: string }) => b.name)).toEqual(['Head office', 'Hinjewadi 2'])
      expect((await s.call('POST', '/branches', { token: t, body: {} })).status).toBe(400)
      const cashier = await addStaff(s, biz, 'cashier', 'Till')
      expect((await s.call('POST', '/branches', { token: cashier.token, body: { name: 'x' } })).status).toBe(403)
      expect((await s.call('PUT', `/branches/${mk.json.id}`, { token: cashier.token, body: { name: 'x' } })).status).toBe(403)
      expect((await s.call('GET', '/branches', { token: cashier.token })).status).toBe(200)
    })

    test('limiting a person to branches', async () => {
      const t = biz.token
      const annex = await s.call('POST', '/branches', { token: t, body: { name: 'Annex' } })
      expect(annex.status).toBe(201)
      const limited = await s.call('POST', '/users', { token: t, body: { name: 'Annex only', role: 'cashier', pin: '2222', branches: [annex.json.id] } })
      const login = await s.call('POST', '/auth/pin-login', { body: { orgId: biz.orgId, userId: limited.json.id, pin: '2222', deviceId: 'annex' } })
      expect(login.json.branches.map((b: { id: string }) => b.id)).toEqual([annex.json.id])
      expect((await s.call('GET', '/branches', { token: login.json.token })).json).toHaveLength(1)
      // clearing the list gives every branch back
      await s.call('PUT', `/users/${limited.json.id}`, { token: t, body: { branches: null } })
      expect((await s.call('GET', '/branches', { token: login.json.token })).json.length).toBeGreaterThan(1)
    })

    test('the business profile: anyone reads, the owner edits', async () => {
      const t = biz.token
      const cashier = await addStaff(s, biz, 'cashier', 'Reader')
      expect((await s.call('GET', '/org', { token: cashier.token })).json).toMatchObject({ id: biz.orgId, name: 'Branch Shop', plan: 'free' })
      const put = await s.call('PUT', '/org', { token: t, body: { name: 'Branch Shop Pvt', industry: 'apparel', plan: 'pro', profile: { gstin: '27ABCDE1234F1Z5' } } })
      expect(put.json).toMatchObject({ name: 'Branch Shop Pvt', industry: 'apparel', plan: 'pro', profile: { gstin: '27ABCDE1234F1Z5' } })
      expect((await s.call('PUT', '/org', { token: t, body: { name: 'Only name' } })).json).toMatchObject({ name: 'Only name', industry: 'apparel', profile: { gstin: '27ABCDE1234F1Z5' } })
      expect((await s.call('PUT', '/org', { token: t, body: { profile: [] } })).status).toBe(400)
      expect((await s.call('PUT', '/org', { token: t, body: { profile: { big: 'x'.repeat(20000) } } })).status).toBe(400)
      expect((await s.call('PUT', '/org', { token: t, body: { name: '' } })).status).toBe(400)
      expect((await s.call('PUT', '/org', { token: cashier.token, body: { name: 'Mine' } })).status).toBe(403)
      expect((await s.call('GET', '/auth/me', { token: t })).json.org.name).toBe('Only name')
    })
  })

  describe('devices', () => {
    let biz: Biz
    beforeAll(async () => { biz = await signup(s, 'Device Shop') })

    test('a removed device stops working at once, cannot sign back in, and the owner sees every device', async () => {
      const staff = await addStaff(s, biz, 'cashier', 'Till')
      expect((await s.call('GET', '/auth/me', { token: staff.token })).status).toBe(200) // warms the resolver's cache
      const list = await s.call('GET', '/devices', { token: biz.token })
      expect(list.json.map((d: { id: string }) => d.id).sort()).toEqual([biz.deviceId, staff.deviceId].sort())
      expect(list.json.find((d: { id: string }) => d.id === biz.deviceId).current).toBe(true)
      // the person sees only their own
      expect((await s.call('GET', '/devices', { token: staff.token })).json.map((d: { id: string }) => d.id)).toEqual([staff.deviceId])

      expect((await s.call('DELETE', `/devices/${staff.deviceId}`, { token: biz.token })).status).toBe(200)
      expect((await s.call('GET', '/auth/me', { token: staff.token })).status).toBe(401)
      expect((await pull(s, staff.token, 0)).status).toBe(401)
      const back = await s.call('POST', '/auth/pin-login', { body: { orgId: biz.orgId, userId: staff.id, pin: '4321', deviceId: staff.deviceId } })
      expect([back.status, back.json.code]).toEqual([403, 'device_revoked'])
      // the same person on a new device is fine
      expect((await s.call('POST', '/auth/pin-login', { body: { orgId: biz.orgId, userId: staff.id, pin: '4321', deviceId: 'a-new-till' } })).status).toBe(200)
      expect((await s.call('DELETE', '/devices/unknown', { token: biz.token })).status).toBe(404)
    })

    test('a person can remove their own device but not someone else’s', async () => {
      const a = await addStaff(s, biz, 'cashier', 'A')
      const b = await addStaff(s, biz, 'cashier', 'B')
      expect((await s.call('DELETE', `/devices/${b.deviceId}`, { token: a.token })).status).toBe(403)
      expect((await s.call('GET', '/auth/me', { token: b.token })).status).toBe(200)
      expect((await s.call('DELETE', `/devices/${a.deviceId}`, { token: a.token })).status).toBe(200)
      expect((await s.call('GET', '/auth/me', { token: a.token })).status).toBe(401)
    })

    test('push tokens are stored for the calling device', async () => {
      const t = biz.token
      expect((await s.call('POST', '/devices/push-token', { token: t, body: { token: 'ExponentPushToken[abc]', platform: 'android' } })).status).toBe(200)
      const row = await s.pool.query('SELECT push_token, platform FROM devices WHERE org_id = $1 AND id = $2', [biz.orgId, biz.deviceId])
      expect(row.rows[0]).toEqual({ push_token: 'ExponentPushToken[abc]', platform: 'android' })
      expect((await s.call('POST', '/devices/push-token', { token: t, body: {} })).status).toBe(400)
      expect((await s.call('POST', '/devices/push-token', { body: { token: 'x' } })).status).toBe(401)
      // removing the device forgets its push token
      const staff = await addStaff(s, biz, 'cashier', 'Pushy')
      await s.call('POST', '/devices/push-token', { token: staff.token, body: { token: 'tok-2', platform: 'ios' } })
      await s.call('DELETE', `/devices/${staff.deviceId}`, { token: biz.token })
      expect((await s.pool.query('SELECT push_token FROM devices WHERE org_id = $1 AND id = $2', [biz.orgId, staff.deviceId])).rows[0].push_token).toBeNull()
    })

    test('refresh issues a working token; logout ends only that device’s sessions', async () => {
      const second = await s.call('POST', '/auth/login', { body: { email: biz.email, password: 'correct horse battery', deviceId: 'second', deviceName: 'Second' } })
      const fresh = await s.call('POST', '/auth/refresh', { token: second.json.token })
      expect((await s.call('GET', '/auth/me', { token: fresh.json.token })).status).toBe(200)
      await s.call('POST', '/auth/logout', { token: second.json.token })
      expect((await s.call('GET', '/auth/me', { token: second.json.token })).status).toBe(401)
      expect((await s.call('GET', '/auth/me', { token: fresh.json.token })).status).toBe(401) // same device, same session generation
      expect((await s.call('GET', '/auth/me', { token: biz.token })).status).toBe(200) // another device is untouched
      // signing in again on that device works
      const again = await s.call('POST', '/auth/login', { body: { email: biz.email, password: 'correct horse battery', deviceId: 'second', deviceName: 'Second' } })
      expect((await s.call('GET', '/auth/me', { token: again.json.token })).status).toBe(200)
    })
  })

  describe('API keys', () => {
    let biz: Biz
    beforeAll(async () => { biz = await signup(s, 'Key Shop') })

    test('a key is shown once, then only its description', async () => {
      const mk = await s.call('POST', '/api-keys', { token: biz.token, body: { name: 'Website', permissions: ['pos', 'customers'] } })
      expect(mk.status).toBe(201)
      expect(mk.json.key).toMatch(/^kosh_[0-9a-f]{16}_[0-9a-f]{48}$/)
      const list = await s.call('GET', '/api-keys', { token: biz.token })
      expect(list.json).toHaveLength(1)
      expect(list.json[0]).toMatchObject({ id: mk.json.id, name: 'Website', permissions: ['pos', 'customers'], revoked: false })
      expect(list.body).not.toContain(mk.json.key)
      expect(list.body).not.toMatch(/secret|hash/i)
      const stored = await s.pool.query('SELECT secret_hash FROM api_keys WHERE id = $1', [mk.json.id])
      expect(mk.json.key).not.toContain(stored.rows[0].secret_hash)
      expect(stored.rows[0].secret_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    test('a key works as a bearer token with exactly the permissions it was given', async () => {
      const mk = await s.call('POST', '/api-keys', { token: biz.token, body: { name: 'Till feed', permissions: ['pos', 'customers'] } })
      const key = mk.json.key as string
      const me = await s.call('GET', '/auth/me', { token: key })
      expect(me.json).toMatchObject({ user: null, key: { id: mk.json.id, name: 'Till feed' }, permissions: ['customers', 'pos'] })
      const r = await push(s, key, [
        mut('customers', 'c_key', 'create', { id: 'c_key', name: 'From the website', loyaltyPoints: 0, storeCredit: 0 }),
        mut('bills', 'b_key', 'create', billDoc('b_key')),
        mut('products', 'p_key', 'create', { id: 'p_key', name: 'Not allowed' }),
      ])
      expect(r.json.results.map((x: { status: string; code?: string }) => x.code ?? x.status)).toEqual(['ok', 'ok', 'forbidden'])
      // it reads what its permissions allow
      const pulled = await pull(s, key, 0)
      const colls = new Set(pulled.json.upserts.map((u: { coll: string }) => u.coll))
      expect(colls.has('bills') && colls.has('customers')).toBe(true)
      expect(colls.has('expenses')).toBe(false)
      // but not the owner’s tools
      for (const [m, p] of [['GET', '/users'], ['GET', '/roles'], ['GET', '/api-keys'], ['GET', '/backup'], ['GET', '/devices'], ['POST', '/auth/refresh']] as const) {
        const x = await s.call(m, p, { token: key })
        expect([p, x.status === 403 || x.status === 200]).toEqual([p, true])
        if (p !== '/devices') expect([p, x.status]).toEqual([p, 403])
      }
      expect((await s.call('POST', '/devices/push-token', { token: key, body: { token: 'x' } })).status).toBe(403)
      expect((await s.call('POST', '/api-keys', { token: key, body: { name: 'child', permissions: ['pos'] } })).status).toBe(403)
    })

    test('revoking a key ends it at once; bad, truncated and altered keys never work', async () => {
      const mk = await s.call('POST', '/api-keys', { token: biz.token, body: { name: 'Temp', permissions: ['pos'] } })
      const key = mk.json.key as string
      expect((await s.call('GET', '/auth/me', { token: key })).status).toBe(200)
      // the first 8 secret characters are right, the rest is not: a cached success must not answer for it
      const forged = key.slice(0, key.length - 40) + '0'.repeat(40)
      expect((await s.call('GET', '/auth/me', { token: forged })).status).toBe(401)
      expect((await s.call('GET', '/auth/me', { token: key.slice(0, -1) })).status).toBe(401)
      expect((await s.call('GET', '/auth/me', { token: 'kosh_0000000000000000_' + '1'.repeat(48) })).status).toBe(401)
      expect((await s.call('DELETE', `/api-keys/${mk.json.id}`, { token: biz.token })).status).toBe(200)
      expect((await s.call('GET', '/auth/me', { token: key })).status).toBe(401)
      expect((await s.call('GET', '/api-keys', { token: biz.token })).json.find((k: { id: string }) => k.id === mk.json.id).revoked).toBe(true)
      expect((await s.call('DELETE', '/api-keys/nothing', { token: biz.token })).status).toBeGreaterThanOrEqual(400)
    })

    test('keys can expire; permissions must be real; only the owner issues keys', async () => {
      const t = biz.token
      expect((await s.call('POST', '/api-keys', { token: t, body: { name: 'Past', permissions: [], expiresAt: Date.now() - 1000 } })).status).toBe(400)
      expect((await s.call('POST', '/api-keys', { token: t, body: { name: 'Nope', permissions: ['everything'] } })).json.code).toBe('unknown_permission')
      expect((await s.call('POST', '/api-keys', { token: t, body: { permissions: [] } })).status).toBe(400)
      const mk = await s.call('POST', '/api-keys', { token: t, body: { name: 'Short', permissions: ['pos'], expiresAt: Date.now() + 3_600_000 } })
      expect(mk.status).toBe(201)
      expect((await s.call('GET', '/auth/me', { token: mk.json.key })).status).toBe(200)
      await s.pool.query(`UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE id = $1`, [mk.json.id])
      s.app.ctx.principals.invalidate(biz.orgId)
      expect((await s.call('GET', '/auth/me', { token: mk.json.key })).status).toBe(401)
      const manager = await addStaff(s, biz, 'manager', 'Mgr')
      expect((await s.call('POST', '/api-keys', { token: manager.token, body: { name: 'x', permissions: [] } })).status).toBe(403)
      expect((await s.call('GET', '/api-keys', { token: manager.token })).status).toBe(403)
    })
  })
})

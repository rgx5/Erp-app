import { addStaff, maybe, pgAvailable, signup, startServer, type TestServer } from './helpers'

jest.setTimeout(60_000)

maybe('auth', pgAvailable(), () => {
  let s: TestServer
  beforeAll(async () => { s = await startServer('auth') })
  afterAll(async () => { await s.close() })

  test('health says what kind of server this is', async () => {
    const r = await s.call('GET', '/health')
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ app: 'kosh-server', ok: true })
  })

  test('signing up creates the business, its main branch and the owner — and the owner as a document', async () => {
    const r = await s.call('POST', '/auth/signup', { body: { orgName: 'Sharma Traders', ownerName: 'Asha', email: 'Asha@Example.test', password: 'correct horse', pin: '1234', deviceId: 'phone-1', deviceName: 'Pixel', industry: 'apparel' } })
    expect(r.status).toBe(201)
    expect(r.json.user).toMatchObject({ name: 'Asha', role: 'owner', email: 'asha@example.test' })
    expect(r.json.org).toMatchObject({ name: 'Sharma Traders', industry: 'apparel', plan: 'free' })
    expect(r.json.branch.name).toBe('Main')
    const pulled = await s.call('GET', '/sync/pull?since=0', { token: r.json.token })
    expect(pulled.json.upserts.map((u: { coll: string; id: string }) => `${u.coll}/${u.id}`)).toEqual([`users/${r.json.user.id}`])
  })

  test('a client may choose the owner id (a business moved off a phone keeps the ids its bills refer to)', async () => {
    const r = await s.call('POST', '/auth/signup', { body: { orgName: 'Moved', ownerName: 'Ravi', email: 'ravi@example.test', password: 'long enough', deviceId: 'd', ownerId: 'usr_from_the_phone' } })
    expect(r.status).toBe(201)
    expect(r.json.user.id).toBe('usr_from_the_phone')
    const bad = await s.call('POST', '/auth/signup', { body: { orgName: 'X', ownerName: 'Y', email: 'y@example.test', password: 'long enough', deviceId: 'd', ownerId: 'no spaces allowed' } })
    expect(bad.status).toBe(400)
  })

  test('the same user id may exist in two businesses (ids are per business)', async () => {
    const a = await s.call('POST', '/auth/signup', { body: { orgName: 'A', ownerName: 'A', email: 'a1@example.test', password: 'long enough', deviceId: 'd', ownerId: 'usr_same' } })
    const b = await s.call('POST', '/auth/signup', { body: { orgName: 'B', ownerName: 'B', email: 'b1@example.test', password: 'long enough', deviceId: 'd', ownerId: 'usr_same' } })
    expect([a.status, b.status]).toEqual([201, 201])
    expect(a.json.org.id).not.toBe(b.json.org.id)
  })

  test('sign-up is validated and an email is used once', async () => {
    const base = { orgName: 'V', ownerName: 'V', email: 'v@example.test', password: 'long enough', deviceId: 'd' }
    expect((await s.call('POST', '/auth/signup', { body: { ...base, orgName: '' } })).status).toBe(400)
    expect((await s.call('POST', '/auth/signup', { body: { ...base, email: 'nope' } })).status).toBe(400)
    expect((await s.call('POST', '/auth/signup', { body: { ...base, password: 'short' } })).status).toBe(400)
    expect((await s.call('POST', '/auth/signup', { body: { ...base, pin: '12' } })).status).toBe(400)
    expect((await s.call('POST', '/auth/signup', { body: { ...base, deviceId: undefined } })).status).toBe(400)
    expect((await s.call('POST', '/auth/signup', { body: base })).status).toBe(201)
    const dup = await s.call('POST', '/auth/signup', { body: { ...base, orgName: 'Again', email: 'V@example.test' } })
    expect(dup.status).toBe(409)
    expect(dup.json.code).toBe('email_taken')
  })

  test('sign-up can be switched off', async () => {
    const closed = await startServer('closed', { allowSignup: false })
    try {
      const r = await closed.call('POST', '/auth/signup', { body: { orgName: 'X', ownerName: 'Y', email: 'z@example.test', password: 'long enough', deviceId: 'd' } })
      expect(r.status).toBe(403)
      expect(r.json.code).toBe('signup_closed')
    } finally { await closed.close() }
  })

  test('password login: right password works, wrong one is a generic 401, unknown email looks the same', async () => {
    const biz = await signup(s, 'Login Shop')
    const ok = await s.call('POST', '/auth/login', { body: { email: biz.email, password: 'correct horse battery', deviceId: 'second-phone', deviceName: 'Second' } })
    expect(ok.status).toBe(200)
    expect(ok.json.user.id).toBe(biz.userId)
    expect(ok.json.branches).toHaveLength(1)
    const wrong = await s.call('POST', '/auth/login', { body: { email: biz.email, password: 'wrong', deviceId: 'x' } })
    const ghost = await s.call('POST', '/auth/login', { body: { email: 'nobody@example.test', password: 'wrong', deviceId: 'x' } })
    expect(wrong.status).toBe(401)
    expect(ghost.status).toBe(401)
    expect(wrong.json).toEqual(ghost.json)
  })

  test('repeated wrong passwords lock that email + address out (429 with Retry-After), a correct one clears it later', async () => {
    const biz = await signup(s, 'Lock Shop')
    const body = { email: biz.email, password: 'nope', deviceId: 'x' }
    for (let i = 0; i < 5; i++) expect((await s.call('POST', '/auth/login', { body, ip: '9.9.9.9' })).status).toBe(401)
    const locked = await s.call('POST', '/auth/login', { body, ip: '9.9.9.9' })
    expect(locked.status).toBe(429)
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0)
    // even the right password waits out the lock …
    expect((await s.call('POST', '/auth/login', { body: { ...body, password: 'correct horse battery' }, ip: '9.9.9.9' })).status).toBe(429)
    // … but another address is unaffected
    expect((await s.call('POST', '/auth/login', { body: { ...body, password: 'correct horse battery' }, ip: '8.8.8.8' })).status).toBe(200)
  })

  test('PIN login at the counter, with an escalating lockout per person', async () => {
    const biz = await signup(s, 'Pin Shop')
    const staff = await addStaff(s, biz, 'cashier', 'Ravi')
    const list = await s.call('GET', `/auth/staff?orgId=${biz.orgId}`)
    expect(list.status).toBe(200)
    expect(list.json.map((u: { name: string }) => u.name)).toEqual(expect.arrayContaining(['Ravi']))
    expect(JSON.stringify(list.json)).not.toMatch(/hash|pin"|password/i)

    const bad = (pin: string) => s.call('POST', '/auth/pin-login', { body: { orgId: biz.orgId, userId: staff.id, pin, deviceId: 'till-2' } })
    for (let i = 0; i < 5; i++) expect((await bad('0000')).status).toBe(401)
    const locked = await bad('4321')
    expect(locked.status).toBe(429)
    expect(locked.json.retryAfter).toBeGreaterThan(0)
    // the owner resets the PIN, which also lifts the lock
    const reset = await s.call('POST', `/users/${staff.id}/pin`, { token: biz.token, body: { pin: '5555' } })
    expect(reset.status).toBe(200)
    expect((await bad('5555')).status).toBe(200)
  })

  test('a PIN login names the business: a user id from another business does not work', async () => {
    const a = await signup(s, 'PA')
    const b = await signup(s, 'PB')
    const staffA = await addStaff(s, a, 'cashier')
    const r = await s.call('POST', '/auth/pin-login', { body: { orgId: b.orgId, userId: staffA.id, pin: '4321', deviceId: 'd' } })
    expect(r.status).toBe(401)
  })

  test('refresh gives a working token; me reports the role and the permissions the server resolved', async () => {
    const biz = await signup(s, 'Me Shop')
    const staff = await addStaff(s, biz, 'cashier')
    const fresh = await s.call('POST', '/auth/refresh', { token: staff.token })
    expect(fresh.status).toBe(200)
    const me = await s.call('GET', '/auth/me', { token: fresh.json.token })
    expect(me.json.role).toBe('cashier')
    expect(me.json.permissions).toEqual(expect.arrayContaining(['customers', 'pos']))
    expect(me.json.permissions).not.toContain('settings')
    const owner = await s.call('GET', '/auth/me', { token: biz.token })
    expect(owner.json.permissions).toEqual(expect.arrayContaining(['pos', 'settings', 'viewProfit']))
  })

  test('requests without a good token are refused', async () => {
    expect((await s.call('GET', '/auth/me')).status).toBe(401)
    expect((await s.call('GET', '/auth/me', { token: 'garbage' })).status).toBe(401)
    expect((await s.call('GET', '/sync/pull')).status).toBe(401)
  })

  test('logout ends this device’s tokens', async () => {
    const biz = await signup(s, 'Out Shop')
    expect((await s.call('POST', '/auth/logout', { token: biz.token })).status).toBe(200)
    expect((await s.call('GET', '/auth/me', { token: biz.token })).status).toBe(401)
  })

  test('changing a password ends older sessions; a deactivated person cannot sign in or use a token', async () => {
    const biz = await signup(s, 'Pw Shop')
    const staff = await addStaff(s, biz, 'manager', 'Meera', { email: 'meera@example.test', password: 'meera-password' })
    expect((await s.call('GET', '/auth/me', { token: staff.token })).status).toBe(200)
    await s.call('PUT', `/users/${staff.id}`, { token: biz.token, body: { password: 'brand-new-password' } })
    expect((await s.call('GET', '/auth/me', { token: staff.token })).status).toBe(401)
    expect((await s.call('POST', '/auth/login', { body: { email: 'meera@example.test', password: 'brand-new-password', deviceId: 'n' } })).status).toBe(200)
    await s.call('DELETE', `/users/${staff.id}`, { token: biz.token })
    expect((await s.call('POST', '/auth/login', { body: { email: 'meera@example.test', password: 'brand-new-password', deviceId: 'n' } })).status).toBe(401)
  })

  test('CORS answers only for configured origins; responses carry defensive headers', async () => {
    const ok = await s.call('GET', '/health', { headers: { origin: 'http://app.test' } })
    expect(ok.headers['access-control-allow-origin']).toBe('http://app.test')
    const other = await s.call('GET', '/health', { headers: { origin: 'http://evil.test' } })
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
    const pre = await s.app.inject({ method: 'OPTIONS', url: '/sync/push', headers: { origin: 'http://app.test', 'access-control-request-method': 'POST' } })
    expect(pre.statusCode).toBe(204)
    expect(ok.headers['x-content-type-options']).toBe('nosniff')
    expect(ok.headers['cache-control']).toBe('no-store')
  })

  test('bad input never leaks internals', async () => {
    const r = await s.app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: '{not json' })
    expect(r.statusCode).toBe(400)
    expect(r.body).not.toMatch(/at |node_modules|Unexpected token/)
    expect((await s.call('GET', '/nothing-here')).status).toBe(404)
  })
})

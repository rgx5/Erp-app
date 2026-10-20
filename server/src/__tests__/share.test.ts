import { addStaff, billDoc, customerDoc, maybe, mut, pgAvailable, push, signup, startServer, variantDoc, type Biz, type TestServer } from './helpers'

jest.setTimeout(60_000)

const STORE = {
  id: 'store', name: 'Sharma <i>Traders</i>', tagline: 'Since 1990', address: '12 MG Road', city: 'Pune', phone: '9800000000', email: '', gstin: '', invoicePrefix: 'INV-', nextInvoiceNo: 5,
  slabs: [], priceIncludesTax: true, receiptWidth: '80mm', returnPolicy: '', footerNote: 'Thank you!', loyaltyEarnPct: 1, loyaltyRedeemValue: 1, maxCashierDiscountPct: 0, lowStockDefault: 0,
}

maybe('share links', pgAvailable(), () => {
  let s: TestServer
  let biz: Biz
  beforeAll(async () => {
    s = await startServer('share')
    biz = await signup(s, 'Share Shop')
    const r = await push(s, biz.token, [
      mut('settings', 'store', 'create', STORE),
      mut('variants', 'v1', 'create', variantDoc('v1', { stock: 5 })),
      mut('customers', 'c1', 'create', customerDoc('c1', { name: 'Meera <script>alert(1)</script>' })),
      mut('bills', 'b1', 'create', billDoc('b1', { no: 'INV-0001', customerId: 'c1', soldBy: biz.userId, items: [{ variantId: 'v1', productId: 'p1', name: 'Oxford <b>Shirt</b>', qty: 2, returnedQty: 0, price: 999, discountAmount: 0, lineTotal: 1998, size: 'M', color: 'Navy' }], total: 1998 })),
    ])
    expect(r.json.results.map((x: { status: string }) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
  })
  afterAll(async () => { await s.close() })

  test('a link opens the invoice as a web page, without signing in', async () => {
    const mk = await s.call('POST', '/share', { token: biz.token, body: { coll: 'bills', id: 'b1' } })
    expect(mk.status).toBe(201)
    expect(mk.json.url).toBe(`http://kosh.test/p/${mk.json.token}`)
    expect(mk.json.token).toMatch(/^[A-Za-z0-9_-]{30,}$/)
    const page = await s.call('GET', `/p/${mk.json.token}`)
    expect(page.status).toBe(200)
    expect(String(page.headers['content-type'])).toMatch(/^text\/html/)
    expect(page.body).toContain('INV-0001')
    expect(page.body).toContain('1,998')
    expect(page.body).toContain('Thank you!') // the business's own settings are used
    expect(page.body).toContain('Pune')
  })

  test('everything the page shows is escaped, and the browser is told not to run anything', async () => {
    const mk = await s.call('POST', '/share', { token: biz.token, body: { coll: 'bills', id: 'b1' } })
    const page = await s.call('GET', `/p/${mk.json.token}`)
    expect(page.body).not.toContain('<script>alert(1)</script>')
    expect(page.body).not.toContain('<i>Traders</i>')
    expect(page.body).not.toContain('<b>Shirt</b>')
    expect(page.body).toContain('&lt;script&gt;')
    const csp = String(page.headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toMatch(/script-src|unsafe-eval/)
    expect(page.headers['referrer-policy']).toBe('no-referrer')
    expect(String(page.headers['cache-control'])).toMatch(/no-store/)
  })

  test('without settings the page still renders, using the business name', async () => {
    const other = await signup(s, 'Plain Co')
    await push(s, other.token, [mut('bills', 'bx', 'create', billDoc('bx', { no: 'INV-9' }))])
    const mk = await s.call('POST', '/share', { token: other.token, body: { coll: 'bills', id: 'bx' } })
    const page = await s.call('GET', `/p/${mk.json.token}`)
    expect(page.status).toBe(200)
    expect(page.body).toContain('Plain Co')
    expect(page.body).toContain('INV-9')
  })

  test('only bills that exist can be shared', async () => {
    expect((await s.call('POST', '/share', { token: biz.token, body: { coll: 'customers', id: 'c1' } })).json.code).toBe('not_shareable')
    expect((await s.call('POST', '/share', { token: biz.token, body: { coll: 'bills', id: 'ghost' } })).status).toBe(404)
    expect((await s.call('POST', '/share', { token: biz.token, body: { coll: 'bills' } })).status).toBe(400)
    expect((await s.call('POST', '/share', { body: { coll: 'bills', id: 'b1' } })).status).toBe(401)
  })

  test('a link can expire, be revoked, or never have existed', async () => {
    const tmp = await s.call('POST', '/share', { token: biz.token, body: { coll: 'bills', id: 'b1', expiresInDays: 7 } })
    expect((await s.call('GET', `/p/${tmp.json.token}`)).status).toBe(200)
    await s.pool.query(`UPDATE share_tokens SET expires_at = now() - interval '1 minute' WHERE token = $1`, [tmp.json.token])
    expect((await s.call('GET', `/p/${tmp.json.token}`)).status).toBe(404)

    for (const bad of [0, -1, 'soon', 100000]) {
      expect((await s.call('POST', '/share', { token: biz.token, body: { coll: 'bills', id: 'b1', expiresInDays: bad } })).status).toBe(400)
    }

    const mk = await s.call('POST', '/share', { token: biz.token, body: { coll: 'bills', id: 'b1' } })
    expect((await s.call('DELETE', `/share/${mk.json.token}`, { token: biz.token })).status).toBe(200)
    expect((await s.call('GET', `/p/${mk.json.token}`)).status).toBe(404)
    expect((await s.call('DELETE', `/share/${mk.json.token}`, { token: biz.token })).status).toBe(404)

    expect((await s.call('GET', '/p/not-a-token')).status).toBe(404)
    expect((await s.call('GET', `/p/${'x'.repeat(70)}`)).status).toBe(404)
  })

  test('who may share: the counter, not a role without sales or customers', async () => {
    const cashier = await addStaff(s, biz, 'cashier', 'Counter')
    expect((await s.call('POST', '/share', { token: cashier.token, body: { coll: 'bills', id: 'b1' } })).status).toBe(201)
    const role = await s.call('POST', '/roles', { token: biz.token, body: { name: 'Stock only', permissions: ['stock'] } })
    const clerk = await addStaff(s, biz, 'cashier', 'Clerk', { roleId: role.json.id })
    expect((await s.call('POST', '/share', { token: clerk.token, body: { coll: 'bills', id: 'b1' } })).status).toBe(403)
  })
})

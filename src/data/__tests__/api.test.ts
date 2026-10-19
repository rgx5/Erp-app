import { createApi, normalizeApiUrl, tokenLifeMs } from '../api'

describe('normalizeApiUrl', () => {
  test('a bare host gets https and the /api prefix the server uses', () => {
    expect(normalizeApiUrl('billing.example.com')).toBe('https://billing.example.com/api')
    expect(normalizeApiUrl('  https://billing.example.com/  ')).toBe('https://billing.example.com/api')
    expect(normalizeApiUrl('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080/api')
  })
  test('a machine on the local network defaults to http (it has no certificate); everything else to https', () => {
    expect(normalizeApiUrl('192.168.1.20:8080')).toBe('http://192.168.1.20:8080/api')
    expect(normalizeApiUrl('localhost:8081')).toBe('http://localhost:8081/api')
    expect(normalizeApiUrl('shop-pc.local')).toBe('http://shop-pc.local/api')
    expect(normalizeApiUrl('172.20.0.5')).toBe('http://172.20.0.5/api')
    expect(normalizeApiUrl('172.40.0.5')).toBe('https://172.40.0.5/api')
    expect(normalizeApiUrl('billing.example.com:8443')).toBe('https://billing.example.com:8443/api')
    expect(normalizeApiUrl('localhost.example.com')).toBe('https://localhost.example.com/api')
  })
  test('an address that already has a path is left as typed', () => {
    expect(normalizeApiUrl('https://billing.example.com/api')).toBe('https://billing.example.com/api')
    expect(normalizeApiUrl('https://billing.example.com/api/')).toBe('https://billing.example.com/api')
    expect(normalizeApiUrl('https://example.com/shop/api')).toBe('https://example.com/shop/api')
  })
  test('empty stays empty', () => {
    expect(normalizeApiUrl('')).toBe('')
    expect(normalizeApiUrl('   ')).toBe('')
  })
})

describe('createApi', () => {
  const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })

  test('calls the right route with the bearer token', async () => {
    const seen: Array<{ url: string; auth?: string }> = []
    const api = createApi('https://x.test', () => 'tok', async (url, init) => {
      seen.push({ url, auth: (init?.headers as Record<string, string>).Authorization })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    await api.snapshot()
    expect(seen[0]).toEqual({ url: 'https://x.test/api/sync/snapshot', auth: 'Bearer tok' })
  })

  test('login does not send a token', async () => {
    let auth: string | undefined
    const api = createApi('https://x.test', () => 'tok', async (_u, init) => { auth = (init?.headers as Record<string, string>).Authorization; return new Response('{"token":"t"}') })
    await api.webLogin('a@b.in', 'pw')
    expect(auth).toBeUndefined()
  })

  test('server errors keep their message and status', async () => {
    const api = createApi('https://x.test', () => null, reply(401, { error: 'Invalid email or password' }))
    await expect(api.webLogin('a', 'b')).rejects.toMatchObject({ message: 'Invalid email or password', status: 401 })
  })

  test('an HTML error page from a proxy still gives a readable error', async () => {
    const api = createApi('https://x.test', () => null, async () => new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(api.health()).rejects.toMatchObject({ status: 502, message: 'Server error (502)' })
  })

  test('an unreachable server is status 0 with advice', async () => {
    const api = createApi('https://x.test', () => null, async () => { throw new TypeError('fetch failed') })
    await expect(api.health()).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Cannot reach the server/) })
  })
})

describe('tokenLifeMs', () => {
  const token = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`
  test('reads the expiry', () => {
    expect(tokenLifeMs(token(2000), 1_000_000)).toBe(1_000_000)
    expect(tokenLifeMs(token(1000), 2_000_000)).toBe(0)
  })
  test('anything unreadable counts as expired', () => {
    expect(tokenLifeMs(null)).toBe(0)
    expect(tokenLifeMs('garbage')).toBe(0)
  })
})

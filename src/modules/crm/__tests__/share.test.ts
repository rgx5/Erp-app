import { absoluteUrl, invoiceMessage, parseShare, requestShareLink, type ShareApi } from '../share'

const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response
const api = (res: Response | Error, calls: unknown[] = []): ShareApi => ({
  base: 'https://erp.example.com',
  raw: async (method, path, body) => { calls.push([method, path, body]); if (res instanceof Error) throw res; return res },
})

describe('shareable invoice links', () => {
  test('asks the server to share the bill and returns the public address', async () => {
    const calls: unknown[] = []
    const link = await requestShareLink(api(reply(200, { token: 'abc', url: '/p/abc' }), calls), 'bill_1')
    expect(calls).toEqual([['POST', '/share', { coll: 'bills', id: 'bill_1' }]])
    expect(link).toEqual({ token: 'abc', url: 'https://erp.example.com/p/abc' })
  })

  test('a full address from the server is kept; a missing one is built from the token', () => {
    expect(parseShare({ token: 't', url: 'https://x.io/p/t' }, 'https://erp.example.com').url).toBe('https://x.io/p/t')
    expect(parseShare({ token: 't' }, 'https://erp.example.com/').url).toBe('https://erp.example.com/p/t')
    expect(absoluteUrl('https://a.com/', 'p/x')).toBe('https://a.com/p/x')
  })

  test('says so in words when the server refuses or answers nonsense', async () => {
    await expect(requestShareLink(api(reply(403, { error: 'You cannot share that.' })), 'b')).rejects.toThrow('You cannot share that.')
    await expect(requestShareLink(api(reply(500, null)), 'b')).rejects.toThrow('500')
    await expect(requestShareLink(api(reply(200, {})), 'b')).rejects.toThrow('did not return a link')
    await expect(requestShareLink(api(new Error('Cannot reach the server')), 'b')).rejects.toThrow('Cannot reach')
  })

  test('the message names the shop, bill, date, total and link', () => {
    const text = invoiceMessage('Kosh Stores', { no: 'INV-0007', date: new Date('2026-10-19T10:00:00').getTime(), total: 1998 }, 'https://x/p/t', 'Dr. Meera Iyer')
    expect(text).toBe('Hello Meera, your invoice INV-0007 from Kosh Stores dated 19 Oct 2026 for ₹1,998 is ready. View it here: https://x/p/t')
    expect(invoiceMessage('Kosh', { no: 'A', date: 0, total: 5 }, 'u')).toMatch(/^Your invoice A/)
  })
})

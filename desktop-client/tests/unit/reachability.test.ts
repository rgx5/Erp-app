import { beforeEach, describe, expect, it } from 'vitest'
import { createApi } from '@/api/client'
import { useReachability } from '@/api/reachability'

const api = (status: number | 'throw') => createApi({ baseUrl: 'https://erp.example.com', getTokens: () => null, setTokens: () => undefined, fetch: async () => { if (status === 'throw') throw new TypeError('failed'); return new Response('{}', { status, headers: { 'content-type': 'application/json' } }) } })

describe('server reachability', () => {
  beforeEach(() => useReachability.setState({ down: false, since: null, checking: false }))
  it('is down when the network fails or a gateway says the server behind it is not running', async () => {
    await api('throw').raw.GET('/v1/meta' as never).catch(() => undefined)
    expect(useReachability.getState().down).toBe(true)
    useReachability.setState({ down: false, since: null })
    await api(502).raw.GET('/v1/meta' as never).catch(() => undefined)
    expect(useReachability.getState().down).toBe(true)
    await api(503).raw.GET('/v1/meta' as never).catch(() => undefined)
    expect(useReachability.getState().down).toBe(true)
  })
  it('clears as soon as the server answers, even with an ordinary error', async () => {
    useReachability.setState({ down: true, since: 1 })
    await api(404).raw.GET('/v1/meta' as never).catch(() => undefined)
    expect(useReachability.getState().down).toBe(false)
  })
})

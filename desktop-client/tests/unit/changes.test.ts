import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { eventData } from '@/api/changes'
import { applyFreshness, HEAVY_KEYS, REFERENCE_KEYS } from '@/api/freshness'

describe('server change notes', () => {
  it('reads complete events from a stream and leaves a half-received one for later', () => {
    const got: string[] = []; let rest = ''
    for (const ev of eventData('data: {"areas":["sales"]}\n\n: ping\n\ndata: {"areas":["items"]}\n\ndata: {"are')) { got.push(ev.data); rest = ev.rest }
    expect(got).toEqual(['{"areas":["sales"]}', '', '{"areas":["items"]}'])
    expect(rest).toBe('data: {"are')
  })
})

describe('how long each kind of data is trusted', () => {
  it('keeps reference data for ten minutes and never refetches big reports just for focus', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000 } } })
    applyFreshness(qc)
    for (const k of REFERENCE_KEYS) expect(qc.getQueryDefaults([k, 'x']).staleTime, k).toBe(600_000)
    for (const k of HEAVY_KEYS) expect(qc.getQueryDefaults([k]).refetchOnWindowFocus, k).toBe(false)
    expect(qc.getQueryDefaults(['invoices']).staleTime).toBeUndefined() // everything else keeps the default
  })
})

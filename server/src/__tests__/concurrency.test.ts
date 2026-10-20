import { maybe, moveDoc, mut, pgAvailable, pull, push, signup, startServer, variantDoc, type TestServer } from './helpers'

jest.setTimeout(120_000)

maybe('concurrent writers', pgAvailable(), () => {
  let s: TestServer
  beforeAll(async () => { s = await startServer('conc') })
  afterAll(async () => { await s.close() })

  test('many writers at once: no lost stock updates, unique revisions, and a polling device never misses a document', async () => {
    const biz = await signup(s, 'Busy Shop')
    const t = biz.token
    await push(s, t, [mut('variants', 'vhot', 'create', variantDoc('vhot', { stock: 0 }))])

    const WRITERS = 16, PER = 6
    // The polling device: keeps pulling with its own cursor while the writers run, exactly like the app's sync loop.
    const seen = new Map<string, number>() // coll/id -> highest rev seen
    let cursor = 0
    let stop = false
    let polls = 0
    const poller = (async () => {
      while (true) {
        const finishing = stop
        for (;;) {
          const page = await pull(s, t, cursor, 5)
          expect(page.status).toBe(200)
          polls++
          for (const u of [...page.json.upserts, ...page.json.deletes]) seen.set(`${u.coll}/${u.id}`, Math.max(seen.get(`${u.coll}/${u.id}`) ?? 0, u.rev))
          expect(page.json.cursor).toBeGreaterThanOrEqual(cursor)
          cursor = page.json.cursor
          if (!page.json.hasMore) break
        }
        if (finishing) return
      }
    })()

    const writers = Array.from({ length: WRITERS }, async (_, w) => {
      const batch = []
      for (let i = 0; i < PER; i++) {
        batch.push(mut('products', `p_${w}_${i}`, 'create', { id: `p_${w}_${i}`, name: `w${w}i${i}` }))
        batch.push(mut('moves', `m_${w}_${i}`, 'create', moveDoc(`m_${w}_${i}`, 'vhot', 1)))
      }
      const r = await push(s, t, batch)
      expect(r.status).toBe(200)
      expect(r.json.results.every((x: { status: string }) => x.status === 'ok')).toBe(true)
    })
    await Promise.all(writers)
    stop = true
    await poller
    expect(polls).toBeGreaterThan(3)

    // every +1 landed exactly once
    const all = await pull(s, t, 0, 2000)
    const final = new Map<string, { rev: number; data: any }>()
    for (const u of all.json.upserts) final.set(`${u.coll}/${u.id}`, u)
    expect(final.get('variants/vhot')!.data.stock).toBe(WRITERS * PER)
    expect(final.size).toBe(2 + 2 * WRITERS * PER) // the stock line, the owner's user document, then a product and a movement per write
    // the poller saw every document, at its final revision
    for (const [k, u] of final) expect(seen.get(k)).toBe(u.rev)
    // revisions are unique across the organisation's documents
    const revs = [...final.values()].map((u) => u.rev)
    expect(new Set(revs).size).toBe(revs.length)
    const q = await s.pool.query('SELECT count(*)::int AS n, count(DISTINCT rev)::int AS d, max(rev)::int AS m FROM docs WHERE org_id = $1', [biz.orgId])
    expect(q.rows[0].n).toBe(q.rows[0].d)
    const o = await s.pool.query('SELECT rev FROM orgs WHERE id = $1', [biz.orgId])
    expect(o.rows[0].rev).toBe(q.rows[0].m)
  })

  test('the same batch sent by two connections at the same moment is applied once', async () => {
    const biz = await signup(s, 'Retry Shop')
    const batch = [mut('variants', 'vr', 'create', variantDoc('vr', { stock: 0 }), 'r:1'), mut('moves', 'mr', 'create', moveDoc('mr', 'vr', 5), 'r:2')]
    const rs = await Promise.all([push(s, biz.token, batch), push(s, biz.token, batch), push(s, biz.token, batch)])
    const statuses = rs.flatMap((r) => r.json.results.map((x: { status: string }) => x.status))
    expect(statuses.filter((x: string) => x === 'ok')).toHaveLength(2)
    expect(statuses.filter((x: string) => x === 'duplicate')).toHaveLength(4)
    const pulled = await pull(s, biz.token, 0)
    expect(pulled.json.upserts.find((u: { id: string }) => u.id === 'vr').data.stock).toBe(5)
  })

  test('two businesses writing at the same time do not block or disturb each other', async () => {
    const [a, b] = await Promise.all([signup(s, 'Twin A'), signup(s, 'Twin B')])
    await Promise.all([a, b].map((x) => push(s, x.token, [mut('variants', 'v', 'create', variantDoc('v', { stock: 0 }))])))
    await Promise.all(Array.from({ length: 20 }, (_, i) => push(s, (i % 2 ? a : b).token, [mut('moves', `m${i}`, 'create', moveDoc(`m${i}`, 'v', 1))])))
    for (const x of [a, b]) {
      const r = await pull(s, x.token, 0)
      expect(r.json.upserts.find((u: { coll: string; id: string }) => u.coll === 'variants').data.stock).toBe(10)
    }
  })
})

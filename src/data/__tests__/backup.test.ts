import { backupCounts, backupToData, buildBackup, parseBackup } from '../backup'
import { emptyData } from '../state'
import { baseState } from './helpers'

const ws = { name: 'Test Store', industry: 'apparel', mode: 'local' as const }

describe('backup', () => {
  it('round-trips a business exactly', () => {
    const state = baseState()
    const text = JSON.stringify(buildBackup(state, ws, 123))
    const parsed = parseBackup(text)
    expect(parsed.exportedAt).toBe(123)
    expect(parsed.workspace).toEqual(ws)
    expect(backupToData(parsed)).toEqual(state)
    expect(backupCounts(parsed).items).toBe(Object.keys(state.products).length)
  })

  it('will not back up a business that does not exist yet', () => {
    expect(() => buildBackup(emptyData(), ws)).toThrow(/no business/i)
  })

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/)
    expect(() => parseBackup('[]')).toThrow(/not a OneSyncERP backup/)
    expect(() => parseBackup(JSON.stringify({ format: 'something-else' }))).toThrow(/not a OneSyncERP backup/)
  })

  it('rejects a backup from a newer app, a damaged one, and one nobody could sign in to', () => {
    const good = buildBackup(baseState(), ws)
    expect(() => parseBackup(JSON.stringify({ ...good, version: 99 }))).toThrow(/newer version/)
    expect(() => parseBackup(JSON.stringify({ ...good, data: { ...good.data, products: [{ name: 'no id' }] } }))).toThrow(/damaged \(products\)/)
    expect(() => parseBackup(JSON.stringify({ ...good, data: { ...good.data, users: good.data.users.map((u) => ({ ...u, active: false })) } }))).toThrow(/no active owner/)
  })

  it('fills collections an older backup did not have', () => {
    const good = buildBackup(baseState(), ws)
    const { sessions: _s, coupons: _c, ...rest } = good.data
    void _s; void _c
    const parsed = parseBackup(JSON.stringify({ ...good, data: rest }))
    expect(parsed.data.sessions).toEqual([])
    expect(backupToData(parsed).coupons).toEqual({})
  })
})

import type { Snapshot } from '../api'
import { snapshotToData } from '../snapshot'
import { optionFromWire, optionToWire, variantFromWire, variantToWire } from '../wire'
import { store, variant } from './helpers'

describe('wire shape of options', () => {
  test('empty becomes a dash and back again, exactly', () => {
    expect(optionToWire('')).toBe('-')
    expect(optionFromWire('-')).toBe('')
    for (const v of ['', 'M', 'Strip of 10', 'Free', 'Assorted']) expect(optionFromWire(optionToWire(v))).toBe(v)
  })

  test('only the fields that are present are touched', () => {
    expect(variantToWire({ price: 5 } as { size?: string; color?: string })).toEqual({ price: 5 })
    expect(variantToWire({ size: '', color: 'Red' })).toEqual({ size: '-', color: 'Red' })
  })

  test('a download turns the dashes back into nothing', () => {
    const snap = {
      serverTime: 1, store: store(), users: [], categories: [], products: [], customers: [], bills: [], suppliers: [], purchases: [], moves: [], expenses: [], sessions: [],
      variants: [variant({ id: 'a', size: '-', color: '-' }), variant({ id: 'b', size: 'M', color: 'Navy' })],
    } as unknown as Snapshot
    const d = snapshotToData(snap)
    expect(d.variants.a).toMatchObject({ size: '', color: '' })
    expect(d.variants.b).toMatchObject({ size: 'M', color: 'Navy' })
    expect(variantFromWire(variant({ size: '-' })).size).toBe('')
  })
})

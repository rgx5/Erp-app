import { describe, expect, it } from 'vitest'
import { ago, sourceLabel } from '@/features/leads/queries'

describe('leads helpers', () => {
  const now = Date.parse('2026-11-25T12:00:00Z')
  it('says how long ago in plain words', () => {
    expect(ago('2026-11-25T11:59:40Z', now)).toBe('just now'); expect(ago('2026-11-25T11:45:00Z', now)).toBe('15 min ago')
    expect(ago('2026-11-25T09:00:00Z', now)).toBe('3 h ago'); expect(ago('2026-11-22T12:00:00Z', now)).toBe('3 d ago')
  })
  it('names a source for a person', () => { expect(sourceLabel('meta')).toBe('Facebook / Instagram'); expect(sourceLabel('something')).toBe('something') })
})

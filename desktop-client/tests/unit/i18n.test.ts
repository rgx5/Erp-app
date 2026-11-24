import { describe, expect, it } from 'vitest'
import { NAV } from '@/ui/nav'
import { bilingual, DICTIONARIES, tr } from '@/i18n'

describe('languages', () => {
  const keys = Object.keys(DICTIONARIES.hi)
  it('every language translates exactly the same phrases, none blank', () => {
    for (const lang of ['mr', 'gu'] as const) expect(Object.keys(DICTIONARIES[lang]).sort(), lang).toEqual([...keys].sort())
    for (const lang of ['hi', 'mr', 'gu'] as const) for (const [k, v] of Object.entries(DICTIONARIES[lang])) { expect(v.trim(), `${lang}: ${k}`).not.toBe(''); expect(v, `${lang}: ${k} was left in English`).not.toBe(k === 'POS' || k === 'UPI' ? '__never__' : k) }
  })
  it('covers every page in the menu and every menu section', () => {
    const missing = [...new Set([...NAV.map((n) => n.label), ...NAV.flatMap((n) => (n.section ? [n.section] : []))])].filter((l) => !(l in DICTIONARIES.hi))
    expect(missing).toEqual([])
  })
  it('falls back to English, and prints documents in both languages', () => {
    expect(tr('hi', 'Dashboard')).toBe('डैशबोर्ड'); expect(tr('gu', 'Something untranslated')).toBe('Something untranslated'); expect(tr('en', 'Dashboard')).toBe('Dashboard')
    expect(bilingual('Tax Invoice', 'mr')).toBe('टॅक्स इनव्हॉइस / Tax Invoice'); expect(bilingual('Tax Invoice', 'en')).toBe('Tax Invoice')
  })
})

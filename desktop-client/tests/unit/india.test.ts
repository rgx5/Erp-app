import { describe, expect, it } from 'vitest'
import { financialYearStart, gstinCheckCharacter, isValidGstin, isValidPan, isValidPincode, normalizeGstin, panOfGstin, STATES, stateOfGstin } from '@/domain/india'

const make = (state: string, pan: string): string => { const f = `${state}${pan}1Z`; return f + gstinCheckCharacter(f) }

describe('GSTIN', () => {
  it('accepts a correct one and rejects a changed character, a bad state, a bad shape', () => {
    const good = make('27', 'ABCDE1234F')
    expect(good).toHaveLength(15)
    expect(isValidGstin(good)).toBe(true)
    expect(isValidGstin(good.slice(0, 14) + (good.endsWith('A') ? 'B' : 'A'))).toBe(false)
    expect(isValidGstin(make('25', 'ABCDE1234F'))).toBe(false) // 25 is not a state code
    expect(isValidGstin('27ABCDE1234F1Z')).toBe(false)
    expect(isValidGstin('')).toBe(false)
  })
  it('reads the state and PAN out of it, and tidies what was typed', () => {
    const g = make('29', 'KLMNO9012P')
    expect(stateOfGstin(g)).toBe('29')
    expect(panOfGstin(g)).toBe('KLMNO9012P')
    expect(normalizeGstin(` ${g.toLowerCase().slice(0, 7)} ${g.slice(7).toLowerCase()} `)).toBe(g)
  })
  it('has the statutory state list, without duplicates', () => {
    expect(STATES.find((s) => s.code === '27')?.name).toBe('Maharashtra')
    expect(new Set(STATES.map((s) => s.code)).size).toBe(STATES.length)
  })
})

describe('other identifiers and dates', () => {
  it('checks PAN and pincode shapes', () => {
    expect(isValidPan('ABCDE1234F')).toBe(true)
    expect(isValidPan('abcde1234f')).toBe(false)
    expect(isValidPincode('400001')).toBe(true)
    expect(isValidPincode('012345')).toBe(false)
    expect(isValidPincode('4000')).toBe(false)
  })
  it('finds the start of the financial year for any date', () => {
    expect(financialYearStart('2025-04-01')).toBe('2025-04-01')
    expect(financialYearStart('2026-03-31')).toBe('2025-04-01')
    expect(financialYearStart('2025-11-17')).toBe('2025-04-01')
    expect(financialYearStart('2025-02-10', 1)).toBe('2025-01-01')
  })
})

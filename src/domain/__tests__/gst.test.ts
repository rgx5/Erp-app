import { gstinCheckChar, gstinProblem, gstinState, isValidGstin, stateName, supplyOptions } from '../gst'

// Real-format GSTINs built with the check-character algorithm (not real businesses).
const mk = (first14: string) => first14 + gstinCheckChar(first14)
const MH = mk('27ABCDE1234F1Z')
const KA = mk('29AAACB1234H1Z')

describe('GSTIN', () => {
  test('a well-formed GSTIN with the right check character passes', () => {
    expect(MH).toHaveLength(15)
    expect(gstinProblem(MH)).toBeNull()
    expect(isValidGstin(KA)).toBe(true)
    expect(gstinProblem(` ${MH.toLowerCase()} `)).toBeNull()
  })
  test('empty means "no GSTIN", not a mistake', () => {
    expect(gstinProblem('')).toBeNull()
    expect(gstinProblem(undefined)).toBeNull()
    expect(isValidGstin('')).toBe(false)
  })
  test('says what is wrong', () => {
    expect(gstinProblem('27ABCDE1234F1')).toMatch(/15 characters/)
    expect(gstinProblem('ZZABCDE1234F1Z5')).toMatch(/does not look/)
    expect(gstinProblem(mk('25ABCDE1234F1Z'))).toMatch(/not a GST state code/)
    const bad = MH.slice(0, 14) + (MH[14] === '0' ? '1' : '0')
    expect(gstinProblem(bad)).toMatch(/last character/)
  })
  test('state of a GSTIN', () => {
    expect(gstinState(MH)).toBe('27')
    expect(stateName('27')).toBe('Maharashtra')
    expect(gstinState('hello')).toBe('')
    expect(gstinState('25ABCDE1234F1Z5')).toBe('')
  })
})

describe('supplyOptions', () => {
  const regular = { gstin: MH, registrationType: 'regular' as const }
  test('same state or no buyer state: local', () => {
    expect(supplyOptions(regular, MH)).toEqual({ interState: false, noTax: false })
    expect(supplyOptions(regular, '')).toEqual({ interState: false, noTax: false })
    expect(supplyOptions({ gstin: '', registrationType: 'regular' }, KA)).toEqual({ interState: false, noTax: false })
  })
  test('another state: IGST — from the customer, the buyer on the bill, or the place of supply picked', () => {
    expect(supplyOptions(regular, KA).interState).toBe(true)
    expect(supplyOptions(regular, '', { buyerGstin: KA }).interState).toBe(true)
    expect(supplyOptions(regular, KA, { placeOfSupply: '27' }).interState).toBe(false)
    expect(supplyOptions(regular, '', { placeOfSupply: '29' }).interState).toBe(true)
  })
  test('composition and unregistered dealers charge no tax at all', () => {
    expect(supplyOptions({ gstin: MH, registrationType: 'composition' }, KA)).toEqual({ interState: false, noTax: true })
    expect(supplyOptions({ gstin: '', registrationType: 'unregistered' }, '')).toEqual({ interState: false, noTax: true })
  })
})

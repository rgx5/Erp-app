import { describe, expect, it } from 'vitest'
import { parseScaleLine } from '@/features/pos/scale'

describe('scale lines', () => {
  it.each([
    ['ST,GS,  0.500kg', 0.5, true], ['US,GS,  0.502kg', 0.502, false], ['+001.250kg', 1.25, true], ['W: 1.250 kg', 1.25, true],
    ['  0.500 kg', 0.5, true], ['ST GS 250 g', 0.25, true], ['ST,GS,   2.000 lb', 0.907, true], ['0.750', 0.75, true], ['ST,NT,   0.000kg', 0, true],
  ])('reads %j', (line, kg, stable) => { expect(parseScaleLine(line)).toEqual({ kg, stable }) })
  it('ignores blanks and text with no weight', () => { expect(parseScaleLine('')).toBeNull(); expect(parseScaleLine('OVERLOAD')).toBeNull(); expect(parseScaleLine('-5 kg')).toBeNull() })
})

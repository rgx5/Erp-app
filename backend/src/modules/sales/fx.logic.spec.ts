import { describe, expect, it } from 'vitest';
import { inrUnitsOf, toForeignUnits, toInr, toPaiseUnits } from './fx.logic.js';

describe('exchange maths', () => {
  it('converts foreign money to rupees exactly', () => {
    expect(toInr('1000', '83.5')).toBe('83500.0000');
    expect(toInr('12.3456', '83.12345678')).toBe('1026.2089');
    expect(toInr('0.0001', '83')).toBe('0.0083');
  });
  it('rounds half away from zero', () => { expect(toInr('0.0001', '0.5')).toBe('0.0001'); });
  it('goes back and forth', () => {
    expect(toForeignUnits(835000000n, '83.5')).toBe(10000000n);
    expect(inrUnitsOf(10000000n, '84')).toBe(840000000n);
  });
  it('rounds to paise', () => { expect(toPaiseUnits(123456n)).toBe(123500n); expect(toPaiseUnits(123449n)).toBe(123400n); });
});

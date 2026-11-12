import { describe, expect, it } from 'vitest';
import { cost, costOf, divRound, qty, value, valueOf } from './decimal.js';

describe('stock decimals', () => {
  it('round-trips and rejects too many places', () => {
    expect(qty.format(qty.parse('12.5'))).toBe('12.500000');
    expect(cost.format(cost.parse('0.000001'))).toBe('0.000001');
    expect(value.format(value.parseSigned('-3.1'))).toBe('-3.1000');
    expect(() => qty.parse('1.1234567')).toThrow();
    expect(() => value.parse('1.12345')).toThrow();
    expect(() => qty.parse('-1')).toThrow();
  });
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(-4n, 3n)).toBe(-1n);
  });
  it('values a quantity at a cost exactly', () => {
    expect(value.format(valueOf(qty.parse('3'), cost.parse('33.333333')))).toBe('100.0000');
    expect(value.format(valueOf(qty.parse('0.5'), cost.parse('10')))).toBe('5.0000');
    expect(value.format(valueOf(qty.parse('1000000'), cost.parse('0.000001')))).toBe('1.0000');
  });
  it('derives a unit cost from value over quantity', () => {
    expect(cost.format(costOf(value.parse('100'), qty.parse('3')))).toBe('33.333333');
    expect(cost.format(costOf(value.parse('99.9999'), qty.parse('3')))).toBe('33.333300');
  });
});

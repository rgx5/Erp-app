import { describe, expect, it } from 'vitest';
import { deviation, formatPercent, percentUnits, within } from './match.js';

describe('three-way match arithmetic', () => {
  it('reads and writes percentages exactly', () => {
    expect(percentUnits('2.5')).toBe(25_000n);
    expect(percentUnits('100')).toBe(1_000_000n);
    expect(formatPercent(25_000n)).toBe('2.5000');
    expect(() => percentUnits('1.23456')).toThrow();
  });
  it('measures the deviation from the expected value, both ways', () => {
    expect(deviation(102_000_000n, 100_000_000n)).toBe(20_000n); // +2%
    expect(deviation(98_000_000n, 100_000_000n)).toBe(20_000n); // -2% counts the same
    expect(deviation(5n, 5n)).toBe(0n);
    expect(deviation(0n, 0n)).toBe(0n);
    expect(deviation(1n, 0n)).toBeNull(); // anything against zero is unbounded
    expect(deviation(100_001n, 100_000n)).toBe(10n); // 0.001%
  });
  it('is inclusive at the tolerance and refuses unbounded deviations', () => {
    expect(within(20_000n, percentUnits('2'))).toBe(true);
    expect(within(20_001n, percentUnits('2'))).toBe(false);
    expect(within(0n, 0n)).toBe(true);
    expect(within(null, percentUnits('100'))).toBe(false);
  });
});

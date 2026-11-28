import { describe, expect, it } from 'vitest';
import { tcsOn } from './tcs.logic.js';

describe('TCS amount', () => {
  it('works out the percentage in paise, rounded to the nearest paisa', () => {
    expect(tcsOn(10_000_000n, '1')).toBe(100_000n);    // 1% of ₹1,00,000 = ₹1,000
    expect(tcsOn(10_000_000n, '2.5')).toBe(250_000n);  // 2.5% = ₹2,500
    expect(tcsOn(123_456n, '1')).toBe(1_235n);         // ₹1,234.56 × 1% = ₹12.3456 → ₹12.35
    expect(tcsOn(50_000n, '0.075')).toBe(38n);         // fractional rates
    expect(tcsOn(0n, '5')).toBe(0n);
  });
});

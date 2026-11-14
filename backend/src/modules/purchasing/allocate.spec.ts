import { describe, expect, it } from 'vitest';
import { allocateProportionally } from './allocate.js';

describe('allocateProportionally', () => {
  it('splits in proportion and always adds up to the total', () => {
    expect(allocateProportionally(600n, [5000n, 3000n, 2000n])).toEqual([300n, 180n, 120n]);
    const shares = allocateProportionally(100n, [1n, 1n, 1n]);
    expect(shares).toEqual([34n, 33n, 33n]); // the odd unit goes to the first of equal remainders
    expect(shares.reduce((a, s) => a + s, 0n)).toBe(100n);
  });
  it('gives leftover units to the largest remainders', () => {
    expect(allocateProportionally(10n, [1n, 2n, 3n])).toEqual([2n, 3n, 5n]); // 1.667, 3.333, 5 -> floors 1,3,5 + 1 to the largest remainder
  });
  it('is exact for large amounts and sums for any weights', () => {
    for (const total of [1n, 7n, 12_345_678n, 999_999_999_999n]) {
      for (const weights of [[1n, 2n, 3n], [7n, 7n, 7n, 7n], [1n, 1_000_000n], [5n]]) {
        const s = allocateProportionally(total, weights);
        expect(s.reduce((a, x) => a + x, 0n)).toBe(total);
        s.forEach((x) => expect(x >= 0n).toBe(true));
      }
    }
  });
  it('refuses nothing to allocate over, negative weights and all-zero weights', () => {
    expect(() => allocateProportionally(1n, [])).toThrow();
    expect(() => allocateProportionally(1n, [1n, -1n])).toThrow();
    expect(() => allocateProportionally(1n, [0n, 0n])).toThrow();
  });
});

/**
 * Splits `total` over `weights` in proportion, exactly: every share is a whole number of units, the shares add up to `total`,
 * and the units left over by rounding go to the largest remainders (earlier lines first on a tie). Pure integer arithmetic.
 */
export function allocateProportionally(total: bigint, weights: bigint[]): bigint[] {
  if (weights.length === 0) throw new RangeError('Nothing to allocate over');
  if (weights.some((w) => w < 0n)) throw new RangeError('Weights cannot be negative');
  const sum = weights.reduce((a, w) => a + w, 0n);
  if (sum === 0n) throw new RangeError('The weights add up to zero');
  const shares = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - shares.reduce((a, s) => a + s, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i] = (shares[i] as bigint) + 1n;
    left -= 1n;
  }
  return shares;
}

import { fromUnits, toUnits } from '../accounting/money.js';

/** Exchange maths on exact integers. Money is in 1/10000 (see accounting/money); a rate has up to 8 decimals. */
const RATE_SCALE = 8;
export function rateUnits(rate: string): bigint {
  const m = /^(\d{1,10})(?:\.(\d{1,8}))?$/.exec(rate);
  if (!m) throw new TypeError(`Not a valid exchange rate: ${rate}`);
  return BigInt(m[1] as string) * 10n ** BigInt(RATE_SCALE) + BigInt((m[2] ?? '').padEnd(RATE_SCALE, '0') || '0');
}
const div = (n: bigint, d: bigint): bigint => (n >= 0n ? (n * 2n + d) / (2n * d) : -((-n * 2n + d) / (2n * d))); // round half away from zero
const ONE = 10n ** BigInt(RATE_SCALE);

/** Foreign money (string, ≤ 4 dp) to rupees at `rate` (rupees per unit), to 4 dp. */
export const toInr = (foreign: string, rate: string): string => fromUnits(div(toUnits(foreign) * rateUnits(rate), ONE));
/** Rupees (units) back to the foreign currency, to 4 dp. */
export const toForeignUnits = (inrUnits: bigint, rate: string): bigint => div(inrUnits * ONE, rateUnits(rate));
/** Foreign units × rate, as rupee units. */
export const inrUnitsOf = (foreignUnits: bigint, rate: string): bigint => div(foreignUnits * rateUnits(rate), ONE);
/** Rounds 4-dp units to whole paise (2 dp). */
export const toPaiseUnits = (units: bigint): bigint => div(units, 100n) * 100n;

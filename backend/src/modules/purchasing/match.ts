import { divRound } from '../inventory/decimal.js';

/** Percent figures carry four decimals; 100% is 1_000_000 of these units. */
const PERCENT_ONE = 1_000_000n;

export const percentUnits = (text: string): bigint => {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) throw new TypeError(`Not a valid percentage: ${text}`);
  return BigInt(m[1] as string) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0') || '0');
};
export const formatPercent = (units: bigint): string => `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;

/** How far `actual` is from `expected`, as a percentage of `expected` (4 decimals); `null` when expected is zero and actual is not. */
export function deviation(actual: bigint, expected: bigint): bigint | null {
  const diff = actual > expected ? actual - expected : expected - actual;
  if (diff === 0n) return 0n;
  if (expected === 0n) return null;
  return divRound(diff * PERCENT_ONE, expected);
}

/** True when the deviation is within the tolerance (an unbounded deviation never is). */
export const within = (dev: bigint | null, tolerance: bigint): boolean => dev !== null && dev <= tolerance;

export interface MatchIssue {
  lineNo: number;
  kind: 'price' | 'quantity';
  expected: string;
  actual: string;
  deviationPercent: string | null;
  tolerancePercent: string;
}

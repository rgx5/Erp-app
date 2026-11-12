/**
 * Exact money arithmetic. Amounts travel as decimal STRINGS with up to 4 decimal places and are summed as integers of 1/10000,
 * so no floating-point error can ever unbalance an entry.
 */
const SCALE = 4;
const PATTERN = /^(\d{1,14})(?:\.(\d{1,4}))?$/;

export function toUnits(amount: string): bigint {
  const match = PATTERN.exec(amount);
  if (!match) throw new TypeError(`Not a valid amount: ${amount}`);
  return BigInt(match[1] as string) * 10n ** BigInt(SCALE) + BigInt((match[2] ?? '').padEnd(SCALE, '0') || '0');
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10n ** BigInt(SCALE);
  const fraction = (abs % 10n ** BigInt(SCALE)).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export const isPositive = (amount: string): boolean => toUnits(amount) > 0n;

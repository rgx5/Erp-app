/**
 * Exact stock arithmetic on integers: quantities and unit costs carry 6 decimal places, values 4. No floating point is ever used,
 * so a ledger value is the same on every machine and always rounds the same way (half up).
 */
export const QTY_SCALE = 6;
export const COST_SCALE = 6;
export const VALUE_SCALE = 4;

const parse = (text: string, scale: number): bigint => {
  const match = /^(\d{1,12})(?:\.(\d{1,12}))?$/.exec(text);
  const fraction = match?.[2] ?? '';
  if (!match || fraction.length > scale) throw new TypeError(`Not a valid decimal with at most ${scale} places: ${text}`);
  return BigInt(match[1] as string) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
};

const format = (units: bigint, scale: number): string => {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(scale);
  return `${negative ? '-' : ''}${abs / base}.${(abs % base).toString().padStart(scale, '0')}`;
};

/** A signed numeric string from SQL (`-12.5`) back to integer units. */
const parseSigned = (text: string, scale: number): bigint => (text.startsWith('-') ? -parse(text.slice(1), scale) : parse(text, scale));

export const qty = { parse: (t: string) => parse(t, QTY_SCALE), parseSigned: (t: string) => parseSigned(t, QTY_SCALE), format: (u: bigint) => format(u, QTY_SCALE) };
export const cost = { parse: (t: string) => parse(t, COST_SCALE), parseSigned: (t: string) => parseSigned(t, COST_SCALE), format: (u: bigint) => format(u, COST_SCALE) };
export const value = { parse: (t: string) => parse(t, VALUE_SCALE), parseSigned: (t: string) => parseSigned(t, VALUE_SCALE), format: (u: bigint) => format(u, VALUE_SCALE) };

/** Integer division rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

/** Value (1e-4) of a quantity (1e-6) at a unit cost (1e-6): qty x cost, rounded. */
export const valueOf = (quantity: bigint, unitCost: bigint): bigint => divRound(quantity * unitCost, 10n ** 8n);

/** Unit cost (1e-6) implied by a value (1e-4) over a quantity (1e-6). */
export const costOf = (totalValue: bigint, quantity: bigint): bigint => divRound(totalValue * 10n ** 8n, quantity);

/**
 * Exact money. Amounts are decimal STRINGS with up to 4 places (what the server sends and expects) and are added and compared as
 * integers of 1/10000, so no floating-point error can ever reach a screen or a request.
 */
const SCALE = 4
const PATTERN = /^(-?)(\d{1,14})(?:\.(\d{1,4}))?$/

export function toUnits(amount: string): bigint {
  const m = PATTERN.exec(amount.trim())
  if (!m) throw new TypeError(`Not a valid amount: ${amount}`)
  const units = BigInt(m[2] as string) * 10n ** BigInt(SCALE) + BigInt((m[3] ?? '').padEnd(SCALE, '0') || '0')
  return m[1] === '-' ? -units : units
}

/** Like `toUnits`, but anything that is not a valid amount (empty, half-typed, letters) counts as zero: for figures read while someone is still typing. */
export function unitsOrZero(amount: string): bigint { return PATTERN.test(amount.trim()) ? toUnits(amount) : 0n }

export function fromUnits(units: bigint): string {
  const negative = units < 0n
  const abs = negative ? -units : units
  const base = 10n ** BigInt(SCALE)
  return `${negative ? '-' : ''}${abs / base}.${(abs % base).toString().padStart(SCALE, '0')}`
}

export const add = (a: string, b: string): string => fromUnits(toUnits(a) + toUnits(b))
export const sub = (a: string, b: string): string => fromUnits(toUnits(a) - toUnits(b))
export const sum = (list: readonly string[]): string => fromUnits(list.reduce((t, a) => t + toUnits(a), 0n))
export const compare = (a: string, b: string): -1 | 0 | 1 => { const x = toUnits(a); const y = toUnits(b); return x < y ? -1 : x > y ? 1 : 0 }
export const isZero = (a: string): boolean => toUnits(a) === 0n
export const isValid = (a: string): boolean => PATTERN.test(a.trim())

/** Exact quantity arithmetic: decimal strings with up to 6 places (what the server uses for quantities), as integers of 1/1,000,000. */
const PATTERN = /^(-?)(\d{1,12})(?:\.(\d{1,6}))?$/
export function toMicro(q: string): bigint {
  const m = PATTERN.exec(q.trim())
  if (!m) throw new TypeError(`Not a valid quantity: ${q}`)
  const v = BigInt(m[2] as string) * 1_000_000n + BigInt((m[3] ?? '').padEnd(6, '0') || '0')
  return m[1] === '-' ? -v : v
}
export function fromMicro(v: bigint): string {
  const neg = v < 0n
  const a = neg ? -v : v
  return `${neg ? '-' : ''}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, '0')}`
}
/** `10.000000` -> `10`, `2.500000` -> `2.5`: how a quantity reads on screen. */
export const showQty = (q: string): string => (q.includes('.') ? q.replace(/\.?0+$/, '') : q)
export const subQty = (a: string, b: string): string => fromMicro(toMicro(a) - toMicro(b))
export const isPositiveQty = (q: string): boolean => PATTERN.test(q.trim()) && toMicro(q) > 0n

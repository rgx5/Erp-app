import { toMicro } from './quantity'

/** Indian digit grouping: 12,34,567.89 (the last three digits, then pairs). */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits
  const head = digits.slice(0, -3)
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`
}

/** `1234567.5` -> `₹ 12,34,567.50`. Negative amounts keep the sign in front. Rounds half away from zero to `places`. */
export function formatInr(amount: string, opts: { places?: 0 | 2 | 4; symbol?: boolean } = {}): string {
  const places = opts.places ?? 2
  const micro = toMicro(amount) // amounts and unit costs carry up to 6 decimals
  const negative = micro < 0n
  const abs = negative ? -micro : micro
  const drop = 10n ** BigInt(6 - places)
  const rounded = (abs + drop / 2n) / drop
  const base = 10n ** BigInt(places)
  const whole = groupIndian((rounded / base).toString())
  const fraction = places > 0 ? `.${(rounded % base).toString().padStart(places, '0')}` : ''
  return `${negative ? '-' : ''}${opts.symbol === false ? '' : '₹ '}${whole}${fraction}`
}

/** `2025-04-01` -> `01/04/2025`; anything else is returned untouched. */
export function formatDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '')
}

/** `01/04/2025` -> `2025-04-01`, or null when it is not a real date. */
export function parseDate(text: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text.trim())
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export const todayIso = (now = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

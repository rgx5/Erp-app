/**
 * All money is handled as rupees in JS numbers but rounded to 2dp at every boundary (same rule as the billing app, so
 * a bill totals to the same paisa on the phone and at the counter).
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Indian digit grouping (12,34,567.89) without relying on Intl, so output is identical on every JS engine. */
export function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart
  const last3 = intPart.slice(-3)
  const rest = intPart.slice(0, -3)
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
}

/** "₹1,23,456.00" — negative amounts read "-₹1,200.00". */
export function inr(n: number, decimals = 2): string {
  const v = round2(n)
  const neg = v < 0
  const [i, d = ''] = Math.abs(v).toFixed(decimals).split('.')
  return `${neg ? '-' : ''}₹${groupIndian(i)}${decimals > 0 ? '.' + d : ''}`
}

/** Whole-rupee form for dense lists: "₹1,200". */
export const inr0 = (n: number) => inr(n, 0)

/** Compact form for tiles: ₹1.2L, ₹45.3k, ₹2.10Cr */
export function inrShort(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}k`
  return inr(n, a % 1 === 0 ? 0 : 2)
}

/** Plain grouped number, no symbol: 12,34,567 */
export function num(n: number, decimals = 0): string {
  const neg = n < 0
  const [i, d = ''] = Math.abs(n).toFixed(decimals).split('.')
  return `${neg ? '-' : ''}${groupIndian(i)}${decimals > 0 ? '.' + d : ''}`
}

/** "+12.5%" / "-3%" */
export function pctLabel(p: number): string {
  const r = Math.round(p * 10) / 10
  return `${r > 0 ? '+' : ''}${r}%`
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigit(n: number): string {
  if (n < 20) return ONES[n]
  return (TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')).trim()
}

/** Indian numbering: crore / lakh / thousand / hundred. Used on the invoice. */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(round2(amount))
  const paise = Math.round((round2(amount) - rupees) * 100)
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only'

  const parts: string[] = []
  const push = (v: number, label: string) => { if (v) parts.push(twoDigit(v) + ' ' + label) }
  push(Math.floor(rupees / 1e7), 'Crore')
  push(Math.floor((rupees % 1e7) / 1e5), 'Lakh')
  push(Math.floor((rupees % 1e5) / 1e3), 'Thousand')
  push(Math.floor((rupees % 1e3) / 100), 'Hundred')
  const last = rupees % 100
  if (last) parts.push((parts.length ? 'and ' : '') + twoDigit(last))

  let out = parts.join(' ').trim() + ' Rupees'
  if (paise) out += ' and ' + twoDigit(paise) + ' Paise'
  return out + ' Only'
}

/** Cash-drawer friendly rounding to the nearest rupee. Returns [roundedTotal, roundOffDelta]. */
export function roundOff(total: number): [number, number] {
  const rounded = Math.round(round2(total))
  return [rounded, round2(rounded - round2(total))]
}

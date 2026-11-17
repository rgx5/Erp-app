const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

const below100 = (n: number): string => (n < 20 ? ONES[n] ?? '' : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const below1000 = (n: number): string => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n))

/** Whole rupees in the Indian system (thousand, lakh, crore). */
export function numberInWords(n: bigint): string {
  if (n === 0n) return 'Zero'
  const parts: string[] = []
  let rest = n
  const crore = rest / 10_000_000n
  rest %= 10_000_000n
  if (crore > 0n) parts.push(`${numberInWords(crore)} Crore`)
  const lakh = Number(rest / 100_000n); rest %= 100_000n
  if (lakh > 0) parts.push(`${below100(lakh)} Lakh`)
  const thousand = Number(rest / 1000n); rest %= 1000n
  if (thousand > 0) parts.push(`${below100(thousand)} Thousand`)
  if (rest > 0n) parts.push(below1000(Number(rest)))
  return parts.join(' ')
}

/** `2360.5` -> `Two Thousand Three Hundred Sixty Rupees and Fifty Paise Only`. Takes a decimal string, never a float. */
export function rupeesInWords(amount: string): string {
  const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(amount)
  if (!m) return ''
  const rupees = BigInt(m[2] as string)
  const paise = Number(((m[3] ?? '') + '00').slice(0, 2))
  const words = `${numberInWords(rupees)} Rupees${paise > 0 ? ` and ${below100(paise)} Paise` : ''} Only`
  return m[1] === '-' ? `Minus ${words}` : words
}

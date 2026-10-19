/** Internal-use EAN-13 prefix (200-299 is reserved for in-store numbering). */
const STORE_PREFIX = '210'

export function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/**
 * Builds a scannable in-store EAN-13 from a running counter.
 * Pre-barcoded stock keeps its own code — this is only for goods we label ourselves.
 */
export function makeBarcode(counter: number): string {
  const body = String(counter).padStart(9, '0').slice(-9)
  const first12 = STORE_PREFIX + body
  return first12 + ean13CheckDigit(first12)
}

/** The next free in-store barcode, skipping any code already in use. */
export function nextBarcode(taken: Set<string>, startAt: number): string {
  let n = startAt
  for (;;) {
    const code = makeBarcode(n)
    if (!taken.has(code)) return code
    n++
  }
}

/** The 95-module bit pattern of an EAN-13 — used to draw the bars as SVG rects without a barcode library. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function ean13Bits(code: string): string {
  if (!isValidEan13(code)) throw new Error('Not a valid EAN-13')
  const first = Number(code[0])
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (PARITY[first][i - 1] === 'L' ? L : G)[Number(code[i])]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])]
  return bits + '101'
}

/** Code 128 (subset B) — for SKUs and non-EAN codes. Returns the module pattern as a bit string. */
const C128 = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100', '10011001000', '10011000100',
  '10001100100', '11001001000', '11001000100', '11000100100', '10110011100', '10011011100', '10011001110', '10111001100',
  '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010', '11011011000', '11011000110',
  '11000110110', '10100011000', '10001011000', '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110', '11101011000', '11101000110',
  '11100010110', '11101101000', '11101100010', '11100011010', '11101111010', '11001000010', '11110001010', '10100110000',
  '10100001100', '10010110000', '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100', '10011110010', '11110100100', '11110010100',
  '11110010010', '11011011110', '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110', '11110101110',
  '11010000100', '11010010000', '11010011100',
]
const C128_STOP = '1100011101011'

export function code128Bits(text: string): string {
  const start = 104 // Start B
  let sum = start
  let bits = C128[start]
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32
    if (v < 0 || v > 95) throw new Error('Unsupported character for Code 128-B')
    bits += C128[v]
    sum += v * (i + 1)
  }
  return bits + C128[sum % 103] + C128_STOP
}

/** Bars for whichever symbology fits: EAN-13 when the code is a valid one, otherwise Code 128. */
export function barcodeBits(code: string): { bits: string; format: 'EAN13' | 'CODE128' } {
  return isValidEan13(code) ? { bits: ean13Bits(code), format: 'EAN13' } : { bits: code128Bits(code), format: 'CODE128' }
}

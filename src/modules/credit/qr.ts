/**
 * A QR code encoder (byte mode, versions 1–10, error correction L / M / Q) in plain TypeScript — no library, no native code.
 * Enough for a UPI payment link (about 100–150 characters). `encodeQr` returns the module matrix: `true` = dark.
 *
 * Follows ISO/IEC 18004: data → Reed–Solomon blocks → interleave → place with finder / alignment / timing patterns →
 * choose the mask with the lowest penalty → write format (and, from version 7, version) information.
 */
export type EcLevel = 'L' | 'M' | 'Q'

// Per version 1–10 and level: [ecCodewordsPerBlock, blocksGroup1, dataPerBlockGroup1, blocksGroup2, dataPerBlockGroup2]
const EC_TABLE: Record<EcLevel, Array<[number, number, number, number, number]>> = {
  L: [[7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
  M: [[10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
  Q: [[13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
}
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const FORMAT_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3 }

// ── GF(256) arithmetic for Reed–Solomon ──
const EXP = new Array<number>(512)
const LOG = new Array<number>(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function generator(degree: number): number[] {
  let g = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]) }
    g = next
  }
  return g
}

/** The Reed–Solomon error-correction codewords for a block of data. */
export function reedSolomon(data: number[], ecLen: number): number[] {
  const g = generator(ecLen)
  const rem = new Array<number>(ecLen).fill(0)
  for (const d of data) {
    const factor = d ^ rem[0]
    rem.shift(); rem.push(0)
    for (let i = 0; i < ecLen; i++) rem[i] ^= mul(g[i + 1], factor)
  }
  return rem
}

const utf8 = (s: string): number[] => Array.from(new TextEncoder().encode(s))

function capacityBytes(version: number, ec: EcLevel): number {
  const [, b1, d1, b2, d2] = EC_TABLE[ec][version - 1]
  return b1 * d1 + b2 * d2
}

/** The smallest version (1–10) whose byte-mode capacity fits `n` bytes, or 0 if it does not fit version 10. */
export function pickVersion(n: number, ec: EcLevel): number {
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16
    const need = Math.ceil((4 + countBits + n * 8) / 8)
    if (need <= capacityBytes(v, ec)) return v
  }
  return 0
}

function dataCodewords(bytes: number[], version: number, ec: EcLevel): number[] {
  const total = capacityBytes(version, ec) * 8
  const bits: number[] = []
  const put = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, total - bits.length))
  while (bits.length % 8) bits.push(0)
  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0; out.length < total / 8; pad++) out.push(pad % 2 === 0 ? 0xec : 0x11)
  return out
}

function interleave(data: number[], version: number, ec: EcLevel): number[] {
  const [ecLen, b1, d1, b2, d2] = EC_TABLE[ec][version - 1]
  const blocks: number[][] = []
  const ecs: number[][] = []
  let pos = 0
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2
    const block = data.slice(pos, pos + len)
    pos += len
    blocks.push(block)
    ecs.push(reedSolomon(block, ecLen))
  }
  const out: number[] = []
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i])
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i])
  return out
}

type Matrix = boolean[][]

function blank(size: number) {
  const m: Matrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false)) // function modules: never masked
  return { m, fn }
}

function drawFunctionPatterns(m: Matrix, fn: boolean[][], version: number) {
  const size = m.length
  const set = (r: number, c: number, dark: boolean) => { if (r >= 0 && c >= 0 && r < size && c < size) { m[r][c] = dark; fn[r][c] = true } }
  // finder patterns + separators
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6
      const dark = inner && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))
      set(r0 + r, c0 + c, dark)
    }
  }
  // timing patterns
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  // alignment patterns
  const al = ALIGN[version - 1]
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
  }
  // reserve format / version areas (filled in later) and the dark module
  for (let i = 0; i < 9; i++) { set(8, i, false); set(i, 8, false) }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false) }
  set(size - 8, 8, true)
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(i, size - 11 + j, false); set(size - 11 + j, i, false) }
}

function placeData(m: Matrix, fn: boolean[][], codewords: number[]) {
  const size = m.length
  const bits: boolean[] = []
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push(((cw >>> i) & 1) === 1)
  let k = 0
  let up = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i
      for (let c = 0; c < 2; c++) {
        const cc = col - c
        if (fn[row][cc]) continue
        m[row][cc] = k < bits.length ? bits[k] : false
        k++
      }
    }
    up = !up
  }
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

function applyMask(m: Matrix, fn: boolean[][], mask: number): Matrix {
  return m.map((row, r) => row.map((v, c) => (fn[r][c] ? v : v !== MASKS[mask](r, c))))
}

function formatBits(ec: EcLevel, mask: number): number {
  const data = (FORMAT_BITS[ec] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

function drawFormat(m: Matrix, ec: EcLevel, mask: number, version: number) {
  const size = m.length
  const bits = formatBits(ec, mask)
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i)
  m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8)
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i)
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i)
  m[size - 8][8] = true
  if (version >= 7) {
    const v = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) === 1
      const a = Math.floor(i / 3), b = (i % 3) + size - 11
      m[a][b] = dark
      m[b][a] = dark
    }
  }
}

function penalty(m: Matrix): number {
  const n = m.length
  let p = 0
  for (let r = 0; r < n; r++) {
    for (const horizontal of [true, false]) {
      let run = 1
      for (let i = 1; i < n; i++) {
        const a = horizontal ? m[r][i] : m[i][r]
        const b = horizontal ? m[r][i - 1] : m[i - 1][r]
        if (a === b) { run++; if (i === n - 1 && run >= 5) p += run - 2 } else { if (run >= 5) p += run - 2; run = 1 }
      }
    }
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3
  const pat = [true, false, true, true, true, false, true, false, false, false, false]
  const rev = [...pat].reverse()
  const hit = (get: (i: number) => boolean, at: number, p2: boolean[]) => p2.every((v, i) => get(at + i) === v)
  for (let r = 0; r < n; r++) for (let c = 0; c + 11 <= n; c++) {
    if (hit((i) => m[r][i], c, pat) || hit((i) => m[r][i], c, rev)) p += 40
    if (hit((i) => m[i][r], c, pat) || hit((i) => m[i][r], c, rev)) p += 40
  }
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
  return p
}

/** The QR code for `text` as a matrix of modules (`true` = dark), or null if it does not fit (about 150+ characters at level M). */
export function encodeQr(text: string, ec: EcLevel = 'M'): boolean[][] | null {
  const bytes = utf8(text)
  const version = pickVersion(bytes.length, ec)
  if (!version) return null
  const size = 17 + 4 * version
  const codewords = interleave(dataCodewords(bytes, version, ec), version, ec)
  const { m, fn } = blank(size)
  drawFunctionPatterns(m, fn, version)
  placeData(m, fn, codewords)
  let best: Matrix | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(m, fn, mask)
    drawFormat(masked, ec, mask, version)
    const score = penalty(masked)
    if (score < bestScore) { bestScore = score; best = masked }
  }
  return best
}

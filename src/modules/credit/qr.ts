import makeQr from 'qrcode-generator'

/** Error-correction levels: L recovers ~7% damage, M ~15%, Q ~25%. M reads well off a phone screen or a printed bill. */
export type EcLevel = 'L' | 'M' | 'Q'

/**
 * The module matrix of a QR code (`true` = dark), made by the `qrcode-generator` library in byte mode. The size is picked
 * automatically. Payloads here are ASCII (a UPI link is percent-encoded), which is what that library's byte mode carries.
 */
export function encodeQr(text: string, ec: EcLevel = 'M'): boolean[][] {
  if (!text) throw new Error('Nothing to encode')
  const qr = makeQr(0, ec)
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/** An SVG path (`M x y h1 v1 h-1z …`, one unit per module) that draws every dark module — hand it to `react-native-svg`. */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = []
  matrix.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) { x++; continue }
      let end = x
      while (end < row.length && row[end]) end++
      parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  })
  return parts.join('')
}

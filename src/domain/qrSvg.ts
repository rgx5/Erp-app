import qrcode from 'qrcode-generator'

/**
 * A QR code as an inline SVG string (for printed invoices). Byte mode, error correction M, falling back to L for a long payload —
 * an e-invoice's signed QR is over a thousand characters.
 */
export function qrSvg(text: string, size = 120): string {
  const build = (ec: 'M' | 'L') => { const q = qrcode(0, ec); q.addData(text, 'Byte'); q.make(); return q }
  let qr: ReturnType<typeof build>
  try { qr = build('M') } catch { qr = build('L') }
  const n = qr.getModuleCount()
  const parts: string[] = []
  for (let y = 0; y < n; y++) {
    let x = 0
    while (x < n) {
      if (!qr.isDark(y, x)) { x++; continue }
      let end = x
      while (end < n && qr.isDark(y, end)) end++
      parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${parts.join('')}" fill="#000"/></svg>`
}

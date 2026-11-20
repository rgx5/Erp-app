import qrcode from 'qrcode-generator'

/** The UPI payment link every UPI app understands when scanned. The amount is fixed so the customer cannot mistype it. */
export function upiLink(upiId: string, payeeName: string, amount: string, note: string): string {
  const p = new URLSearchParams({ pa: upiId, pn: payeeName.slice(0, 50), am: Number(amount).toFixed(2), cu: 'INR', tn: note.slice(0, 40) })
  return `upi://pay?${p.toString().replaceAll('+', '%20')}`
}

/** A QR code as an inline SVG (no image files), sized in millimetres for print. */
export function qrSvg(text: string, mm = 24): string {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make()
  const n = qr.getModuleCount(); let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${mm}mm" height="${mm}mm" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}

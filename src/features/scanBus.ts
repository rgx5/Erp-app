/**
 * The scanner screen is shared by billing, stock counts and goods receipt. Whoever opens it says what a scanned code
 * should do; the handler answers with a line of feedback ("Added Oxford Shirt · M / White" or "Unknown barcode").
 */
export type ScanResult = { ok: boolean; text: string }
export type ScanHandler = (code: string) => ScanResult

let handler: ScanHandler | null = null
let title = 'Scan barcodes'
let hint = ''

export function openScanner(h: ScanHandler, opts: { title?: string; hint?: string } = {}) {
  handler = h
  title = opts.title ?? 'Scan barcodes'
  hint = opts.hint ?? ''
}

export const scannerTitle = () => title
export const scannerHint = () => hint
export const handleScan = (code: string): ScanResult => (handler ? handler(code.trim()) : { ok: false, text: 'Nothing is waiting for a scan' })
export const closeScanner = () => { handler = null }

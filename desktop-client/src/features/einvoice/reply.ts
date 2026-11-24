export interface ReplyItem { irn?: string; ackNo?: string; ackDate?: string; signedQr?: string; signedInvoice?: string; docNo?: string }
export interface ParsedReply { items: ReplyItem[]; rejected: { docNo: string; message: string }[] }

const norm = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]))
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() || undefined : typeof v === 'number' ? String(v) : undefined)

/** Pulls every answer out of the portal's reply file, whichever way the portal wrapped it (a list, or an object holding the list), keeping what it refused and why. */
export function parseReply(text: string): ParsedReply {
  let json: unknown
  try { json = JSON.parse(text) } catch { throw new Error('This is not a JSON file. Download the reply from the portal and choose that file.') }
  const out: ParsedReply = { items: [], rejected: [] }
  const walk = (v: unknown, depth: number): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    if (!v || typeof v !== 'object' || depth > 6) return
    const o = norm(v as Record<string, unknown>)
    const irn = str(o['irn']); const docNo = str(o['docno'] ?? o['docnumber'] ?? o['invoiceno'])
    if (irn) {
      const ack = str(o['ackno']); const when = str(o['ackdt'] ?? o['ackdate']); const qr = str(o['signedqrcode'] ?? o['signedqr'])
      const item: ReplyItem = { irn, ...(ack ? { ackNo: ack } : {}), ...(when ? { ackDate: when } : {}), ...(qr ? { signedQr: qr } : {}), ...(str(o['signedinvoice']) ? { signedInvoice: str(o['signedinvoice']) as string } : {}), ...(docNo ? { docNo } : {}) }
      out.items.push(item); return
    }
    const err = str(o['errormessage'] ?? o['errordetails'] ?? o['errormsg'] ?? o['message'])
    if (err && (o['errorcode'] !== undefined || o['success'] === false || o['status'] === 'FAILED' || docNo)) { out.rejected.push({ docNo: docNo ?? 'An invoice', message: err }); return }
    for (const k of ['data', 'result', 'success', 'successlist', 'invoices', 'items', 'errors', 'errorlist', 'failure', 'failed']) if (o[k] !== undefined) walk(o[k], depth + 1)
  }
  walk(json, 0)
  return out
}

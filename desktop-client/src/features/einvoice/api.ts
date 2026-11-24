import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentApi } from '@/auth/session'
import { ApiError } from '@/api/errors'
import type { ReplyItem } from './reply'

export interface Issue { field: string; message: string; blocking: boolean }
export interface EInvoiceRecord { id: string; invoiceId: string; irn: string; ackNo: string; ackDate: string; signedQr: string; status: 'active' | 'cancelled'; cancelledAt: string | null; cancelReason: string | null }
export interface EwayRecord { id: string; invoiceId: string; billNo: string; billDate: string; validUntil: string | null; transportMode: string; distanceKm: number | null; vehicleNo: string | null; transporterId: string | null; transporterName: string | null; transDocNo: string | null; status: 'active' | 'cancelled'; cancelledAt: string | null }
export interface EInvoiceStatus { applicable: boolean; irn: string | null; record: EInvoiceRecord | null; issues: Issue[]; canFile: boolean; eway: EwayRecord[] }
export interface PendingRow { id: string; invoiceNo: string; documentType: string; invoiceDate: string; customerName: string; supplyType: string; grandTotal: string; irn: string | null; ackNo: string | null }
export interface Transport { mode: 'road' | 'rail' | 'air' | 'ship'; distanceKm: number; vehicleNo?: string; transporterId?: string; transporterName?: string; transDocNo?: string; transDocDate?: string }
export interface FileResult { fileName: string; invoices: unknown[]; included: { id: string; invoiceNo: string; irn: string }[]; skipped: { id: string; invoiceNo: string; issues: Issue[] }[] }
export interface ReplyOutcome { docNo: string | null; irn: string | null; result: 'recorded' | 'already_recorded' | 'unmatched' | 'invalid'; message: string }

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw

/** Failed answers keep their extra fields (which invoices were left out, and why), so a screen can show them. */
export class EInvoiceError extends ApiError { constructor(status: number, message: string, extra: Record<string, unknown>) { super(status, 'request_failed', message, undefined, [], extra) } }

async function send<T>(method: 'GET' | 'POST', path: string, o: { id?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const r = await raw()[method]!(path, { params: { ...(o.id ? { path: { id: o.id } } : {}), ...(o.query ? { query: o.query } : {}) }, ...(o.body !== undefined ? { body: o.body } : {}) })
  if (!r.response.ok) { const e = (r.error ?? {}) as Record<string, unknown>; const first = Array.isArray(e['errors']) ? ((e['errors'] as { message?: string }[])[0]?.message) : undefined; throw new EInvoiceError(r.response.status, first ?? (e['detail'] as string | undefined) ?? (e['title'] as string | undefined) ?? 'The request failed', e) }
  return r.data as T
}

export const useEInvoiceStatus = (id: string) => useQuery({ queryKey: ['einvoice', id], queryFn: () => send<EInvoiceStatus>('GET', '/v1/einvoice/invoices/{id}', { id }) })
export const usePendingEInvoices = (f: { from?: string; to?: string; state: 'pending' | 'issued' | 'all' }) =>
  useQuery({ queryKey: ['einvoice-pending', f], queryFn: () => send<{ items: PendingRow[] }>('GET', '/v1/einvoice/pending', { query: Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string> }) })

export function useEInvoiceActions(invoiceId?: string) {
  const qc = useQueryClient()
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['einvoice'] }), qc.invalidateQueries({ queryKey: ['einvoice-pending'] }), qc.invalidateQueries({ queryKey: ['invoice'] })])
  const m = <I, O>(fn: (i: I) => Promise<O>) => useMutation({ mutationFn: fn, onSuccess: refresh }) // eslint-disable-line react-hooks/rules-of-hooks
  return {
    file: m((ids: string[]) => send<FileResult>('POST', '/v1/einvoice/file', { body: { invoiceIds: ids } })),
    reply: m((items: ReplyItem[]) => send<{ outcomes: ReplyOutcome[]; recorded: number }>('POST', '/v1/einvoice/reply', { body: { items } })),
    record: m((b: { irn: string; ackNo: string; ackDate: string; signedQr: string }) => send<EInvoiceRecord>('POST', '/v1/einvoice/invoices/{id}/record', { id: invoiceId as string, body: b })),
    cancel: m((reason: string) => send<{ ok: true }>('POST', '/v1/einvoice/invoices/{id}/cancel', { id: invoiceId as string, body: { reason } })),
    ewayFile: m((t: Transport) => send<{ fileName: string; json: unknown; issues: Issue[] }>('POST', '/v1/eway/invoices/{id}/file', { id: invoiceId as string, body: t })),
    ewayCheck: (t: Transport) => send<{ issues: Issue[] }>('POST', '/v1/eway/invoices/{id}/check', { id: invoiceId as string, body: t }),
    ewayRecord: m((b: Record<string, unknown>) => send<{ ok: true }>('POST', '/v1/eway/invoices/{id}/record', { id: invoiceId as string, body: b })),
    ewayCancel: m(() => send<{ ok: true }>('POST', '/v1/eway/invoices/{id}/cancel', { id: invoiceId as string })),
  }
}

/** Saves text as a file through the browser's download (the desktop shell handles it like any other download). */
export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}

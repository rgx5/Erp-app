import { ApiError } from '@/api/errors'
import { currentApi } from '@/auth/session'

export type EntityType = 'item' | 'party' | 'sales_invoice' | 'sales_order' | 'sales_quote' | 'purchase_order' | 'supplier_bill' | 'expense_voucher'
export interface AttachmentMeta { id: string; entityType: string; entityId: string; kind: string; filename: string; contentType: string; sizeBytes: number; createdAt: string }

const MAX_EDGE = 1280
const MAX_PDF = 5 * 1024 * 1024
type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw

const toBase64 = (bytes: Uint8Array): string => { let s = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk)); return btoa(s) }

/** Phone and camera photos are several megabytes: shrink an image to at most 1280 pixels on its longest side, as a JPEG, before it is sent. A PDF is sent as it is. */
export async function prepareFile(file: File): Promise<{ filename: string; contentType: string; dataBase64: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF) throw new Error('A PDF can be at most 5 MB.')
    return { filename: file.name, contentType: 'application/pdf', dataBase64: toBase64(new Uint8Array(await file.arrayBuffer())) }
  }
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or WebP) or a PDF.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This computer could not prepare the photo.')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) throw new Error('This computer could not prepare the photo.')
  return { filename: file.name.replace(/\.[^.]+$/, '') + '.jpg', contentType: 'image/jpeg', dataBase64: toBase64(new Uint8Array(await blob.arrayBuffer())) }
}

const fail = (r: { error?: unknown; response: Response }): never => { const e = r.error as { detail?: string; title?: string } | undefined; throw new ApiError(r.response.status, 'request_failed', e?.detail ?? e?.title ?? 'The request failed') }

export async function listAttachments(entityType: EntityType, entityId: string): Promise<AttachmentMeta[]> {
  const r = await raw()['GET']!('/v1/attachments', { params: { query: { entityType, entityId } } })
  if (!r.response.ok) return fail(r)
  return (r.data as { items: AttachmentMeta[] }).items
}
export async function uploadAttachment(entityType: EntityType, entityId: string, kind: 'file' | 'photo', file: File): Promise<AttachmentMeta> {
  const prepared = await prepareFile(file)
  const r = await raw()['POST']!('/v1/attachments', { body: { entityType, entityId, kind, ...prepared } })
  if (!r.response.ok) return fail(r)
  return r.data as AttachmentMeta
}
export async function removeAttachment(id: string): Promise<void> {
  const r = await raw()['DELETE']!('/v1/attachments/{id}', { params: { path: { id } } })
  if (!r.response.ok) fail(r)
}
/** The file as a blob the page can show or save (the server wants the sign-in, so it cannot be a plain link). */
export async function fetchAttachmentBlob(id: string): Promise<Blob> {
  const r = await raw()['GET']!('/v1/attachments/{id}/content', { params: { path: { id } }, parseAs: 'blob' })
  if (!r.response.ok) return fail(r)
  return r.data as Blob
}

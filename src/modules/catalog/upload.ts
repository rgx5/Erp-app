/**
 * Uploading an attachment to the server (docs/SERVER.md: POST /files — raw bytes with a Content-Type and an X-Filename header,
 * answering { id, url, size }; max 10 MB; read back with GET /files/:id using the same sign-in). Photos are stored on the phone first so
 * taking one never waits for a connection; this uploads them when there is one. Reading the file and the network are passed in,
 * so the rule is testable and the screen decides where the bytes come from.
 */
import type { ItemAttachment } from './types'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export interface UploadDeps {
  /** The server's address, without a trailing slash. */
  baseUrl: string
  token: () => string | null
  /** The bytes of a file on this phone. */
  read: (uri: string) => Promise<Uint8Array>
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
}

export interface UploadResult { id: string; url: string; size: number }

/** A header value must be plain ASCII; the visible name stays in the document. */
const headerName = (name: string) => name.replace(/[^\x20-\x7e]+/g, '_').slice(0, 120) || 'file'

export const needsUpload = (a: ItemAttachment) => !a.remoteId

/** Where the uploaded file can be fetched from (sign-in required). */
export const fileUrl = (baseUrl: string, a: Pick<ItemAttachment, 'remoteId' | 'remoteUrl'>): string | null => {
  if (a.remoteUrl) return /^https?:\/\//i.test(a.remoteUrl) ? a.remoteUrl : `${baseUrl.replace(/\/+$/, '')}${a.remoteUrl.startsWith('/') ? '' : '/'}${a.remoteUrl}`
  return a.remoteId ? `${baseUrl.replace(/\/+$/, '')}/files/${a.remoteId}` : null
}

export async function uploadAttachment(a: Pick<ItemAttachment, 'uri' | 'name' | 'mime' | 'size'>, deps: UploadDeps): Promise<UploadResult> {
  if (a.size > MAX_UPLOAD_BYTES) throw new Error('The server takes files up to 10 MB. Make the photo smaller and add it again.')
  const token = deps.token()
  if (!token) throw new Error('Sign in to the server to upload.')
  const body = await deps.read(a.uri)
  if (body.byteLength > MAX_UPLOAD_BYTES) throw new Error('The server takes files up to 10 MB. Make the photo smaller and add it again.')
  const f = deps.fetch ?? ((url, init) => fetch(url, init as unknown as RequestInit))
  let res: Awaited<ReturnType<NonNullable<UploadDeps['fetch']>>>
  try {
    res = await f(`${deps.baseUrl.replace(/\/+$/, '')}/files`, { method: 'POST', headers: { 'Content-Type': a.mime || 'application/octet-stream', 'X-Filename': headerName(a.name), Authorization: `Bearer ${token}` }, body })
  } catch {
    throw new Error('Cannot reach the server — the file stays on this phone and can be uploaded later.')
  }
  const text = await res.text()
  let data: { id?: string; url?: string; size?: number; error?: string } = {}
  try { data = text ? JSON.parse(text) : {} } catch { /* not JSON */ }
  if (!res.ok) throw new Error(data.error ?? `The server refused the file (${res.status}).`)
  if (!data.id || !data.url) throw new Error('The server did not say where it saved the file.')
  return { id: data.id, url: data.url, size: data.size ?? body.byteLength }
}

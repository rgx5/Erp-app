/** The phone side of files: choosing, reading, keeping, sharing and uploading. Everything pure lives in ../sheet.ts and ../upload.ts. */
import { Platform, Share } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { getToken } from '@/data/auth'
import { normalizeKoshUrl } from '@/data/kosh/api'
import { perform, useApp } from '@/data/store'
import { listOf } from '@/data/state'
import { markUploaded } from '../ops'
import { needsUpload, uploadAttachment, type UploadDeps } from '../upload'
import type { ItemAttachment } from '../types'

export interface Picked { uri: string; name: string; mime: string; size: number }

/** Opens the system file chooser. Returns null if the person backs out. */
export async function pickFile(type: string | string[]): Promise<Picked | null> {
  const r = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true, multiple: false })
  const a = r.canceled ? null : r.assets?.[0]
  return a ? { uri: a.uri, name: a.name, mime: a.mimeType ?? '', size: a.size ?? 0 } : null
}

export async function readText(uri: string): Promise<string> {
  if (Platform.OS === 'web') return (await fetch(uri)).text()
  return new File(uri).text()
}

export async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer())
  return new File(uri).bytes()
}

/** Moves a picked or photographed file somewhere that survives the cache being cleared. */
export async function keepFile(uri: string, name: string): Promise<string> {
  if (Platform.OS === 'web') return uri
  const dir = new Directory(Paths.document, 'catalog')
  if (!dir.exists) dir.create({ idempotent: true })
  const dest = new File(dir, `${Date.now()}-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}`)
  new File(uri).copy(dest)
  return dest.uri
}

export function dropFile(uri: string) {
  if (Platform.OS === 'web' || !uri.startsWith('file:')) return
  try { const f = new File(uri); if (f.exists) f.delete() } catch { /* already gone */ }
}

/** Hands a binary file (an .xlsx) to the person: a download on the web, the share sheet on a phone. */
export async function shareBytes(name: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return
  }
  const file = new File(Paths.cache, name)
  if (file.exists) file.delete()
  file.create()
  await file.write(bytes)
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name })
  else await Share.share({ message: name })
}

/** The OneSync server this phone talks to, or null (an offline workspace has nowhere to upload to). */
export function uploadTarget(): { baseUrl: string } | null {
  const ws = useApp.getState().workspace
  return ws?.mode === 'remote' && ws.backend === 'kosh' && ws.apiUrl ? { baseUrl: normalizeKoshUrl(ws.apiUrl) } : null
}

/** What image/file requests to the server need (the files are private to the business). */
export const authHeaders = (): Record<string, string> => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {} }

const deps = (baseUrl: string): UploadDeps => ({ baseUrl, token: getToken, read: readBytes })

/** Uploads one attachment and records it. Returns an error message, or null on success. */
export async function uploadOne(a: ItemAttachment): Promise<string | null> {
  const t = uploadTarget()
  if (!t) return 'Connect this phone to a OneSync server to upload.'
  try {
    const r = await uploadAttachment(a, deps(t.baseUrl))
    perform((s, ctx) => markUploaded(s, a.id, { id: r.id, url: r.url }, ctx))
    return null
  } catch (e) { return e instanceof Error ? e.message : 'Could not upload' }
}

/** Uploads everything that has not been uploaded yet. */
export async function uploadAllPending(): Promise<{ done: number; failed: number; message?: string }> {
  let done = 0, failed = 0, message: string | undefined
  for (const a of listOf(useApp.getState().data.itemAttachments ?? {}).filter(needsUpload)) {
    const err = await uploadOne(a)
    if (err) { failed++; message ??= err; if (/Connect|Sign in|Cannot reach/.test(err)) break } else done++
  }
  return { done, failed, message }
}

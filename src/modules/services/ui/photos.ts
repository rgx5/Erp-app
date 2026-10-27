import { Platform } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'

/**
 * Photos for a job card or a visit report: chosen (or taken, from the system chooser on a phone) with the same document picker the
 * catalogue uses, then copied somewhere that survives the cache being cleared. The file stays on this phone; only its name travels.
 */
export async function pickPhoto(): Promise<string | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false })
  const a = r.canceled ? null : r.assets?.[0]
  if (!a) return null
  return keep(a.uri, a.name)
}

async function keep(uri: string, name: string): Promise<string> {
  if (Platform.OS === 'web') return uri
  const dir = new Directory(Paths.document, 'services')
  if (!dir.exists) dir.create({ idempotent: true })
  const dest = new File(dir, `${Date.now()}-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}`)
  new File(uri).copy(dest)
  return dest.uri
}

export function dropPhoto(uri: string) {
  if (Platform.OS === 'web' || !uri.startsWith('file:')) return
  try { const f = new File(uri); if (f.exists) f.delete() } catch { /* already gone */ }
}

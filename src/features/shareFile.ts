import { Platform, Share } from 'react-native'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { toast } from '@/ui/overlays'

/**
 * Hands a text file (CSV report, JSON backup) to the person: a download in the browser preview, the system share sheet
 * on a phone (save to Files/Drive, send on WhatsApp or email). If a file cannot be made, the text itself is shared.
 */
export async function shareFile(name: string, content: string, mime = 'text/csv'): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }
    const file = new File(Paths.cache, name)
    if (file.exists) file.delete()
    file.create()
    await file.write(content)
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name })
    else await Share.share({ message: content, title: name })
  } catch {
    try { await Share.share({ message: content, title: name }) } catch { toast('Could not share the file', 'err') }
  }
}

import { Linking, Platform, Share } from 'react-native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { toast } from '@/ui/overlays'

/** Sends a document (receipt, invoice, report) out of the app: print it, save it as a PDF, share it, or WhatsApp it. */

/**
 * expo-print's web implementation does not take the `html` it is given at all — it just calls the browser's
 * `window.print()` on whatever is already on screen (confirmed in `expo-print`'s own source). On a phone that is
 * invisible, because the native module prints the given document; on web and desktop it means every "Print" button
 * printed the live app screen — sidebar and buttons included — never the receipt. This opens the document in a
 * window of its own and prints that instead, which is the standard way to print specific content from a web page.
 */
function printHtmlOnWeb(html: string): Promise<void> {
  return new Promise((resolve) => {
    const win = window.open('', '_blank', 'width=820,height=1000')
    if (!win) { toast('Allow pop-ups for this site to print', 'err'); resolve(); return }
    win.document.open()
    win.document.write(html)
    win.document.close()
    let printed = false
    const go = () => {
      if (printed) return
      printed = true
      win.focus()
      win.print()
      resolve()
    }
    // onload is the normal signal that the written document (and its fonts/images) is ready; a short fallback
    // covers browsers that do not fire it for a document built with document.write.
    win.onload = go
    setTimeout(go, 400)
  })
}

export async function printHtml(html: string): Promise<void> {
  if (Platform.OS === 'web') { await printHtmlOnWeb(html); return }
  try {
    await Print.printAsync({ html })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    // Cancelling the system print sheet is not an error worth shouting about.
    if (!/cancel/i.test(msg)) toast('Could not open the printer', 'err')
  }
}

/** Renders HTML to a PDF and opens the share sheet (WhatsApp, email, Drive…). On web there is no "render to a PDF
 * file" API to speak of — the browser's own print dialog's "Save as PDF" destination is what stands in for it,
 * same as `printHtml`, so this shares that code path rather than (as it used to) printing the live screen. */
export async function sharePdf(html: string, name: string, opts: { width?: number; height?: number } = {}): Promise<void> {
  try {
    if (Platform.OS === 'web') { await printHtmlOnWeb(html); return }
    const { uri } = await Print.printToFileAsync({ html, width: opts.width ?? 595, height: opts.height ?? 842 })
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: name, UTI: 'com.adobe.pdf' })
    else toast('Sharing is not available on this device', 'err')
  } catch {
    toast('Could not create the PDF', 'err')
  }
}

/** Opens WhatsApp to a number with the text filled in; falls back to the system share sheet. */
export async function whatsApp(text: string, phone?: string): Promise<void> {
  const digits = (phone ?? '').replace(/\D/g, '')
  const number = digits.length === 10 ? `91${digits}` : digits
  const url = number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`
  try {
    if (await Linking.canOpenURL(url)) { await Linking.openURL(url); return }
  } catch { /* fall through to the share sheet */ }
  try { await Share.share({ message: text }) } catch { toast('Could not share', 'err') }
}

export async function shareText(text: string, title?: string): Promise<void> {
  try { await Share.share({ message: text, title }) } catch { toast('Could not share', 'err') }
}

import { Linking, Platform, Share } from 'react-native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { toast } from '@/ui/overlays'

/** Sends a document (receipt, invoice, report) out of the app: print it, save it as a PDF, share it, or WhatsApp it. */

export async function printHtml(html: string): Promise<void> {
  try {
    await Print.printAsync({ html })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    // Cancelling the system print sheet is not an error worth shouting about.
    if (!/cancel/i.test(msg)) toast('Could not open the printer', 'err')
  }
}

/** Renders HTML to a PDF and opens the share sheet (WhatsApp, email, Drive…). */
export async function sharePdf(html: string, name: string, opts: { width?: number; height?: number } = {}): Promise<void> {
  try {
    if (Platform.OS === 'web') { await Print.printAsync({ html }); return }
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

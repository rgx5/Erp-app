/** Reads a weight from one line of text a bench scale sends over its serial cable. Handles the common layouts; returns kilograms. */
export function parseScaleLine(line: string): { kg: number; stable: boolean } | null {
  const text = line.trim()
  if (!text) return null
  // A&D, CAS, Mettler style: "ST,GS,  0.500kg"  /  "US,GS,  0.502kg"   Others: "+001.250kg", "W: 1.250 kg", "  0.500 kg", "ST GS 0.500 g"
  const m = /([-+]?\d+(?:\.\d+)?)\s*(kg|g|lb)?\b/i.exec(text.replace(/^(ST|US|NT|GS)[ ,]*/i, '').replace(/^(ST|US|NT|GS)[ ,]*/i, '').replace(/^[A-Za-z]+:\s*/, ''))
  if (!m || m[1] === undefined) return null
  let value = Number(m[1])
  if (!Number.isFinite(value) || value < 0) return null
  const unit = (m[2] ?? 'kg').toLowerCase()
  if (unit === 'g') value /= 1000
  else if (unit === 'lb') value *= 0.45359237
  const unstable = /^(US|UN)\b/i.test(text) || /\b(motion|unstable)\b/i.test(text)
  return { kg: Math.round(value * 1000) / 1000, stable: !unstable }
}

interface SerialPortLike { open(o: { baudRate: number }): Promise<void>; close(): Promise<void>; readable: ReadableStream<Uint8Array> | null }
interface SerialLike { requestPort(): Promise<SerialPortLike> }
const serial = (): SerialLike | undefined => (navigator as unknown as { serial?: SerialLike }).serial

export const scaleSupported = (): boolean => serial() !== undefined

let port: SerialPortLike | null = null

/** Asks for the scale (the shell picks the port: the saved one, or the only one, or asks), then reads lines until the weight holds steady twice in a row. Resolves in kilograms. */
export async function weighOnce(opts: { baudRate?: number; timeoutMs?: number } = {}): Promise<number> {
  const api = serial()
  if (!api) throw new Error('This computer cannot talk to a scale from here. Use the desktop app on the counter computer.')
  try { port = port ?? (await api.requestPort()); await port.open({ baudRate: opts.baudRate ?? 9600 }) } catch (e) {
    if (e instanceof DOMException && e.name === 'InvalidStateError') { /* already open */ }
    else { port = null; throw new Error(e instanceof DOMException && e.name === 'NotFoundError' ? 'No scale was found. Check the cable and that it is switched on.' : 'Could not open the scale.') }
  }
  const p = port as SerialPortLike
  if (!p.readable) throw new Error('The scale is not sending anything.')
  const reader = p.readable.getReader(); const decoder = new TextDecoder()
  let buffer = ''; let last: number | null = null; let steady = 0
  const deadline = Date.now() + (opts.timeoutMs ?? 6000)
  try {
    for (;;) {
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('The scale did not settle. Make sure the weight is still and try again.')
      const chunk = await Promise.race([reader.read(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('The scale did not settle. Make sure the weight is still and try again.')), left))])
      if (chunk.done) throw new Error('The scale stopped sending.')
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split(/[\r\n]+/); buffer = lines.pop() ?? ''
      for (const l of lines) {
        const w = parseScaleLine(l)
        if (!w || !w.stable) { steady = 0; last = null; continue }
        if (last !== null && w.kg === last) steady++; else { steady = 1; last = w.kg }
        if (steady >= 2) { if (w.kg <= 0) { steady = 0; last = null; continue } return w.kg }
      }
    }
  } finally { reader.releaseLock(); await p.close().catch(() => undefined); }
}

export const DISPLAY_CHANNEL = 'onesync-counter-display'
export type DisplayMessage =
  | { type: 'cart'; shop: string; lines: { name: string; qty: string; amount: string }[]; total: string }
  | { type: 'done'; shop: string; total: string; change: string }
  | { type: 'idle'; shop: string }
  | { type: 'hello' }

/** Sends what the customer should see to the display window (same computer, same app: no server involved). */
export function publishDisplay(m: DisplayMessage): void {
  try { const c = new BroadcastChannel(DISPLAY_CHANNEL); c.postMessage(m); c.close() } catch { /* no display open */ }
}
export function listenDisplay(onMessage: (m: DisplayMessage) => void): () => void {
  try { const c = new BroadcastChannel(DISPLAY_CHANNEL); c.onmessage = (e: MessageEvent<DisplayMessage>) => onMessage(e.data); return () => c.close() } catch { return () => undefined }
}

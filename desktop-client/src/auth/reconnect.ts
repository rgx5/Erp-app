import type { QueryClient } from '@tanstack/react-query'
import { useReachability } from '@/api/reachability'
import { markReachable } from '@/api/reachability'
import { useSession } from './session'

let client: QueryClient | null = null

/** Asks the server's health address once. True when something answered properly. */
async function ping(): Promise<boolean> {
  const url = useSession.getState().server?.url
  if (!url) return false
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000)
  try { const r = await fetch(`${url}/health`, { signal: ctl.signal, cache: 'no-store' }); return r.status < 500 } catch { return false } finally { clearTimeout(timer) }
}

/** Tries the server now. When it answers: the banner clears, who is signed in is confirmed, and every screen refreshes its data. Resolves to whether it answered. */
export async function retryNow(): Promise<boolean> {
  useReachability.setState({ checking: true })
  try {
    if (!(await ping())) return false
    markReachable()
    const s = useSession.getState()
    if (s.status === 'authenticated' && s.offlineStart) await s.refreshMe().catch(() => undefined)
    await client?.invalidateQueries()
    return true
  } finally { useReachability.setState({ checking: false }) }
}

/** While the server cannot be reached, look again every few seconds (and the moment the computer's network returns), so the app heals itself. */
export function startReconnectWatch(queryClient: QueryClient): void {
  client = queryClient
  setInterval(() => { if (useReachability.getState().down && !useReachability.getState().checking) void retryNow() }, 8000)
  if (typeof window !== 'undefined') window.addEventListener('online', () => { void retryNow() })
}

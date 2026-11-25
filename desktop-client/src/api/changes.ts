import type { QueryClient } from '@tanstack/react-query'
import { currentApi, useSession } from '@/auth/session'

/**
 * The server tells open screens when something changed for this business, so they refresh themselves instead of asking again and again.
 * While the stream is connected data stays fresh for a minute (fewer requests); when it is not, the app falls back to the shorter freshness
 * and refreshing on focus it always had. The notes carry area names only, never records. Any failure just means "not connected": nothing breaks.
 */
export const FRESH_WITH_PUSH = 60_000
export const FRESH_WITHOUT = 15_000

/** Parses the lines of an event stream into the data of each complete event. */
export function* eventData(buffer: string): Generator<{ data: string; rest: string }> {
  let rest = buffer
  for (;;) {
    const end = rest.indexOf('\n\n')
    if (end < 0) return
    const block = rest.slice(0, end); rest = rest.slice(end + 2)
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
    yield { data, rest }
  }
}

export function startChangeStream(queryClient: QueryClient): void {
  let stop: (() => void) | null = null
  let scope = ''
  const setFresh = (ms: number): void => { queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, staleTime: ms } }) }

  const run = (key: string): (() => void) => {
    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 2000
    const refresh = (): void => {
      if (timer) return
      timer = setTimeout(() => { timer = undefined; void queryClient.invalidateQueries({ refetchType: 'active', predicate: (q) => q.state.dataUpdatedAt < Date.now() - 1500 }) }, 300)
    }
    void (async () => {
      while (!ctl.signal.aborted) {
        try {
          const res = await currentApi().stream('/v1/events', ctl.signal)
          if (!res.ok || !res.body) throw new Error(String(res.status))
          const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream: true })
            for (const ev of eventData(buf)) {
              buf = ev.rest
              if (!ev.data) continue
              const note = JSON.parse(ev.data) as { areas?: string[]; hello?: boolean }
              if (note.hello) { setFresh(FRESH_WITH_PUSH); delay = 2000 } else if (note.areas?.length) refresh()
            }
          }
        } catch { /* not connected (or stopped) */ }
        setFresh(FRESH_WITHOUT)
        if (ctl.signal.aborted) return
        await new Promise((r) => setTimeout(r, delay)); delay = Math.min(delay * 2, 60_000)
      }
    })()
    void key
    return () => { ctl.abort(); if (timer) clearTimeout(timer); setFresh(FRESH_WITHOUT) }
  }

  const apply = (): void => {
    const s = useSession.getState()
    const next = s.status === 'authenticated' && s.tenant && s.api ? `${s.server?.url ?? ''}|${s.tenant}` : ''
    if (next === scope) return
    stop?.(); stop = null; scope = next
    if (next) stop = run(next)
  }
  apply()
  useSession.subscribe(apply)
}

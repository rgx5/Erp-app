import { persistQueryClient, type PersistedClient, type Persister } from '@tanstack/react-query-persist-client'
import type { Query, QueryClient } from '@tanstack/react-query'
import { clearTenant, loadMeta, saveMeta } from '@/features/pos/localDb'
import { useSession } from '@/auth/session'

/**
 * What the counter needs to open with no connection, kept on this computer between runs: the company and its registrations, the terminal, the
 * open shift, the price lists and their prices. Nothing else is kept (no customers, invoices or reports): a screen that needs the server says so.
 */
const ROOTS = new Set(['companies', 'gst-registrations', 'business-locations', 'warehouses', 'price-lists', 'prices'])
const POS_PARTS = new Set(['terminals', 'settings', 'shifts', 'devices'])
export const worthKeeping = (key: readonly unknown[]): boolean => (typeof key[0] === 'string' && ROOTS.has(key[0])) || (key[0] === 'pos' && typeof key[1] === 'string' && POS_PARTS.has(key[1]))
const MAX_AGE = 7 * 24 * 3_600_000

const persisterFor = (scope: string): Persister => ({
  persistClient: async (client: PersistedClient) => { await saveMeta(scope, 'query-cache', client) },
  restoreClient: async () => loadMeta<PersistedClient>(scope, 'query-cache'),
  removeClient: async () => { await saveMeta(scope, 'query-cache', undefined) },
})

/** Starts and stops the on-disk copy as people sign in and out. Signing out erases it. */
export function startOfflineCache(queryClient: QueryClient): void {
  let stop: (() => void) | null = null
  let scope = ''
  const begin = (next: string): void => {
    if (stop && scope === next) return
    stop?.(); scope = next
    const [unsubscribe] = persistQueryClient({
      queryClient, persister: persisterFor(next), maxAge: MAX_AGE, buster: 'v1',
      dehydrateOptions: { shouldDehydrateQuery: (q: Query) => q.state.status === 'success' && worthKeeping(q.queryKey) },
    })
    stop = unsubscribe
  }
  const apply = (): void => {
    const s = useSession.getState()
    if (s.status === 'authenticated' && s.tenant) begin(`cache:${s.server?.url ?? ''}|${s.tenant}`)
    else if (stop) { stop(); stop = null; if (scope) void clearTenant(scope); scope = '' }
  }
  apply()
  useSession.subscribe(apply)
}

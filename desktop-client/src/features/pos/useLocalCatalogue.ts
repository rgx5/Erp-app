import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NetworkError } from '@/api/errors'
import { buildIndex, type CatalogueIndex, type LocalItem } from './catalogueSearch'
import { loadAll, loadMeta, saveAll, saveMeta } from './localDb'
import { fetchCatalogue } from './queries'

const FIVE_MINUTES = 5 * 60_000
const FULL_REFRESH_AFTER = 24 * 3_600_000
interface SyncMeta { since?: string | undefined; fullAt?: string | undefined; at?: string | undefined }

export interface LocalCatalogue {
  /** The items on this computer, ready to search. Empty until the first load finishes. */
  index: CatalogueIndex
  /** True once what is already on this computer has been read (the counter can search at once, even offline). */
  ready: boolean
  /** How many items are on this computer. */
  count: number
  /** When the items were last brought up to date with the server. */
  lastSyncAt: string | null
  syncing: boolean
  /** Why the last update failed, when it did (offline is not an error: the counter keeps working from what it has). */
  problem: string | null
  /** Brings the items up to date now (`full` downloads everything again). Resolves with how many items arrived. */
  syncNow(full?: boolean): Promise<number | null>
}

/**
 * The counter's item list, kept on this computer and refreshed in the background, so finding an item never waits for the server. The first time a
 * counter opens it downloads everything once; after that it only asks for what changed since the last update (every five minutes, when the
 * connection returns, or on request), and downloads in full once a day to drop items that were withdrawn.
 */
export function useLocalCatalogue(tenant: string, deviceId: string | undefined): LocalCatalogue {
  const [items, setItems] = useState<LocalItem[]>([])
  const [ready, setReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const itemsRef = useRef<LocalItem[]>([]); itemsRef.current = items
  const running = useRef(false)
  const index = useMemo(() => buildIndex(items), [items])

  const syncNow = useCallback(async (full = false): Promise<number | null> => {
    if (!deviceId || running.current) return null
    running.current = true; setSyncing(true)
    try {
      const meta = (await loadMeta<SyncMeta>(tenant, 'sync')) ?? {}
      const everything = full || !meta.since || !meta.fullAt || Date.now() - Date.parse(meta.fullAt) > FULL_REFRESH_AFTER
      const cat = await fetchCatalogue(deviceId, everything ? undefined : meta.since)
      const codes = new Map<string, string[]>()
      for (const b of cat.barcodes ?? []) { const l = codes.get(b.itemId); if (l) l.push(b.barcode); else codes.set(b.itemId, [b.barcode]) }
      const incoming: LocalItem[] = cat.items.map((i) => ({ id: i.id, code: i.code, name: i.name, taxCodeId: i.taxCodeId, tracking: i.tracking, mrp: i.mrp ?? null, noDiscount: i.noDiscount === true, barcodes: codes.get(i.id) ?? [], active: i.status === 'active' }))
      let next: LocalItem[]; let changed: LocalItem[]
      if (everything) { next = incoming; changed = incoming }
      else {
        const map = new Map(itemsRef.current.map((i) => [i.id, i]))
        const touched = new Map<string, LocalItem>(incoming.map((i) => [i.id, i]))
        for (const i of incoming) map.set(i.id, i)
        // barcodes are sent in full every time, so an item whose barcodes changed is updated even if the item itself did not
        for (const [id, item] of map) { const bc = codes.get(id) ?? []; if (bc.join('|') !== item.barcodes.join('|')) { const upd = { ...item, barcodes: bc }; map.set(id, upd); touched.set(id, upd) } }
        next = [...map.values()]; changed = [...touched.values()]
      }
      setItems(next)
      await saveAll(tenant, changed, everything)
      const at = new Date().toISOString()
      await saveMeta(tenant, 'sync', { since: new Date(Date.parse(cat.serverTime) - 120_000).toISOString(), fullAt: everything ? at : meta.fullAt, at } satisfies SyncMeta)
      setLastSyncAt(at); setProblem(null)
      return incoming.length
    } catch (e) {
      setProblem(e instanceof NetworkError ? null : e instanceof Error ? e.message : 'Could not update the items.')
      return null
    } finally { running.current = false; setSyncing(false) }
  }, [tenant, deviceId])

  // read what is already on this computer first, then bring it up to date
  useEffect(() => {
    let live = true
    setReady(false)
    void (async () => {
      const [stored, meta] = await Promise.all([loadAll<LocalItem>(tenant), loadMeta<SyncMeta>(tenant, 'sync')])
      if (!live) return
      setItems(stored); setLastSyncAt(meta?.at ?? null); setReady(true)
      void syncNow()
    })()
    return () => { live = false }
  }, [tenant, syncNow])

  useEffect(() => {
    if (!deviceId) return
    const tick = (): void => { if (document.visibilityState === 'visible' && navigator.onLine) void syncNow() }
    const timer = setInterval(tick, FIVE_MINUTES)
    window.addEventListener('online', tick)
    return () => { clearInterval(timer); window.removeEventListener('online', tick) }
  }, [deviceId, syncNow])

  return { index, ready, count: index.items.length, lastSyncAt, syncing, problem, syncNow }
}

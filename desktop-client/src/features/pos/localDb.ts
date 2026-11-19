/**
 * The counter's own database on this computer (IndexedDB): the item catalogue and a few small facts about it. IndexedDB because a shop can have tens
 * of thousands of items, far more than localStorage's few megabytes, and because reading it does not block the screen. If the browser refuses
 * it (private mode, no room), everything still works from memory for the session and the counter simply downloads again next time.
 */
const DB = 'onesync-counter'
const ITEMS = 'items'
const META = 'meta'

let opened: Promise<IDBDatabase | null> | null = null
function open(): Promise<IDBDatabase | null> {
  if (opened) return opened
  opened = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore(ITEMS, { keyPath: 'key' }); db.createObjectStore(META, { keyPath: 'key' }) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return opened
}

// the fallback when IndexedDB is unavailable
const memItems = new Map<string, Record<string, unknown>>()
const memMeta = new Map<string, unknown>()

const done = <T>(r: IDBRequest<T>): Promise<T> => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error) })
const range = (tenant: string): IDBKeyRange => IDBKeyRange.bound(`${tenant}|`, `${tenant}|￿`)

export async function loadAll<T>(tenant: string): Promise<T[]> {
  const db = await open()
  if (!db) return [...memItems.entries()].filter(([k]) => k.startsWith(`${tenant}|`)).map(([, v]) => v.value as T)
  try { return ((await done(db.transaction(ITEMS).objectStore(ITEMS).getAll(range(tenant)))) as { value: T }[]).map((r) => r.value) } catch { return [] }
}

/** Adds or replaces items; with `replace`, anything not in the list is removed (a full refresh). */
export async function saveAll<T extends { id: string }>(tenant: string, items: T[], replace: boolean): Promise<void> {
  const db = await open()
  if (!db) {
    if (replace) for (const k of memItems.keys()) if (k.startsWith(`${tenant}|`)) memItems.delete(k)
    for (const i of items) memItems.set(`${tenant}|${i.id}`, { key: `${tenant}|${i.id}`, value: i })
    return
  }
  await new Promise<void>((ok, fail) => {
    const tx = db.transaction(ITEMS, 'readwrite'); const store = tx.objectStore(ITEMS)
    if (replace) store.delete(range(tenant))
    for (const i of items) store.put({ key: `${tenant}|${i.id}`, value: i })
    tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error)
  }).catch(() => undefined)
}

export async function loadMeta<T>(tenant: string, name: string): Promise<T | undefined> {
  const db = await open(); const key = `${tenant}|${name}`
  if (!db) return memMeta.get(key) as T | undefined
  try { return ((await done(db.transaction(META).objectStore(META).get(key))) as { value: T } | undefined)?.value } catch { return undefined }
}
export async function saveMeta(tenant: string, name: string, value: unknown): Promise<void> {
  const db = await open(); const key = `${tenant}|${name}`
  if (!db) { memMeta.set(key, value); return }
  try { await done(db.transaction(META, 'readwrite').objectStore(META).put({ key, value })) } catch { /* not kept */ }
}

/** Forget everything kept for a business on this computer (signing out of a shared computer). */
export async function clearTenant(tenant: string): Promise<void> {
  const db = await open()
  if (!db) { for (const k of memItems.keys()) if (k.startsWith(`${tenant}|`)) memItems.delete(k); for (const k of memMeta.keys()) if (k.startsWith(`${tenant}|`)) memMeta.delete(k); return }
  try { const tx = db.transaction([ITEMS, META], 'readwrite'); tx.objectStore(ITEMS).delete(range(tenant)); tx.objectStore(META).delete(range(tenant)) } catch { /* nothing to clear */ }
}

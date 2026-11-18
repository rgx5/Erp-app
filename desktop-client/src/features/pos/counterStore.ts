/**
 * What a counter keeps on this computer: which price list it sells from, the registered device, the catalogue for selling without a
 * connection, and the sales waiting to be uploaded. All of it is best-effort: when storage is unavailable the counter still sells online.
 */
export interface QueuedSale { clientId: string; shiftId: string; occurredAt: string; payload: unknown; label: string; total: string; error?: string }
export interface CachedItem { id: string; code: string; name: string; taxCodeId: string | null; price: string | null; taxInclusive: boolean }
export interface CounterState { priceListId?: string; deviceId?: string; terminalId?: string }

const K = (tenant: string, name: string): string => `onesync.counter.${tenant}.${name}`
function read<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback } }
function write(key: string, value: unknown): boolean { try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false } }

export const counterState = (tenant: string): CounterState => read<CounterState>(K(tenant, 'state'), {})
export const saveCounterState = (tenant: string, patch: Partial<CounterState>): void => { write(K(tenant, 'state'), { ...counterState(tenant), ...patch }) }
export const loadQueue = (tenant: string): QueuedSale[] => read<QueuedSale[]>(K(tenant, 'queue'), [])
export const saveQueue = (tenant: string, q: QueuedSale[]): boolean => write(K(tenant, 'queue'), q)
export const loadCatalogue = (tenant: string): CachedItem[] => read<CachedItem[]>(K(tenant, 'catalogue'), [])
export const saveCatalogue = (tenant: string, items: CachedItem[]): boolean => write(K(tenant, 'catalogue'), items)

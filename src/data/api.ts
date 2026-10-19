import type {
  Bill, Category, Coupon, Customer, DaySession, Expense, Product, Purchase, Role, StockMove, StoreSettings, Supplier, Variant,
} from '@/domain/types'

/** What `GET /sync/snapshot` returns — one consistent, role-filtered copy of a store. */
export interface Snapshot {
  serverTime: number
  store: (StoreSettings & { plan?: string }) | null
  users: Array<{ id: string; name: string; role: Role; active: boolean; code?: string }>
  categories: Category[]
  products: Product[]
  variants: Variant[]
  customers: Customer[]
  coupons?: Coupon[]
  bills: Bill[]
  suppliers: Supplier[]
  purchases: Purchase[]
  moves: StockMove[]
  expenses: Expense[]
  sessions: DaySession[]
}

export interface LoginResult {
  token: string
  user: { id: string; name: string; role: Role; storeId: string; superAdmin?: boolean }
  store: { id: string; name: string }
}

export class CloudError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
    this.name = 'CloudError'
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** A machine on this phone's own network (localhost, 192.168.x.x, a .local name): the only place plain http is the sensible default. */
const isPrivateHost = (addr: string) => /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^/:]+\.local)(:\d+)?(\/|$)/i.test(addr)

/**
 * The server's address as the app will call it. People type `billing.example.com` or `https://billing.example.com/`, but the
 * API lives under `/api`, so a bare host gets that added; an address that already has a path (`…/api`, `…/billing/api`) is
 * left exactly as typed.
 */
export const normalizeApiUrl = (raw: string) => {
  let u = raw.trim().replace(/\/+$/, '')
  if (!u) return u
  if (!/^https?:\/\//i.test(u)) u = `${isPrivateHost(u) ? 'http' : 'https'}://${u}`
  try { if (new URL(u).pathname === '/') u += '/api' } catch { /* not a URL yet: leave it for the connection error to explain */ }
  return u
}

/** The cloud API: JSON in, `{ error }` out. Every error becomes a CloudError with the HTTP status (0 = unreachable). */
export function createApi(baseUrl: string, getToken: () => string | null = () => null, fetchFn: FetchFn = (i, n) => fetch(i, n)) {
  const base = normalizeApiUrl(baseUrl)

  async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) }
    const token = auth ? getToken() : null
    if (token) headers.Authorization = `Bearer ${token}`
    let res: Response
    try {
      res = await fetchFn(`${base}${path}`, { ...init, headers })
    } catch {
      throw new CloudError('Cannot reach the server — check your internet connection and the server address.')
    }
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { /* a non-JSON error page */ }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error
      throw new CloudError(msg ?? `Server error (${res.status})`, res.status)
    }
    return data as T
  }

  return {
    base,
    health: () => call<{ ok: boolean }>('/health', {}, false),
    webLogin: (email: string, password: string) =>
      call<LoginResult>('/auth/web-login', { method: 'POST', body: JSON.stringify({ email, password }) }, false),
    pinLogin: (storeId: string, userId: string, pin: string) =>
      call<LoginResult>('/auth/login', { method: 'POST', body: JSON.stringify({ storeId, userId, pin }) }, false),
    staff: (storeId: string) =>
      call<Array<{ id: string; name: string; role: Role; active: boolean; code?: string }>>(`/users?storeId=${encodeURIComponent(storeId)}`, {}, false),
    refresh: () => call<{ token: string }>('/auth/refresh', { method: 'POST' }),
    snapshot: () => call<Snapshot>('/sync/snapshot'),
    bill: (id: string) => call<Bill>(`/bills/${encodeURIComponent(id)}`),
    /** Raw call used by the outbox flusher; returns the Response so it can read the status itself. */
    raw: async (method: string, path: string, body?: unknown): Promise<Response> => {
      const token = getToken()
      try {
        return await fetchFn(`${base}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        })
      } catch {
        throw new CloudError('Cannot reach the server.')
      }
    },
  }
}

export type Api = ReturnType<typeof createApi>

/** Reads a claim out of a token this app already holds (the server signed it; nothing here trusts it for access). */
export function tokenClaim(token: string | null, claim: string): unknown {
  if (!token) return undefined
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof atob === 'function' ? atob(part) : Buffer.from(part, 'base64').toString('utf8')
    return JSON.parse(json)[claim]
  } catch { return undefined }
}

/** Milliseconds until the token expires (0 if unreadable or already expired). */
export function tokenLifeMs(token: string | null, now = Date.now()): number {
  const exp = tokenClaim(token, 'exp') as number | undefined
  return exp ? Math.max(0, exp * 1000 - now) : 0
}

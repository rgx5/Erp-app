/** An error answered by the server as problem+json (`code`, `status`, `detail`, optional per-field `errors`, and any extra facts). */
export interface FieldError { path: string; message: string }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly errors: FieldError[] = [],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get isConflict(): boolean { return this.status === 409 || this.status === 412 }
  get isUnauthorized(): boolean { return this.status === 401 }
  get isForbidden(): boolean { return this.status === 403 }

  /** Field errors keyed by field path, ready for a form. */
  fieldMap(): Record<string, string> { return Object.fromEntries(this.errors.map((e) => [e.path, e.message])) }
}

/** The server was not reached at all (offline, wrong address, TLS failure). */
export class NetworkError extends Error {
  constructor(message = 'Cannot reach the server. Check the address and your connection.') {
    super(message)
    this.name = 'NetworkError'
  }
}

const KNOWN = new Set(['type', 'title', 'status', 'detail', 'code', 'instance', 'requestId', 'errors'])

export function problemToError(status: number, body: unknown, requestId?: string | null): ApiError {
  const p = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const errors = Array.isArray(p['errors']) ? (p['errors'] as unknown[]).flatMap((e) => (e && typeof e === 'object' && typeof (e as FieldError).path === 'string' && typeof (e as FieldError).message === 'string' ? [{ path: (e as FieldError).path, message: (e as FieldError).message }] : [])) : []
  const extra = Object.fromEntries(Object.entries(p).filter(([k]) => !KNOWN.has(k)))
  const detail = typeof p['detail'] === 'string' ? p['detail'] : typeof p['title'] === 'string' ? p['title'] : `Request failed (${status})`
  return new ApiError(status, typeof p['code'] === 'string' ? p['code'] : 'error', detail, (typeof p['requestId'] === 'string' ? p['requestId'] : requestId) ?? undefined, errors, extra)
}

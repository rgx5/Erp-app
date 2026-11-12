import { HttpException } from '@nestjs/common';
import { AppError } from './errors.js';

/** RFC 9457 "problem details". */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  retryable?: boolean;
  /** The violated database constraint, for 409/422 conflicts. Names, never values. */
  constraint?: string;
  errors?: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  412: 'Precondition failed',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable content',
  428: 'Precondition required',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

const HTTP_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'too_many_requests',
};

const problem = (status: number, code: string, detail: string, extra: Partial<Problem> = {}): Problem => ({
  type: `urn:erp:error:${code}`,
  title: TITLES[status] ?? 'Error',
  status,
  detail,
  code,
  ...extra,
});

interface PgLikeError {
  code: string;
  constraint?: string;
}

/** Drizzle wraps driver errors in `cause`; walk the chain to the PostgreSQL error, if any. */
export function findPgError(error: unknown): PgLikeError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const candidate = current as Partial<PgLikeError>;
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) return candidate as PgLikeError;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Maps any thrown value to the problem sent to the client. Internal details never leave the server. */
export function toProblem(error: unknown): { problem: Problem; log: 'none' | 'warn' | 'error' } {
  if (error instanceof AppError) {
    return { problem: problem(error.status, error.code, error.message, error.extra ?? {}), log: 'none' };
  }
  if (error instanceof HttpException) {
    // Framework-raised HTTP errors (unparseable body, body too large, unknown route...). The framework's own message can echo
    // request content, so the caller gets a fixed description instead.
    const status = error.getStatus();
    const code = HTTP_CODES[status] ?? 'http_error';
    return { problem: problem(status, code, TITLES[status] ?? 'Request failed'), log: status >= 500 ? 'error' : 'none' };
  }
  const pg = findPgError(error);
  if (pg) {
    const constraint = pg.constraint ? { constraint: pg.constraint } : {};
    switch (pg.code) {
      case '23505':
        return { problem: problem(409, 'conflict', 'A record with the same unique value already exists', constraint), log: 'none' };
      case '23P01': // exclusion constraint: overlapping effective-dated ranges
        return { problem: problem(409, 'overlaps_existing', 'The effective period overlaps an existing one', constraint), log: 'none' };
      case '23503':
        return { problem: problem(422, 'reference_invalid', 'A referenced record does not exist', constraint), log: 'none' };
      case '23514':
      case '23502':
        return { problem: problem(422, 'constraint_violated', 'The data violates a business constraint', constraint), log: 'none' };
      case '42501':
        // Row-level security or a missing privilege. Never expected in normal operation: surface it loudly.
        return { problem: problem(403, 'forbidden', 'You are not allowed to do this'), log: 'error' };
      case '40001':
      case '40P01':
        return { problem: problem(409, 'transaction_conflict', 'The change conflicted with another one; retry it', { retryable: true }), log: 'warn' };
      case '57014':
        return { problem: problem(503, 'timeout', 'The request took too long', { retryable: true }), log: 'warn' };
      default:
        if (/^(08|53|57P)/.test(pg.code)) {
          return { problem: problem(503, 'database_unavailable', 'The service is temporarily unavailable', { retryable: true }), log: 'error' };
        }
    }
  }
  const http = error as { statusCode?: unknown; message?: unknown } | null;
  if (http && typeof http.statusCode === 'number' && http.statusCode >= 400 && http.statusCode < 500) {
    // Transport-level 4xx raised by the HTTP server itself (malformed JSON, body too large, wrong content type).
    const code = http.statusCode === 413 ? 'payload_too_large' : http.statusCode === 415 ? 'unsupported_media_type' : 'bad_request';
    return { problem: problem(http.statusCode, code, 'The request could not be read'), log: 'none' };
  }
  return { problem: problem(500, 'internal_error', 'Something went wrong on the server'), log: 'error' };
}

import { randomUUID } from 'node:crypto';
import type { AbstractHttpAdapter } from '@nestjs/core';
import type { Env } from '../../config/env.js';

interface WithHeaders {
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** One id per request, taken from a well-formed `X-Request-Id` or generated. Works on every HTTP adapter. */
export function ensureRequestId(request: WithHeaders, response: unknown, adapter: AbstractHttpAdapter): string {
  if (request.requestId) return request.requestId;
  const incoming = request.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  request.requestId = id;
  adapter.setHeader(response, 'X-Request-Id', id);
  return id;
}

export function applySecurityHeaders(adapter: AbstractHttpAdapter, response: unknown, env: Pick<Env, 'NODE_ENV'>): void {
  adapter.setHeader(response, 'X-Content-Type-Options', 'nosniff');
  adapter.setHeader(response, 'X-Frame-Options', 'DENY');
  adapter.setHeader(response, 'Referrer-Policy', 'no-referrer');
  adapter.setHeader(response, 'Cross-Origin-Resource-Policy', 'same-site');
  adapter.setHeader(response, 'Cache-Control', 'no-store');
  if (env.NODE_ENV === 'production') adapter.setHeader(response, 'Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

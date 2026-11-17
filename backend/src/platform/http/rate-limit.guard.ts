import { CanActivate, ExecutionContext, Inject, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from './errors.js';

interface Window { start: number; count: number }
interface Req { ip?: string; url?: string; raw?: { url?: string }; socket?: { remoteAddress?: string } }
interface Res { header?: (name: string, value: string) => unknown; setHeader?: (name: string, value: string) => unknown }
const MAX_KEYS = 100_000;
const EXEMPT = /^\/(health|ready|live)(\/|$|\?)/;

/**
 * A fixed-window request limiter per client address, in process memory (so per instance; put a shared limiter at the edge for a
 * fleet-wide limit). Off by default (`RATE_LIMIT_PER_WINDOW` = 0). Health probes are exempt. It runs before authentication, so it
 * also slows credential guessing. Answers 429 with `Retry-After` and `RateLimit-*` headers.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(@Inject(ENV) env: Env) {
    this.limit = env.RATE_LIMIT_PER_WINDOW;
    this.windowMs = env.RATE_LIMIT_WINDOW_SECONDS * 1000;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.limit <= 0 || context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<Res>();
    const url = req.url ?? req.raw?.url ?? '';
    if (EXEMPT.test(url)) return true;
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (this.windows.size >= MAX_KEYS) this.windows.clear();
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    w.count += 1;
    const remaining = Math.max(0, this.limit - w.count);
    const resetIn = Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000));
    const set = (name: string, value: string) => { if (res.header) res.header(name, value); else res.setHeader?.(name, value); };
    set('RateLimit-Limit', String(this.limit));
    set('RateLimit-Remaining', String(remaining));
    set('RateLimit-Reset', String(resetIn));
    if (w.count > this.limit) {
      set('Retry-After', String(resetIn));
      throw new AppError(429, 'rate_limited', `Too many requests: try again in ${resetIn} seconds`, { retryAfterSeconds: resetIn });
    }
    return true;
  }
}

@Module({ providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }] })
export class RateLimitModule {}

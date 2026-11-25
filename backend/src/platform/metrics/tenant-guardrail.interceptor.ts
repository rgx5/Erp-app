import { CallHandler, ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable, defer, finalize } from 'rxjs';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../http/errors.js';
import { MetricsService } from './metrics.service.js';

/** Routes that read or write large volumes: reports, returns, statements, exports and bulk imports. */
export const HEAVY_ROUTE = /^\/v1\/(reports|gst|tds)(\/|$)|\/(export|exports|statement|statements|import|ledger|day-book|trial-balance|aging|ageing)(\/|$)/;

/**
 * Stops one client from using the whole server (noisy neighbour): each tenant may have only so many requests running at once, and fewer
 * of the heavy kind. Over the limit the answer is 429 with Retry-After; the client retries, other tenants are unaffected. In process memory,
 * so the limits are per server instance, which is what protects its database pool. A limit of 0 turns that part off.
 */
@Injectable()
export class TenantGuardrailInterceptor implements NestInterceptor {
  private readonly active = new Map<string, { all: number; heavy: number }>();
  private readonly maxAll: number;
  private readonly maxHeavy: number;

  constructor(@Inject(ENV) env: Env, @Inject(MetricsService) private readonly metrics: MetricsService) {
    this.maxAll = env.TENANT_MAX_CONCURRENT;
    this.maxHeavy = env.TENANT_MAX_CONCURRENT_HEAVY;
  }

  /** In-flight counts for the metrics endpoint. */
  snapshot(): { tenantId: string; all: number; heavy: number }[] { return [...this.active].map(([tenantId, v]) => ({ tenantId, ...v })); }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ tenantId?: string; url?: string; raw?: { url?: string }; method?: string }>();
    const tenantId = req.tenantId;
    if (!tenantId || (this.maxAll <= 0 && this.maxHeavy <= 0)) return next.handle();
    const path = (req.url ?? req.raw?.url ?? '').split('?')[0] as string;
    if (path === '/v1/events') return next.handle(); // a long-lived stream, not work
    const heavy = HEAVY_ROUTE.test(path);
    const slot = this.active.get(tenantId) ?? { all: 0, heavy: 0 };
    if (this.maxAll > 0 && slot.all >= this.maxAll) this.reject(context, 'concurrent');
    if (heavy && this.maxHeavy > 0 && slot.heavy >= this.maxHeavy) this.reject(context, 'heavy');
    // Counted while it runs (from subscription to completion), so a request that is never started never holds a slot.
    return defer(() => {
      const current = this.active.get(tenantId) ?? { all: 0, heavy: 0 };
      current.all += 1; if (heavy) current.heavy += 1;
      this.active.set(tenantId, current);
      return next.handle().pipe(finalize(() => {
        current.all -= 1; if (heavy) current.heavy -= 1;
        if (current.all <= 0) this.active.delete(tenantId);
      }));
    });
  }

  private reject(context: ExecutionContext, kind: 'concurrent' | 'heavy'): never {
    this.metrics.inc('erp_guardrail_rejections_total', 'Requests refused because a client had too many running at once', { kind });
    const res = context.switchToHttp().getResponse<{ header?: (n: string, v: string) => unknown; setHeader?: (n: string, v: string) => unknown }>();
    if (res.header) res.header('Retry-After', '2'); else res.setHeader?.('Retry-After', '2');
    throw new AppError(429, 'too_many_concurrent', kind === 'heavy' ? 'Too many reports or exports are running for this business: wait for one to finish and try again' : 'Too many requests are running at once for this business: try again in a moment', { retryAfterSeconds: 2 });
  }
}

import { Subject, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { HEAVY_ROUTE, TenantGuardrailInterceptor } from './tenant-guardrail.interceptor.js';
import { MetricsService } from './metrics.service.js';

const ctx = (tenantId: string, url: string) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ tenantId, url }), getResponse: () => ({ header: () => undefined }) }) }) as never;
const make = (all: number, heavy: number) => new TenantGuardrailInterceptor({ TENANT_MAX_CONCURRENT: all, TENANT_MAX_CONCURRENT_HEAVY: heavy } as never, new MetricsService());

describe('per-client guardrails', () => {
  it('recognises the heavy routes', () => {
    for (const p of ['/v1/reports/sales', '/v1/gst/gstr1', '/v1/tds/summary', '/v1/accounting/ledger', '/v1/reports/export']) expect(HEAVY_ROUTE.test(p), p).toBe(true);
    for (const p of ['/v1/sales/invoices', '/v1/items', '/v1/pos/sales']) expect(HEAVY_ROUTE.test(p), p).toBe(false);
  });

  it('refuses a client over its heavy limit while other clients and light requests carry on, and frees the slot when done', () => {
    const g = make(10, 1);
    const running = new Subject<string>();
    const handler = { handle: () => running.asObservable() };
    const first = g.intercept(ctx('a', '/v1/reports/sales'), handler).subscribe();
    expect(() => g.intercept(ctx('a', '/v1/reports/sales?x=1'), handler)).toThrowError(/Too many reports/);
    expect(() => g.intercept(ctx('a', '/v1/items'), handler)).not.toThrow(); // light request still allowed
    expect(() => g.intercept(ctx('b', '/v1/reports/sales'), handler)).not.toThrow(); // another client unaffected
    running.complete(); first.unsubscribe();
    expect(g.snapshot()).toEqual([]);
    expect(() => g.intercept(ctx('a', '/v1/reports/sales'), { handle: () => of('x') })).not.toThrow();
  });

  it('caps all concurrent requests of one client, and is off at 0', () => {
    const g = make(2, 0);
    const never = { handle: () => new Subject<string>().asObservable() };
    g.intercept(ctx('a', '/v1/items'), never).subscribe(); g.intercept(ctx('a', '/v1/items'), never).subscribe();
    expect(() => g.intercept(ctx('a', '/v1/items'), never)).toThrowError(/Too many requests/);
    const off = make(0, 0);
    for (let i = 0; i < 100; i++) off.intercept(ctx('a', '/v1/items'), never).subscribe();
  });
});

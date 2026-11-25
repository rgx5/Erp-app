import { Controller, Get, Global, Header, Inject, Module, type OnModuleInit, UseGuards } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type pg from 'pg';
import { ENV, type Env } from '../../config/env.js';
import { POOL } from '../database/database.js';
import { Public } from '../http/public.js';
import { PlatformAdminGuard } from '../tenancy/platform-admin.guard.js';
import { jobMetrics } from './job-status.js';
import { MetricsService } from './metrics.service.js';
import { TenantGuardrailInterceptor } from './tenant-guardrail.interceptor.js';

/** Prometheus scrape endpoint. Same bearer token as the platform operator endpoints; keep it off the public proxy. */
@Controller('metrics')
@Public()
@UseGuards(PlatformAdminGuard)
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render() { return this.metrics.render(); }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, TenantGuardrailInterceptor, PlatformAdminGuard, { provide: APP_INTERCEPTOR, useExisting: TenantGuardrailInterceptor }],
  exports: [MetricsService],
})
export class MetricsModule implements OnModuleInit {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService, @Inject(POOL) private readonly pool: pg.Pool, @Inject(TenantGuardrailInterceptor) private readonly guard: TenantGuardrailInterceptor, @Inject(ENV) private readonly env: Env) {}

  onModuleInit(): void {
    const { metrics, pool, guard } = this;
    metrics.gauge(async () => [
      { name: 'erp_db_pool_connections', help: 'Database connections by state', samples: [{ labels: { state: 'total' }, value: pool.totalCount }, { labels: { state: 'idle' }, value: pool.idleCount }, { labels: { state: 'waiting' }, value: pool.waitingCount }] },
      { name: 'erp_db_pool_max', help: 'Configured pool size', samples: [{ value: this.env.DATABASE_POOL_MAX }] },
      { name: 'erp_inflight_requests', help: 'Requests running now, by heavy or all', samples: [{ labels: { kind: 'all' }, value: guard.snapshot().reduce((a, s) => a + s.all, 0) }, { labels: { kind: 'heavy' }, value: guard.snapshot().reduce((a, s) => a + s.heavy, 0) }] },
    ]);
    metrics.gauge(async () => jobMetrics(this.env.STATUS_DIR));
    metrics.gauge(async () => {
      const r = await pool.query<{ pending: string; oldest: string | null; dead: string; db_bytes: string; tenants: string }>(
        `SELECT (SELECT count(*) FROM erp.outbox_dispatch WHERE done_at IS NULL AND dead_at IS NULL) AS pending,
                (SELECT extract(epoch FROM now() - min(available_at)) FROM erp.outbox_dispatch WHERE done_at IS NULL AND dead_at IS NULL) AS oldest,
                (SELECT count(*) FROM erp.outbox_dispatch WHERE dead_at IS NOT NULL) AS dead,
                pg_database_size(current_database()) AS db_bytes,
                (SELECT count(*) FROM erp.tenant_directory) AS tenants`);
      const row = r.rows[0];
      return [
        { name: 'erp_outbox_pending', help: 'Events waiting to be delivered', samples: [{ value: Number(row?.pending ?? 0) }] },
        { name: 'erp_outbox_oldest_pending_seconds', help: 'Age of the oldest undelivered event', samples: [{ value: Math.max(0, Number(row?.oldest ?? 0)) }] },
        { name: 'erp_outbox_dead', help: 'Events that gave up after repeated failures', samples: [{ value: Number(row?.dead ?? 0) }] },
        { name: 'erp_database_size_bytes', help: 'Size of this cell\'s database', samples: [{ value: Number(row?.db_bytes ?? 0) }] },
        { name: 'erp_tenants', help: 'Clients on this cell', samples: [{ value: Number(row?.tenants ?? 0) }] },
      ];
    });
  }
}

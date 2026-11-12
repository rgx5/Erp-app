import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import type pg from 'pg';
import { expectedMigrationHead } from '../../db/migrator.js';
import { POOL } from '../database/database.js';
import { Public } from '../http/public.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  private expectedHead: Promise<string> | undefined;

  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HealthIndicatorService) private readonly indicator: HealthIndicatorService,
    @Inject(POOL) private readonly pool: pg.Pool,
  ) {}

  /** Liveness: the process is up and serving. Deliberately touches nothing else. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: the database answers and has at least the migrations this build was compiled against. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.database()]);
  }

  private async database() {
    const session = this.indicator.check('database');
    try {
      this.expectedHead ??= expectedMigrationHead();
      const [expected, result] = await Promise.all([
        this.expectedHead,
        this.pool.query<{ head: string | null }>('SELECT max(id) AS head FROM erp.schema_migrations'),
      ]);
      const applied = result.rows[0]?.head ?? '';
      if (applied < expected) return session.down({ message: 'migrations are behind', applied, expected });
      return session.up({ migration: applied });
    } catch {
      return session.down({ message: 'database unreachable' });
    }
  }
}

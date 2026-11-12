import { Global, Inject, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type pg from 'pg';
import { ENV, type Env } from '../../config/env.js';
import { createAppPool, createDb, DB, POOL } from './database.js';
import { inspectRuntimeRole } from './runtime-role.js';
import { UnitOfWork } from './unit-of-work.js';

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        createAppPool({
          url: env.DATABASE_URL,
          max: env.DATABASE_POOL_MAX,
          statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
          idleInTransactionTimeoutMs: env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
        }),
    },
    { provide: DB, inject: [POOL], useFactory: (pool: pg.Pool) => createDb(pool) },
    UnitOfWork,
  ],
  exports: [POOL, DB, UnitOfWork],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: pg.Pool) {}

  async onModuleInit(): Promise<void> {
    const report = await inspectRuntimeRole(this.pool);
    if (report.problems.length > 0) {
      throw new Error(
        `Refusing to start: database role "${report.role}" ${report.problems.join('; ')}. ` +
          'The runtime role must be a plain login role that owns nothing; see db/bootstrap/bootstrap.sql.',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

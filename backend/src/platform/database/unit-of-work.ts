import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type AppDb, type Tx } from './database.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnitOfWorkOptions {
  readOnly?: boolean;
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
}

/**
 * The only way application code reaches tenant data. Every call is one transaction whose first statement binds the
 * tenant with a TRANSACTION-LOCAL setting (`set_config(..., true)`), which PostgreSQL discards at COMMIT or ROLLBACK:
 * a pooled connection therefore can never carry one request's tenant into the next one.
 *
 * There is deliberately no "platform" or "bypass" mode. Creating a tenant runs as that new tenant's own context.
 */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(DB) private readonly db: AppDb) {}

  async inTenant<T>(tenantId: string, work: (tx: Tx) => Promise<T>, options: UnitOfWorkOptions = {}): Promise<T> {
    if (!UUID.test(tenantId)) throw new TypeError('tenantId must be a UUID');
    return this.db.transaction(
      async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        return work(tx);
      },
      { accessMode: options.readOnly ? 'read only' : 'read write', isolationLevel: options.isolation ?? 'read committed' },
    );
  }
}

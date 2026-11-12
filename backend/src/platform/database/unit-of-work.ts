import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DB, type AppDb, type Tx } from './database.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnitOfWorkOptions {
  readOnly?: boolean;
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
}

interface Ambient {
  tenantId: string;
  tx: Tx;
  readOnly: boolean;
}
const ambient = new AsyncLocalStorage<Ambient>();

/**
 * The only way application code reaches tenant data. Every call is one transaction whose first statement binds the
 * tenant with a TRANSACTION-LOCAL setting (`set_config(..., true)`), which PostgreSQL discards at COMMIT or ROLLBACK:
 * a pooled connection therefore can never carry one request's tenant into the next one.
 *
 * Calls nest by JOINING: `inTenant` inside another `inTenant` for the SAME tenant runs in the outer transaction (so an
 * idempotent request, or a posting that touches several services, is one atomic unit). A nested call for a DIFFERENT tenant
 * is refused, and a read-write call cannot join a read-only transaction. The isolation level of a joined call is the outer's.
 *
 * There is deliberately no "platform" or "bypass" mode. Creating a tenant runs as that new tenant's own context.
 */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(DB) private readonly db: AppDb) {}

  async inTenant<T>(tenantId: string, work: (tx: Tx) => Promise<T>, options: UnitOfWorkOptions = {}): Promise<T> {
    if (!UUID.test(tenantId)) throw new TypeError('tenantId must be a UUID');
    const outer = ambient.getStore();
    if (outer) {
      if (outer.tenantId !== tenantId.toLowerCase()) throw new Error('A nested transaction cannot switch tenant');
      if (outer.readOnly && !options.readOnly) throw new Error('A read-write operation cannot join a read-only transaction');
      return work(outer.tx);
    }
    return this.db.transaction(
      async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        return ambient.run({ tenantId: tenantId.toLowerCase(), tx, readOnly: !!options.readOnly }, () => work(tx));
      },
      { accessMode: options.readOnly ? 'read only' : 'read write', isolationLevel: options.isolation ?? 'read committed' },
    );
  }

  /** The transaction `inTenant` is currently running, if any (lets infrastructure join without threading `tx` everywhere). */
  current(): { tenantId: string; tx: Tx } | undefined {
    return ambient.getStore();
  }

  /**
   * A read-only transaction with NO tenant bound. Every RLS-protected table returns zero rows here (the policies fail closed);
   * only the non-tenant `tenant_directory` is readable. It exists solely to turn a tenant slug into a tenant id at sign-in.
   */
  async outsideTenant<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work, { accessMode: 'read only', isolationLevel: 'read committed' });
  }

  /**
   * A read-write transaction with NO tenant bound, for the one non-tenant table that needs writes: the outbox delivery
   * queue (`outbox_dispatch`). Every tenant table still returns zero rows and rejects writes here.
   */
  async unscoped<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work, { accessMode: 'read write', isolationLevel: 'read committed' });
  }
}

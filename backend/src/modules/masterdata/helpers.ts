import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tx } from '../../platform/database/database.js';
import { notFound, preconditionFailed } from '../../platform/http/errors.js';
import { decodeCursor, type Page, toPage } from '../../platform/http/validation.js';
import { AuditService } from '../../platform/services/audit.service.js';
import { OutboxService } from '../../platform/services/outbox.service.js';

type Versioned = PgTable & { tenantId: PgColumn; id: PgColumn; version: PgColumn };
type Keyed = PgTable & { tenantId: PgColumn; id: PgColumn };

export const first = <T>(rows: T[], what: string): T => {
  const row = rows[0];
  if (!row) throw notFound(what);
  return row;
};

/** Audit entry plus domain event, in the caller's transaction. */
@Injectable()
export class Recorder {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async record<T extends { id: string }>(tx: Tx, tenantId: string, entity: string, verb: string, row: T, details: Record<string, unknown> = {}): Promise<T> {
    await this.audit.record(tx, tenantId, { action: `${entity}.${verb}`, entityType: entity, entityId: row.id, details });
    await this.outbox.publish(tx, tenantId, { eventType: `${entity}.${verb}`, aggregateType: entity, aggregateId: row.id, payload: { id: row.id, ...details } });
    return row;
  }
}

/** Optimistic locking: applies only if the caller saw the current version. 404 if the row is absent, 412 if it moved. */
export async function updateVersioned<R>(tx: Tx, table: Versioned, tenantId: string, id: string, version: number, set: Record<string, unknown>, what: string): Promise<R> {
  const rows = (await tx
    .update(table)
    .set(set as never)
    .where(and(eq(table.tenantId, tenantId), eq(table.id, id), eq(table.version, version)))
    .returning()) as R[];
  if (rows[0]) return rows[0];
  const [exists] = await tx.select({ id: table.id }).from(table).where(and(eq(table.tenantId, tenantId), eq(table.id, id)));
  throw exists ? preconditionFailed(`The ${what.toLowerCase()} changed since you read it; fetch it again`) : notFound(what);
}

/** One page of rows in id (= creation) order. */
export async function pageOf<R extends { id: string }>(tx: Tx, table: Keyed, tenantId: string, limit: number, cursor: string | undefined, ...filters: (SQL | undefined)[]): Promise<Page<R>> {
  const after = decodeCursor(cursor);
  const rows = (await tx
    .select()
    .from(table)
    .where(and(eq(table.tenantId, tenantId), after ? gt(table.id, after) : undefined, ...filters))
    .orderBy(asc(table.id))
    .limit(limit + 1)) as R[];
  return toPage(rows, limit);
}

/** Escapes LIKE wildcards so a search term is matched literally. */
export const likePrefix = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`) + '%';

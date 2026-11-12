import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../database/database.js';
import { requestContext } from '../http/request-context.js';
import { auditLog } from './platform.schema.js';

export interface AuditEntry {
  /** dotted, lower-case: `user.created`, `auth.login_failed` */
  action: string;
  entityType?: string;
  entityId?: string;
  outcome?: 'success' | 'failure';
  /** Facts about the change. Never secrets, tokens or password material. */
  details?: Record<string, unknown>;
  /** Overrides the caller taken from the request (sign-in happens before there is a principal). */
  actor?: { type: 'user' | 'api_key' | 'system' | 'anonymous'; id?: string };
}

/**
 * Appends to the audit log INSIDE the caller's transaction, so the entry exists if and only if the change committed.
 * The log is append-only at the database (no UPDATE/DELETE grant, and a trigger that refuses them).
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, tenantId: string, entry: AuditEntry): Promise<void> {
    const context = requestContext.get();
    const actor = entry.actor ?? (context?.actor ? { type: context.actor.type, id: context.actor.id } : { type: 'system' as const });
    await tx.insert(auditLog).values({
      tenantId,
      id: uuidv7(),
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      outcome: entry.outcome ?? 'success',
      requestId: context?.requestId ?? null,
      ipAddress: context?.ip ?? null,
      details: entry.details ?? {},
    });
  }
}

import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../database/database.js';
import { requestContext } from '../http/request-context.js';
import { outboxEvents } from './platform.schema.js';

export interface OutboxEvent {
  /** dotted, lower-case: `invoice.posted` */
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  /** JSON data consumers need. Keep it small and free of secrets; consumers can read the aggregate itself. */
  payload: Record<string, unknown>;
}

/**
 * Publishes a domain event in the caller's transaction (the "transactional outbox"): the event exists if and only if the
 * business change committed. Delivery to consumers happens later, at least once (see OutboxRelay).
 */
@Injectable()
export class OutboxService {
  async publish(tx: Tx, tenantId: string, event: OutboxEvent): Promise<string> {
    const id = uuidv7();
    await tx.insert(outboxEvents).values({ tenantId, id, ...event, requestId: requestContext.get()?.requestId ?? null });
    return id;
  }
}

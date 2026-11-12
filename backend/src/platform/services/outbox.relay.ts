import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { ENV, type Env } from '../../config/env.js';
import type { Tx } from '../database/database.js';
import { UnitOfWork } from '../database/unit-of-work.js';
import { LOGGER } from '../logging/logger.js';
import { outboxConsumed, outboxDispatch, outboxEvents } from './platform.schema.js';

export type StoredEvent = typeof outboxEvents.$inferSelect;

/** A subscriber to domain events. Its effects and its "done" mark commit together, so redelivery is harmless. */
export interface OutboxConsumer {
  /** Stable name; changing it makes the consumer receive old events again. */
  readonly name: string;
  readonly eventTypes: readonly string[];
  /** Runs inside the event's tenant transaction. Throwing schedules a retry with backoff; it must be safe to call again. */
  handle(event: StoredEvent, tx: Tx): Promise<void>;
}

@Injectable()
export class OutboxRegistry {
  private readonly consumers: OutboxConsumer[] = [];
  register(consumer: OutboxConsumer): void {
    if (this.consumers.some((c) => c.name === consumer.name)) throw new Error(`Outbox consumer ${consumer.name} is already registered`);
    this.consumers.push(consumer);
  }
  for(eventType: string): OutboxConsumer[] {
    return this.consumers.filter((c) => c.eventTypes.includes(eventType));
  }
}

/**
 * Delivers committed events to consumers, at least once. The queue (`outbox_dispatch`) holds only pointers, so the relay can
 * find due work across tenants without ever bypassing row-level security: each event is read and handled inside its own
 * tenant's context. Instances compete safely (FOR UPDATE SKIP LOCKED plus a lease), failures back off exponentially, and an
 * event that keeps failing is parked as dead (never silently dropped) with its last error.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxRegistry) private readonly registry: OutboxRegistry,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.OUTBOX_RELAY_ENABLED) return;
    const loop = (): void => {
      if (this.stopped) return;
      this.running = this.drainOnce()
        .catch((error: unknown) => this.logger.error({ err: error }, 'outbox relay tick failed'))
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(loop, this.env.OUTBOX_POLL_INTERVAL_MS);
        });
    };
    this.timer = setTimeout(loop, this.env.OUTBOX_POLL_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  /** Claims up to a batch of due events and delivers them. Returns how many were attempted. Also used directly by tests. */
  async drainOnce(): Promise<number> {
    const claimed = await this.uow.unscoped(async (tx) => {
      const result = await tx.execute<{ event_id: string; tenant_id: string; attempts: number }>(sql`
        UPDATE erp.outbox_dispatch d
           SET attempts = d.attempts + 1, locked_until = now() + make_interval(secs => ${this.env.OUTBOX_LEASE_SECONDS})
         WHERE d.event_id IN (
                 SELECT event_id FROM erp.outbox_dispatch
                  WHERE done_at IS NULL AND dead_at IS NULL AND available_at <= now() AND (locked_until IS NULL OR locked_until < now())
                  ORDER BY available_at, event_id
                  LIMIT ${this.env.OUTBOX_BATCH_SIZE}
                  FOR UPDATE SKIP LOCKED)
        RETURNING d.event_id, d.tenant_id, d.attempts`);
      return result.rows;
    });
    for (const row of claimed) await this.deliver(row.tenant_id, row.event_id, row.attempts);
    return claimed.length;
  }

  private async deliver(tenantId: string, eventId: string, attempts: number): Promise<void> {
    try {
      const [event] = await this.uow.inTenant(tenantId, (tx) => tx.select().from(outboxEvents).where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.id, eventId))), { readOnly: true });
      if (!event) throw new Error('event row not found for its dispatch pointer');
      for (const consumer of this.registry.for(event.eventType)) {
        // One transaction per consumer: a failing consumer does not undo (or re-run) the ones that already succeeded.
        await this.uow.inTenant(tenantId, async (tx) => {
          const fresh = await tx
            .insert(outboxConsumed)
            .values({ tenantId, eventId, consumer: consumer.name })
            .onConflictDoNothing()
            .returning({ id: outboxConsumed.eventId });
          if (fresh.length === 0) return; // already handled (redelivery)
          await consumer.handle(event, tx);
        });
      }
      await this.uow.unscoped((tx) => tx.update(outboxDispatch).set({ doneAt: new Date(), lockedUntil: null, lastError: null }).where(eq(outboxDispatch.eventId, eventId)));
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const dead = attempts >= this.env.OUTBOX_MAX_ATTEMPTS;
      const delaySeconds = Math.min(2 ** attempts * 2, 3600);
      this.logger[dead ? 'error' : 'warn']({ eventId, tenantId, attempts, err: message }, dead ? 'outbox event parked as dead' : 'outbox delivery failed, will retry');
      await this.uow.unscoped((tx) =>
        tx
          .update(outboxDispatch)
          .set({
            lastError: message,
            lockedUntil: null,
            ...(dead ? { deadAt: new Date() } : { availableAt: sql`now() + make_interval(secs => ${delaySeconds})` }),
          })
          .where(and(eq(outboxDispatch.eventId, eventId), isNull(outboxDispatch.doneAt))),
      );
    }
  }
}

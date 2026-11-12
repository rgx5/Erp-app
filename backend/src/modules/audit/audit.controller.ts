import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { decodeCursor, toPage } from '../../platform/http/validation.js';
import { auditLog } from '../../platform/services/platform.schema.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.uuid().optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

/** Read-only. There is no endpoint (and no database privilege) to change or remove an entry. */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('v1/audit-events')
export class AuditController {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  /** Newest first. */
  @RequirePermissions('audit:read')
  @Get()
  async list(@TenantId() tenantId: string, @Query({ schema: querySchema }) q: z.infer<typeof querySchema>) {
    const before = decodeCursor(q.cursor);
    const rows = await this.uow.inTenant(
      tenantId,
      (tx) =>
        tx
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.tenantId, tenantId),
              before ? lt(auditLog.id, before) : undefined,
              q.action ? eq(auditLog.action, q.action) : undefined,
              q.entityType ? eq(auditLog.entityType, q.entityType) : undefined,
              q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
              q.actorId ? eq(auditLog.actorId, q.actorId) : undefined,
              q.outcome ? eq(auditLog.outcome, q.outcome) : undefined,
              q.from ? gte(auditLog.occurredAt, new Date(q.from)) : undefined,
              q.to ? lte(auditLog.occurredAt, new Date(q.to)) : undefined,
            ),
          )
          .orderBy(desc(auditLog.id))
          .limit(q.limit + 1),
      { readOnly: true },
    );
    const page = toPage(rows, q.limit);
    return {
      items: page.items.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        outcome: r.outcome,
        requestId: r.requestId,
        ipAddress: r.ipAddress,
        details: r.details,
      })),
      nextCursor: page.nextCursor,
    };
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}

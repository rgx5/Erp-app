import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { notFound, preconditionFailed } from '../../platform/http/errors.js';
import { decodeCursor, type Page, toPage } from '../../platform/http/validation.js';
import type { Tx } from '../../platform/database/database.js';
import { AuditService } from '../../platform/services/audit.service.js';
import { OutboxService } from '../../platform/services/outbox.service.js';
import { businessLocations, companies, gstRegistrations, tenants, warehouses } from './organization.schema.js';
import type {
  CreateBusinessLocationInput,
  CreateCompanyInput,
  CreateGstRegistrationInput,
  CreateWarehouseInput,
  ListLocationsQuery,
  ListWarehousesQuery,
  UpdateCompanyInput,
} from './organization.schemas.js';
import { stateCodeOfGstin } from './gstin.js';

export type TenantRow = typeof tenants.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type GstRegistrationRow = typeof gstRegistrations.$inferSelect;
export type BusinessLocationRow = typeof businessLocations.$inferSelect;
export type WarehouseRow = typeof warehouses.$inferSelect;

const one = <T>(rows: T[], what: string): T => {
  const row = rows[0];
  if (!row) throw notFound(what);
  return row;
};

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Records the audit entry and publishes the domain event in the same transaction as the change. */
  private async recorded<T extends { id: string }>(tx: Tx, tenantId: string, entity: string, verb: 'created' | 'updated', row: T, details: Record<string, unknown> = {}): Promise<T> {
    await this.audit.record(tx, tenantId, { action: `${entity}.${verb}`, entityType: entity, entityId: row.id, details });
    await this.outbox.publish(tx, tenantId, { eventType: `${entity}.${verb}`, aggregateType: entity, aggregateId: row.id, payload: { id: row.id, ...details } });
    return row;
  }

  getTenant(tenantId: string): Promise<TenantRow> {
    return this.uow.inTenant(tenantId, async (tx) => one(await tx.select().from(tenants).where(eq(tenants.id, tenantId)), 'Tenant'), { readOnly: true });
  }

  createCompany(tenantId: string, input: CreateCompanyInput): Promise<CompanyRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorded(tx, tenantId, 'company', 'created', one(await tx.insert(companies).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Company'), { legalName: input.legalName }),
    );
  }

  getCompany(tenantId: string, id: string): Promise<CompanyRow> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => one(await tx.select().from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, id))), 'Company'),
      { readOnly: true },
    );
  }

  listCompanies(tenantId: string, limit: number, cursor: string | undefined): Promise<Page<CompanyRow>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const where: SQL[] = [eq(companies.tenantId, tenantId)];
        if (after) where.push(gt(companies.id, after));
        return toPage(await tx.select().from(companies).where(and(...where)).orderBy(asc(companies.id)).limit(limit + 1), limit);
      },
      { readOnly: true },
    );
  }

  /** Optimistic locking: the change applies only if the caller saw the current `version`. */
  updateCompany(tenantId: string, id: string, expectedVersion: number, input: UpdateCompanyInput): Promise<CompanyRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const updated = await tx
        .update(companies)
        .set(input)
        .where(and(eq(companies.tenantId, tenantId), eq(companies.id, id), eq(companies.version, expectedVersion)))
        .returning();
      if (updated[0]) return this.recorded(tx, tenantId, 'company', 'updated', updated[0], { fields: Object.keys(input), version: updated[0].version });
      const existing = await tx.select({ version: companies.version }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, id)));
      if (!existing[0]) throw notFound('Company');
      throw preconditionFailed(`The company changed since you read it (current version ${existing[0].version})`);
    });
  }

  createGstRegistration(tenantId: string, companyId: string, input: CreateGstRegistrationInput): Promise<GstRegistrationRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorded(
        tx,
        tenantId,
        'gst_registration',
        'created',
        one(await tx.insert(gstRegistrations).values({ tenantId, id: uuidv7(), companyId, stateCode: stateCodeOfGstin(input.gstin), ...input }).returning(), 'GST registration'),
        { companyId, gstin: input.gstin },
      ),
    );
  }

  listGstRegistrations(tenantId: string, companyId: string, limit: number, cursor: string | undefined): Promise<Page<GstRegistrationRow>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const where: SQL[] = [eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.companyId, companyId)];
        if (after) where.push(gt(gstRegistrations.id, after));
        return toPage(await tx.select().from(gstRegistrations).where(and(...where)).orderBy(asc(gstRegistrations.id)).limit(limit + 1), limit);
      },
      { readOnly: true },
    );
  }

  createBusinessLocation(tenantId: string, input: CreateBusinessLocationInput): Promise<BusinessLocationRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorded(tx, tenantId, 'business_location', 'created', one(await tx.insert(businessLocations).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Business location'), { companyId: input.companyId, code: input.code }),
    );
  }

  listBusinessLocations(tenantId: string, query: ListLocationsQuery): Promise<Page<BusinessLocationRow>> {
    const after = decodeCursor(query.cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const where: SQL[] = [eq(businessLocations.tenantId, tenantId)];
        if (query.companyId) where.push(eq(businessLocations.companyId, query.companyId));
        if (after) where.push(gt(businessLocations.id, after));
        return toPage(await tx.select().from(businessLocations).where(and(...where)).orderBy(asc(businessLocations.id)).limit(query.limit + 1), query.limit);
      },
      { readOnly: true },
    );
  }

  createWarehouse(tenantId: string, input: CreateWarehouseInput): Promise<WarehouseRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorded(tx, tenantId, 'warehouse', 'created', one(await tx.insert(warehouses).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Warehouse'), { businessLocationId: input.businessLocationId, code: input.code, kind: input.kind }),
    );
  }

  listWarehouses(tenantId: string, query: ListWarehousesQuery): Promise<Page<WarehouseRow>> {
    const after = decodeCursor(query.cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const where: SQL[] = [eq(warehouses.tenantId, tenantId)];
        if (query.businessLocationId) where.push(eq(warehouses.businessLocationId, query.businessLocationId));
        if (after) where.push(gt(warehouses.id, after));
        return toPage(await tx.select().from(warehouses).where(and(...where)).orderBy(asc(warehouses.id)).limit(query.limit + 1), query.limit);
      },
      { readOnly: true },
    );
  }
}

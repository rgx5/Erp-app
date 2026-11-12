import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import type { Page } from '../../platform/http/validation.js';
import { first, likePrefix, pageOf, Recorder, updateVersioned } from './helpers.js';
import { partyAddresses, parties, paymentTerms } from './masterdata.schema.js';
import type { CreateAddressInput, CreatePartyInput, CreatePaymentTermInput, ListPartiesQuery, UpdatePartyInput } from './masterdata.schemas.js';

export type PartyRow = typeof parties.$inferSelect;
export type AddressRow = typeof partyAddresses.$inferSelect;
export type PaymentTermRow = typeof paymentTerms.$inferSelect;

/** Customers, suppliers and subcontractors are one record with roles. */
@Injectable()
export class PartiesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  createPaymentTerm(tenantId: string, input: CreatePaymentTermInput): Promise<PaymentTermRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'payment_term', 'created', first(await tx.insert(paymentTerms).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Payment term'), { code: input.code, netDays: input.netDays }),
    );
  }
  listPaymentTerms(tenantId: string, limit: number, cursor?: string): Promise<Page<PaymentTermRow>> {
    return this.uow.inTenant(tenantId, (tx) => pageOf<PaymentTermRow>(tx, paymentTerms, tenantId, limit, cursor), { readOnly: true });
  }

  create(tenantId: string, input: CreatePartyInput): Promise<PartyRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'party', 'created', first(await tx.insert(parties).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Party'), {
        code: input.code, customer: input.isCustomer, supplier: input.isSupplier, subcontractor: input.isSubcontractor,
      }),
    );
  }
  get(tenantId: string, id: string): Promise<PartyRow> {
    return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, id))), 'Party'), { readOnly: true });
  }
  list(tenantId: string, q: ListPartiesQuery): Promise<Page<PartyRow>> {
    const role = q.role === 'customer' ? eq(parties.isCustomer, true) : q.role === 'supplier' ? eq(parties.isSupplier, true) : q.role === 'subcontractor' ? eq(parties.isSubcontractor, true) : undefined;
    return this.uow.inTenant(
      tenantId,
      (tx) => pageOf<PartyRow>(tx, parties, tenantId, q.limit, q.cursor, role, q.status ? eq(parties.status, q.status) : undefined, q.q ? or(ilike(parties.code, likePrefix(q.q)), ilike(parties.legalName, likePrefix(q.q))) : undefined),
      { readOnly: true },
    );
  }
  update(tenantId: string, id: string, version: number, input: UpdatePartyInput): Promise<PartyRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.creditLimit !== undefined && input.creditLimit !== null) {
        const current = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, id))), 'Party');
        if (!current.isCustomer) throw new AppError(422, 'constraint_violated', 'Only customers have a credit limit');
      }
      return this.recorder.record(tx, tenantId, 'party', 'updated', await updateVersioned<PartyRow>(tx, parties, tenantId, id, version, input, 'Party'), { fields: Object.keys(input), ...(input.status ? { status: input.status } : {}) });
    });
  }

  /** A new default address of a kind replaces the previous default of that kind. */
  addAddress(tenantId: string, partyId: string, input: CreateAddressInput): Promise<AddressRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      first(await tx.select({ id: parties.id }).from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId))).for('update'), 'Party');
      if (input.isDefault) {
        await tx.update(partyAddresses).set({ isDefault: false }).where(and(eq(partyAddresses.tenantId, tenantId), eq(partyAddresses.partyId, partyId), eq(partyAddresses.kind, input.kind), eq(partyAddresses.isDefault, true)));
      }
      return this.recorder.record(tx, tenantId, 'party_address', 'created', first(await tx.insert(partyAddresses).values({ tenantId, id: uuidv7(), partyId, ...input }).returning(), 'Address'), { partyId, kind: input.kind, stateCode: input.stateCode });
    });
  }
  listAddresses(tenantId: string, partyId: string): Promise<AddressRow[]> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        first(await tx.select({ id: parties.id }).from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId))), 'Party');
        return tx.select().from(partyAddresses).where(and(eq(partyAddresses.tenantId, tenantId), eq(partyAddresses.partyId, partyId))).orderBy(asc(partyAddresses.id));
      },
      { readOnly: true },
    );
  }
}

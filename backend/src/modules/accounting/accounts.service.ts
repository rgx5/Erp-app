import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import type { Page } from '../../platform/http/validation.js';
import { first, likePrefix, pageOf, Recorder, updateVersioned } from '../masterdata/helpers.js';
import { accounts } from './accounting.schema.js';
import type { CreateAccountInput, ListAccountsQuery, UpdateAccountInput } from './accounting.schemas.js';
import { MANUFACTURING_INDIA_TEMPLATE } from './template.js';

export type AccountRow = typeof accounts.$inferSelect;

@Injectable()
export class AccountsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, input: CreateAccountInput): Promise<AccountRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'account', 'created', first(await tx.insert(accounts).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Account'), { code: input.code, type: input.type, companyId: input.companyId }),
    );
  }

  get(tenantId: string, id: string): Promise<AccountRow> {
    return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, id))), 'Account'), { readOnly: true });
  }

  list(tenantId: string, q: ListAccountsQuery): Promise<Page<AccountRow>> {
    return this.uow.inTenant(
      tenantId,
      (tx) => pageOf<AccountRow>(tx, accounts, tenantId, q.limit, q.cursor, eq(accounts.companyId, q.companyId), q.type ? eq(accounts.type, q.type) : undefined, q.q ? or(ilike(accounts.code, likePrefix(q.q)), ilike(accounts.name, likePrefix(q.q))) : undefined),
      { readOnly: true },
    );
  }

  /** Name, code and status only: type, hierarchy and control kind are fixed (the database enforces it). */
  update(tenantId: string, id: string, version: number, input: UpdateAccountInput): Promise<AccountRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'account', 'updated', await updateVersioned<AccountRow>(tx, accounts, tenantId, id, version, input, 'Account'), { fields: Object.keys(input) }),
    );
  }

  /** Creates the starter chart in one transaction, and only into a company that has no accounts yet. */
  applyTemplate(tenantId: string, companyId: string): Promise<{ created: number }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const existing = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId))).limit(1);
      if (existing.length > 0) throw new AppError(409, 'chart_not_empty', 'This company already has accounts; the template can only seed an empty chart');
      const ids = new Map<string, string>();
      for (const a of MANUFACTURING_INDIA_TEMPLATE) {
        const id = uuidv7();
        ids.set(a.code, id);
        await tx.insert(accounts).values({
          tenantId, id, companyId, code: a.code, name: a.name, type: a.type, isGroup: a.group === true, controlKind: a.control ?? null,
          parentId: a.parent ? (ids.get(a.parent) ?? null) : null,
        });
      }
      await this.recorder.record(tx, tenantId, 'chart_of_accounts', 'template_applied', { id: companyId }, { companyId, template: 'manufacturing_india', accounts: ids.size });
      return { created: ids.size };
    });
  }
}

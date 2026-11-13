import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { accounts } from '../accounting/accounting.schema.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { salesSettings } from './sales.schema.js';
import type { SalesSettingsInput } from './sales.schemas.js';

export type SalesSettingsRow = typeof salesSettings.$inferSelect;

/** What each setting must be (a wrong account type would quietly corrupt the books). */
const RULES: Record<keyof SalesSettingsInput, { type: string; control?: string | null; label: string }> = {
  receivableAccountId: { type: 'asset', control: 'receivable', label: 'a receivables control account' },
  salesAccountId: { type: 'income', control: null, label: 'an ordinary income account' },
  serviceSalesAccountId: { type: 'income', control: null, label: 'an ordinary income account' },
  cogsAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
  roundOffAccountId: { type: '*', control: null, label: 'an ordinary (non-control) account' },
  outputCgstAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  outputSgstAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  outputIgstAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  outputCessAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  writeOffAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
};

@Injectable()
export class SalesSettingsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  get(tenantId: string, companyId: string): Promise<SalesSettingsRow | null> {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.select().from(salesSettings).where(and(eq(salesSettings.tenantId, tenantId), eq(salesSettings.companyId, companyId))))[0] ?? null, { readOnly: true });
  }

  put(tenantId: string, companyId: string, input: SalesSettingsInput): Promise<SalesSettingsRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const [field, id] of Object.entries(input) as [keyof SalesSettingsInput, string | null | undefined][]) {
        if (!id) continue;
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
        const rule = RULES[field];
        if (!a) throw validationFailed([{ path: field, message: 'This account does not exist in this company' }]);
        if (a.isGroup || a.status !== 'active' || (rule.type !== '*' && a.type !== rule.type) || (rule.control === null ? a.controlKind !== null : a.controlKind !== rule.control)) {
          throw validationFailed([{ path: field, message: `Must be ${rule.label}` }]);
        }
      }
      const [existing] = await tx.select().from(salesSettings).where(and(eq(salesSettings.tenantId, tenantId), eq(salesSettings.companyId, companyId))).for('update');
      const row = existing
        ? first(await tx.update(salesSettings).set(input).where(and(eq(salesSettings.tenantId, tenantId), eq(salesSettings.companyId, companyId))).returning(), 'Sales settings')
        : first(await tx.insert(salesSettings).values({ tenantId, companyId, ...input }).returning(), 'Sales settings');
      await this.recorder.record(tx, tenantId, 'sales_settings', 'updated', { id: companyId }, { companyId, fields: Object.keys(input) });
      return row;
    });
  }

  /** The settings a posting needs, or a 409 naming what is missing. */
  async require(tx: Tx, tenantId: string, companyId: string, needs: (keyof SalesSettingsInput)[]): Promise<SalesSettingsRow> {
    const [row] = await tx.select().from(salesSettings).where(and(eq(salesSettings.tenantId, tenantId), eq(salesSettings.companyId, companyId)));
    const missing = needs.filter((n) => !row || !row[n]);
    if (!row || missing.length > 0) throw new AppError(409, 'sales_accounts_not_configured', `Set these in the company sales settings first: ${missing.join(', ')}`, { missing });
    return row;
  }
}

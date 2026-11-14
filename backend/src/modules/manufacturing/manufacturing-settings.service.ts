import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { accounts } from '../accounting/accounting.schema.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { manufacturingSettings } from './manufacturing.schema.js';
import type { ManufacturingSettingsInput } from './manufacturing.schemas.js';

export type ManufacturingSettingsRow = typeof manufacturingSettings.$inferSelect;
export type MfgAccountSetting = keyof ManufacturingSettingsInput;

const RULES: Record<MfgAccountSetting, { type: string; control: string | null; label: string }> = {
  wipAccountId: { type: 'asset', control: 'work_in_progress', label: 'a work-in-progress control account' },
  labourAbsorbedAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
  overheadAbsorbedAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
  productionVarianceAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
  subcontractClearingAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
};

@Injectable()
export class ManufacturingSettingsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  get(tenantId: string, companyId: string): Promise<ManufacturingSettingsRow | null> {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.select().from(manufacturingSettings).where(and(eq(manufacturingSettings.tenantId, tenantId), eq(manufacturingSettings.companyId, companyId))))[0] ?? null, { readOnly: true });
  }

  put(tenantId: string, companyId: string, input: ManufacturingSettingsInput): Promise<ManufacturingSettingsRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const [field, id] of Object.entries(input) as [MfgAccountSetting, string | null | undefined][]) {
        if (!id) continue;
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
        const rule = RULES[field];
        if (!a) throw validationFailed([{ path: field, message: 'This account does not exist in this company' }]);
        if (a.isGroup || a.status !== 'active' || a.type !== rule.type || (rule.control === null ? a.controlKind !== null : a.controlKind !== rule.control)) throw validationFailed([{ path: field, message: `Must be ${rule.label}` }]);
      }
      const [existing] = await tx.select().from(manufacturingSettings).where(and(eq(manufacturingSettings.tenantId, tenantId), eq(manufacturingSettings.companyId, companyId))).for('update');
      const row = existing
        ? first(await tx.update(manufacturingSettings).set(input).where(and(eq(manufacturingSettings.tenantId, tenantId), eq(manufacturingSettings.companyId, companyId))).returning(), 'Manufacturing settings')
        : first(await tx.insert(manufacturingSettings).values({ tenantId, companyId, ...input }).returning(), 'Manufacturing settings');
      await this.recorder.record(tx, tenantId, 'manufacturing_settings', 'updated', { id: companyId }, { companyId, fields: Object.keys(input) });
      return row;
    });
  }

  async require(tx: Tx, tenantId: string, companyId: string, needs: MfgAccountSetting[]): Promise<ManufacturingSettingsRow> {
    const [row] = await tx.select().from(manufacturingSettings).where(and(eq(manufacturingSettings.tenantId, tenantId), eq(manufacturingSettings.companyId, companyId)));
    const missing = needs.filter((n) => !row || !row[n]);
    if (!row || missing.length > 0) throw new AppError(409, 'manufacturing_accounts_not_configured', `Set these in the company manufacturing settings first: ${missing.join(', ')}`, { missing });
    return row;
  }
}

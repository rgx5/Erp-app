import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { accounts } from '../accounting/accounting.schema.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { purchasingSettings } from './purchasing.schema.js';
import type { PurchasingSettingsInput } from './purchasing.schemas.js';

export type PurchasingSettingsRow = typeof purchasingSettings.$inferSelect;
export type AccountSetting = Exclude<keyof PurchasingSettingsInput, 'priceTolerancePercent' | 'quantityTolerancePercent'>;

/** What each account setting must be (a wrong account type would quietly corrupt the books). */
const RULES: Record<AccountSetting, { type: string; control?: string | null; label: string }> = {
  payableAccountId: { type: 'liability', control: 'payable', label: 'a payables control account' },
  grniAccountId: { type: 'liability', control: 'inventory', label: 'the inventory-control GRNI account' },
  purchasePriceVarianceAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
  expensePurchaseAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
  roundOffAccountId: { type: '*', control: null, label: 'an ordinary (non-control) account' },
  inputCgstAccountId: { type: 'asset', control: 'tax', label: 'a tax control asset account' },
  inputSgstAccountId: { type: 'asset', control: 'tax', label: 'a tax control asset account' },
  inputIgstAccountId: { type: 'asset', control: 'tax', label: 'a tax control asset account' },
  inputCessAccountId: { type: 'asset', control: 'tax', label: 'a tax control asset account' },
  rcmCgstAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  rcmSgstAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  rcmIgstAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  rcmCessAccountId: { type: 'liability', control: 'tax', label: 'a tax control liability account' },
  freightAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
  costVarianceAccountId: { type: 'expense', control: null, label: 'an ordinary expense account' },
};

@Injectable()
export class PurchasingSettingsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  get(tenantId: string, companyId: string): Promise<PurchasingSettingsRow | null> {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.select().from(purchasingSettings).where(and(eq(purchasingSettings.tenantId, tenantId), eq(purchasingSettings.companyId, companyId))))[0] ?? null, { readOnly: true });
  }

  put(tenantId: string, companyId: string, input: PurchasingSettingsInput): Promise<PurchasingSettingsRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const [field, id] of Object.entries(input) as [keyof PurchasingSettingsInput, string | null | undefined][]) {
        if (field === 'priceTolerancePercent' || field === 'quantityTolerancePercent' || !id) continue;
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
        const rule = RULES[field];
        if (!a) throw validationFailed([{ path: field, message: 'This account does not exist in this company' }]);
        if (a.isGroup || a.status !== 'active' || (rule.type !== '*' && a.type !== rule.type) || (rule.control === null ? a.controlKind !== null : a.controlKind !== rule.control)) {
          throw validationFailed([{ path: field, message: `Must be ${rule.label}` }]);
        }
      }
      const [existing] = await tx.select().from(purchasingSettings).where(and(eq(purchasingSettings.tenantId, tenantId), eq(purchasingSettings.companyId, companyId))).for('update');
      const row = existing
        ? first(await tx.update(purchasingSettings).set(input).where(and(eq(purchasingSettings.tenantId, tenantId), eq(purchasingSettings.companyId, companyId))).returning(), 'Purchasing settings')
        : first(await tx.insert(purchasingSettings).values({ tenantId, companyId, ...input }).returning(), 'Purchasing settings');
      await this.recorder.record(tx, tenantId, 'purchasing_settings', 'updated', { id: companyId }, { companyId, fields: Object.keys(input) });
      return row;
    });
  }

  /** The settings a posting needs, or a 409 naming what is missing. */
  async require(tx: Tx, tenantId: string, companyId: string, needs: AccountSetting[]): Promise<PurchasingSettingsRow> {
    const [row] = await tx.select().from(purchasingSettings).where(and(eq(purchasingSettings.tenantId, tenantId), eq(purchasingSettings.companyId, companyId)));
    const missing = needs.filter((n) => !row || !row[n]);
    if (!row || missing.length > 0) throw new AppError(409, 'purchasing_accounts_not_configured', `Set these in the company purchasing settings first: ${missing.join(', ')}`, { missing });
    return row;
  }
}

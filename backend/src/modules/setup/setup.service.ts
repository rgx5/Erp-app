import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { numberSeries } from '../../platform/services/platform.schema.js';
import { AppError } from '../../platform/http/errors.js';
import { AccountsService } from '../accounting/accounts.service.js';
import { accounts, fiscalYears, statementMappings } from '../accounting/accounting.schema.js';
import { StatementsService } from '../accounting/statements.service.js';
import { companyStockSettings, inventoryAccounts } from '../inventory/inventory.schema.js';
import { InventorySettingsService } from '../inventory/settings.service.js';
import { CatalogService } from '../masterdata/catalog.service.js';
import { taxCodes } from '../masterdata/masterdata.schema.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { businessLocations, companies, gstRegistrations, warehouses } from '../organization/organization.schema.js';
import { PurchasingSettingsService } from '../purchasing/purchasing-settings.service.js';
import { purchasingSettings } from '../purchasing/purchasing.schema.js';
import { SalesSettingsService } from '../sales/sales-settings.service.js';
import { salesSettings } from '../sales/sales.schema.js';

/** Which account (by its code in the starter chart) each setting uses. These are the recommended defaults; nothing already set is changed. */
export const INVENTORY_DEFAULTS: Record<string, string> = { raw_material: '1210', packing_material: '1220', semi_finished: '1240', finished_good: '1240', trading_good: '1240', consumable: '1250' };
export const STOCK_DEFAULTS = { adjustmentAccountId: '5300', openingBalanceAccountId: '3100' } as const;
export const SALES_DEFAULTS = {
  receivableAccountId: '1130', salesAccountId: '4100', serviceSalesAccountId: '4130', cogsAccountId: '5100', roundOffAccountId: '5900',
  outputCgstAccountId: '2210', outputSgstAccountId: '2220', outputIgstAccountId: '2230', writeOffAccountId: '5900',
} as const;
export const PURCHASING_DEFAULTS = {
  payableAccountId: '2110', grniAccountId: '2120', purchasePriceVarianceAccountId: '5400', expensePurchaseAccountId: '5900', roundOffAccountId: '5900', costVarianceAccountId: '5300', freightAccountId: '5220',
  inputCgstAccountId: '1310', inputSgstAccountId: '1320', inputIgstAccountId: '1330', rcmCgstAccountId: '2210', rcmSgstAccountId: '2220', rcmIgstAccountId: '2230',
} as const;
export const SERIES_DEFAULTS = [['tax_invoice', 'INV'], ['bill_of_supply', 'BOS'], ['credit_note', 'CN'], ['debit_note', 'DN']] as const;
export const TAX_DEFAULTS = [
  { code: 'GST0', name: 'GST 0%', kind: 'gst', rate: 0 }, { code: 'GST5', name: 'GST 5%', kind: 'gst', rate: 5 }, { code: 'GST12', name: 'GST 12%', kind: 'gst', rate: 12 },
  { code: 'GST18', name: 'GST 18%', kind: 'gst', rate: 18 }, { code: 'GST28', name: 'GST 28%', kind: 'gst', rate: 28 },
  { code: 'EXEMPT', name: 'Exempt supply', kind: 'exempt' }, { code: 'NIL', name: 'Nil rated', kind: 'nil_rated' },
] as const;

export interface SetupCheck { key: string; label: string; done: boolean; detail: string; /** `apply-defaults` can complete this step */ defaultable: boolean }
export interface SetupStep { key: string; action: 'created' | 'skipped' | 'blocked'; detail: string }

const ITEM_TYPES = Object.keys(INVENTORY_DEFAULTS);
const fyLabel = (startDate: string, endDate: string): string => `${startDate.slice(0, 4)}-${endDate.slice(2, 4)}`;

/** Tells a new business what is still missing before it can invoice, and fills in the standard Indian defaults for it. */
@Injectable()
export class SetupService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(AccountsService) private readonly chart: AccountsService,
    @Inject(StatementsService) private readonly statements: StatementsService,
    @Inject(InventorySettingsService) private readonly stock: InventorySettingsService,
    @Inject(SalesSettingsService) private readonly sales: SalesSettingsService,
    @Inject(PurchasingSettingsService) private readonly purchasing: PurchasingSettingsService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  private async company(tx: Tx, tenantId: string, companyId: string) {
    const [c] = await tx.select().from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)));
    if (!c) throw new AppError(404, 'not_found', 'Company not found');
    return c;
  }

  async status(tenantId: string, companyId: string): Promise<{ companyId: string; ready: boolean; canApplyDefaults: boolean; checks: SetupCheck[] }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.company(tx, tenantId, companyId);
      const n = async (q: Promise<{ n: number }[]>): Promise<number> => (await q)[0]?.n ?? 0;
      const regs = await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.companyId, companyId), eq(gstRegistrations.status, 'active')));
      const locations = await n(tx.select({ n: sql<number>`count(*)::int` }).from(businessLocations).where(and(eq(businessLocations.tenantId, tenantId), eq(businessLocations.companyId, companyId))));
      const whs = await n(tx.select({ n: sql<number>`count(*)::int` }).from(warehouses).innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId))).where(and(eq(warehouses.tenantId, tenantId), eq(businessLocations.companyId, companyId))));
      const years = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, companyId))).orderBy(asc(fiscalYears.startDate));
      const accountCount = await n(tx.select({ n: sql<number>`count(*)::int` }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId))));
      const mappings = await n(tx.select({ n: sql<number>`count(*)::int` }).from(statementMappings).where(and(eq(statementMappings.tenantId, tenantId), eq(statementMappings.companyId, companyId))));
      const mapped = new Set((await tx.select({ t: inventoryAccounts.itemType }).from(inventoryAccounts).where(and(eq(inventoryAccounts.tenantId, tenantId), eq(inventoryAccounts.companyId, companyId)))).map((r) => r.t));
      const [stock] = await tx.select().from(companyStockSettings).where(and(eq(companyStockSettings.tenantId, tenantId), eq(companyStockSettings.companyId, companyId)));
      const [sales] = await tx.select().from(salesSettings).where(and(eq(salesSettings.tenantId, tenantId), eq(salesSettings.companyId, companyId)));
      const [purchasingRow] = await tx.select().from(purchasingSettings).where(and(eq(purchasingSettings.tenantId, tenantId), eq(purchasingSettings.companyId, companyId)));
      const series = await tx.select().from(numberSeries).where(eq(numberSeries.tenantId, tenantId));
      const gstCodes = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM erp.tax_codes c WHERE c.tenant_id = ${tenantId}::uuid AND c.kind = 'gst' AND EXISTS (SELECT 1 FROM erp.tax_code_rates r WHERE r.tenant_id = c.tenant_id AND r.tax_code_id = c.id)`);

      const missing = (row: Record<string, unknown> | undefined, keys: string[]): string[] => keys.filter((k) => !row?.[k]);
      const stockMissing = missing(stock, Object.keys(STOCK_DEFAULTS));
      const salesMissing = missing(sales, Object.keys(SALES_DEFAULTS).filter((k) => k !== 'writeOffAccountId'));
      const purchMissing = missing(purchasingRow, ['payableAccountId', 'grniAccountId', 'purchasePriceVarianceAccountId', 'expensePurchaseAccountId', 'inputCgstAccountId', 'inputSgstAccountId', 'inputIgstAccountId']);
      const wantedSeries = regs.flatMap((r) => years.flatMap((y) => SERIES_DEFAULTS.map(([type]) => `${r.id}|${type}|${fyLabel(y.startDate, y.endDate)}`)));
      const haveSeries = new Set(series.map((s) => `${s.gstRegistrationId}|${s.documentType}|${s.financialYear}`));
      const seriesMissing = wantedSeries.filter((k) => !haveSeries.has(k)).length;
      const typesMissing = ITEM_TYPES.filter((t) => !mapped.has(t));

      const checks: SetupCheck[] = [
        { key: 'company', label: 'Company', done: true, detail: 'Created', defaultable: false },
        { key: 'gstRegistration', label: 'GST registration', done: regs.length > 0, detail: regs.length > 0 ? `${regs.length} active` : 'Add the company\'s GSTIN', defaultable: false },
        { key: 'businessLocation', label: 'Business location', done: locations > 0, detail: locations > 0 ? `${locations} location(s)` : 'Add the principal place of business', defaultable: false },
        { key: 'warehouse', label: 'Warehouse', done: whs > 0, detail: whs > 0 ? `${whs} warehouse(s)` : 'Add a warehouse for stock', defaultable: false },
        { key: 'fiscalYear', label: 'Financial year', done: years.length > 0, detail: years.length > 0 ? years.map((y) => fyLabel(y.startDate, y.endDate)).join(', ') : 'Open the current financial year', defaultable: false },
        { key: 'chartOfAccounts', label: 'Chart of accounts', done: accountCount > 0, detail: accountCount > 0 ? `${accountCount} accounts` : 'Start from the standard Indian chart', defaultable: true },
        { key: 'statementMapping', label: 'Financial statement mapping', done: mappings > 0, detail: mappings > 0 ? `${mappings} accounts mapped` : 'Map accounts to Schedule III lines', defaultable: true },
        { key: 'inventoryAccounts', label: 'Stock accounts', done: typesMissing.length === 0, detail: typesMissing.length === 0 ? 'Every item type has a stock account' : `Missing for: ${typesMissing.join(', ')}`, defaultable: true },
        { key: 'stockSettings', label: 'Stock adjustment and opening accounts', done: stockMissing.length === 0, detail: stockMissing.length === 0 ? 'Set' : `Missing: ${stockMissing.join(', ')}`, defaultable: true },
        { key: 'salesSettings', label: 'Sales accounts', done: salesMissing.length === 0, detail: salesMissing.length === 0 ? 'Set' : `Missing: ${salesMissing.join(', ')}`, defaultable: true },
        { key: 'purchasingSettings', label: 'Purchase accounts', done: purchMissing.length === 0, detail: purchMissing.length === 0 ? 'Set' : `Missing: ${purchMissing.join(', ')}`, defaultable: true },
        { key: 'numberSeries', label: 'Invoice number series', done: regs.length > 0 && years.length > 0 && seriesMissing === 0, detail: regs.length === 0 || years.length === 0 ? 'Needs a GST registration and a financial year first' : seriesMissing === 0 ? 'Set' : `${seriesMissing} series to create`, defaultable: true },
        { key: 'taxCodes', label: 'GST tax codes and rates', done: (gstCodes.rows[0]?.n ?? 0) > 0, detail: (gstCodes.rows[0]?.n ?? 0) > 0 ? 'Set' : 'Add the standard GST slabs', defaultable: true },
      ];
      return { companyId, ready: checks.every((c) => c.done), canApplyDefaults: checks.some((c) => c.defaultable && !c.done), checks };
    }, { readOnly: true });
  }

  /**
   * Fills in what is missing with the recommended Indian defaults. Safe to run again: it only creates what does not exist and never
   * changes a value that is already set. Each step commits on its own, so after a failure a re-run resumes where it stopped.
   */
  async applyDefaults(tenantId: string, companyId: string, input: { gstRegistrationId?: string | undefined }): Promise<{ steps: SetupStep[]; status: Awaited<ReturnType<SetupService['status']>> }> {
    const steps: SetupStep[] = [];
    const log = (key: string, action: SetupStep['action'], detail: string): void => { steps.push({ key, action, detail }); };
    const before = await this.status(tenantId, companyId);
    const open = (key: string): boolean => before.checks.find((c) => c.key === key)?.done === false;

    // 1. chart of accounts and statement mapping
    if (open('chartOfAccounts')) { const r = await this.chart.applyTemplate(tenantId, companyId); log('chartOfAccounts', 'created', `${r.created} accounts from the standard Indian chart`); } else log('chartOfAccounts', 'skipped', 'Already has accounts');
    if (open('statementMapping')) { await this.statements.applyTemplate(tenantId, companyId); log('statementMapping', 'created', 'Accounts mapped to Schedule III lines'); } else log('statementMapping', 'skipped', 'Already mapped');

    const byCode = await this.uow.inTenant(tenantId, async (tx) => new Map((await tx.select({ id: accounts.id, code: accounts.code }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId)))).map((a) => [a.code, a.id])), { readOnly: true });
    const id = (code: string): string | undefined => byCode.get(code);
    const pick = <T extends Record<string, string>>(map: T, current: Record<string, unknown> | null | undefined): { set: Record<string, string>; absent: string[] } => {
      const set: Record<string, string> = {};
      const absent: string[] = [];
      for (const [field, code] of Object.entries(map)) {
        if (current?.[field]) continue;
        const accountId = id(code);
        if (accountId) set[field] = accountId; else absent.push(code);
      }
      return { set, absent };
    };

    // retained earnings account for the year-end close
    const accSettings = await this.statements.getSettings(tenantId, companyId);
    if (!accSettings?.retainedEarningsAccountId && id('3200')) await this.statements.putSettings(tenantId, companyId, { retainedEarningsAccountId: id('3200') as string });

    // 2. stock accounts
    const mappedNow = new Set((await this.stock.listInventoryAccounts(tenantId, companyId)).map((a) => a.itemType));
    let mappedCount = 0;
    for (const [type, code] of Object.entries(INVENTORY_DEFAULTS)) {
      if (mappedNow.has(type)) continue;
      const accountId = id(code);
      if (!accountId) { log('inventoryAccounts', 'blocked', `Account ${code} for ${type} does not exist in this chart`); continue; }
      await this.stock.mapInventoryAccount(tenantId, companyId, type, accountId);
      mappedCount++;
    }
    log('inventoryAccounts', mappedCount > 0 ? 'created' : 'skipped', mappedCount > 0 ? `${mappedCount} item types mapped to stock accounts` : 'Nothing to map');

    const stockSettings = pick(STOCK_DEFAULTS, await this.stock.getSettings(tenantId, companyId));
    if (Object.keys(stockSettings.set).length > 0) { await this.stock.putSettings(tenantId, companyId, stockSettings.set); log('stockSettings', 'created', 'Adjustment and opening-balance accounts set'); } else log('stockSettings', stockSettings.absent.length > 0 ? 'blocked' : 'skipped', stockSettings.absent.length > 0 ? `Accounts ${stockSettings.absent.join(', ')} are not in this chart` : 'Already set');

    const sales = pick(SALES_DEFAULTS, await this.sales.get(tenantId, companyId));
    if (Object.keys(sales.set).length > 0) { await this.sales.put(tenantId, companyId, sales.set); log('salesSettings', 'created', `${Object.keys(sales.set).length} sales accounts set`); } else log('salesSettings', sales.absent.length > 0 ? 'blocked' : 'skipped', sales.absent.length > 0 ? `Accounts ${sales.absent.join(', ')} are not in this chart` : 'Already set');

    const purchasing = pick(PURCHASING_DEFAULTS, await this.purchasing.get(tenantId, companyId));
    if (Object.keys(purchasing.set).length > 0) { await this.purchasing.put(tenantId, companyId, purchasing.set); log('purchasingSettings', 'created', `${Object.keys(purchasing.set).length} purchase accounts set`); } else log('purchasingSettings', purchasing.absent.length > 0 ? 'blocked' : 'skipped', purchasing.absent.length > 0 ? `Accounts ${purchasing.absent.join(', ')} are not in this chart` : 'Already set');

    // 3. number series: every active registration x every financial year
    const { regs, years } = await this.uow.inTenant(tenantId, async (tx) => ({
      regs: await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.companyId, companyId), eq(gstRegistrations.status, 'active'), ...(input.gstRegistrationId ? [eq(gstRegistrations.id, input.gstRegistrationId)] : []))),
      years: await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, companyId))).orderBy(asc(fiscalYears.startDate)),
    }), { readOnly: true });
    if (regs.length === 0 || years.length === 0) {
      log('numberSeries', 'blocked', 'Add a GST registration and open a financial year first');
    } else {
      const existing = await this.uow.inTenant(tenantId, async (tx) => new Set((await tx.select().from(numberSeries).where(eq(numberSeries.tenantId, tenantId))).map((s) => `${s.gstRegistrationId}|${s.documentType}|${s.financialYear}`)), { readOnly: true });
      let made = 0;
      for (const reg of regs) for (const y of years) for (const [documentType, prefix] of SERIES_DEFAULTS) {
        const financialYear = fyLabel(y.startDate, y.endDate);
        if (existing.has(`${reg.id}|${documentType}|${financialYear}`)) continue;
        await this.numbering.createSeries(tenantId, { gstRegistrationId: reg.id, documentType, financialYear, prefix, separator: '/', includeFinancialYear: true, padding: 5, startAt: 1 });
        made++;
      }
      log('numberSeries', made > 0 ? 'created' : 'skipped', made > 0 ? `${made} number series created` : 'Already set');
    }

    // 4. GST slabs (rates effective from the start of the first financial year)
    const start = years[0]?.startDate;
    const haveCodes = await this.uow.inTenant(tenantId, async (tx) => new Set((await tx.select({ c: taxCodes.code }).from(taxCodes).where(eq(taxCodes.tenantId, tenantId))).map((r) => r.c)), { readOnly: true });
    if (!start) log('taxCodes', 'blocked', 'Open a financial year first (rates start from its first day)');
    else {
      let made = 0;
      for (const t of TAX_DEFAULTS) {
        if (haveCodes.has(t.code)) continue;
        const code = await this.catalog.createTaxCode(tenantId, { code: t.code, name: t.name, kind: t.kind });
        if ('rate' in t) await this.catalog.addTaxRate(tenantId, code.id, { effectiveFrom: start, igstRate: t.rate, cessRate: 0 });
        made++;
      }
      log('taxCodes', made > 0 ? 'created' : 'skipped', made > 0 ? `${made} GST tax codes added` : 'Already set');
    }

    return { steps, status: await this.status(tenantId, companyId) };
  }
}

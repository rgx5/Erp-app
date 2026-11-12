import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lte, or, gte } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { Tx } from '../../platform/database/database.js';
import { AppError, notFound } from '../../platform/http/errors.js';
import type { Page } from '../../platform/http/validation.js';
import { first, pageOf, Recorder, updateVersioned } from './helpers.js';
import { currencies, exchangeRates, taxCodeRates, taxCodes, units } from './masterdata.schema.js';
import type { CreateCurrencyInput, CreateExchangeRateInput, CreateTaxCodeInput, CreateTaxRateInput, CreateUnitInput, UpdateCurrencyInput, UpdateTaxCodeInput, UpdateUnitInput } from './masterdata.schemas.js';

export type CurrencyRow = typeof currencies.$inferSelect;
export type ExchangeRateRow = typeof exchangeRates.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type TaxCodeRow = typeof taxCodes.$inferSelect;
export type TaxRateRow = typeof taxCodeRates.$inferSelect;

/** Day before an ISO date (`2025-04-01` -> `2025-03-31`), without time-zone arithmetic. */
export const dayBefore = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Currencies, exchange rates, units of measure and effective-dated tax codes. */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- currencies & exchange rates ------------------------------------------------------------------------------
  createCurrency(tenantId: string, input: CreateCurrencyInput): Promise<CurrencyRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'currency', 'created', first(await tx.insert(currencies).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Currency'), { code: input.code }),
    );
  }
  listCurrencies(tenantId: string, limit: number, cursor?: string): Promise<Page<CurrencyRow>> {
    return this.uow.inTenant(tenantId, (tx) => pageOf<CurrencyRow>(tx, currencies, tenantId, limit, cursor), { readOnly: true });
  }
  updateCurrency(tenantId: string, id: string, version: number, input: UpdateCurrencyInput): Promise<CurrencyRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'currency', 'updated', await updateVersioned<CurrencyRow>(tx, currencies, tenantId, id, version, input, 'Currency'), { fields: Object.keys(input) }),
    );
  }

  createExchangeRate(tenantId: string, input: CreateExchangeRateInput): Promise<ExchangeRateRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'exchange_rate', 'created', first(await tx.insert(exchangeRates).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Exchange rate'), {
        from: input.fromCurrency, to: input.toCurrency, rate: input.rate, effectiveDate: input.effectiveDate,
      }),
    );
  }
  listExchangeRates(tenantId: string, limit: number, cursor: string | undefined, from?: string, to?: string): Promise<Page<ExchangeRateRow>> {
    return this.uow.inTenant(tenantId, (tx) => pageOf<ExchangeRateRow>(tx, exchangeRates, tenantId, limit, cursor, from ? eq(exchangeRates.fromCurrency, from) : undefined, to ? eq(exchangeRates.toCurrency, to) : undefined), { readOnly: true });
  }
  /** The rate in force on `date`: the latest one on or before it. Same currency is 1. Inverse rates are NOT derived. */
  rateOn(tx: Tx, tenantId: string, from: string, to: string, date: string): Promise<{ rate: string; effectiveDate: string }> {
    if (from === to) return Promise.resolve({ rate: '1', effectiveDate: date });
    return tx
      .select({ rate: exchangeRates.rate, effectiveDate: exchangeRates.effectiveDate })
      .from(exchangeRates)
      .where(and(eq(exchangeRates.tenantId, tenantId), eq(exchangeRates.fromCurrency, from), eq(exchangeRates.toCurrency, to), lte(exchangeRates.effectiveDate, date)))
      .orderBy(desc(exchangeRates.effectiveDate))
      .limit(1)
      .then((rows) => {
        if (!rows[0]) throw new AppError(404, 'exchange_rate_missing', `No ${from}->${to} exchange rate is in force on ${date}`);
        return rows[0];
      });
  }
  resolveRate(tenantId: string, from: string, to: string, date: string) {
    return this.uow.inTenant(tenantId, (tx) => this.rateOn(tx, tenantId, from, to, date), { readOnly: true });
  }

  // ---- units --------------------------------------------------------------------------------------------------
  createUnit(tenantId: string, input: CreateUnitInput): Promise<UnitRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'unit', 'created', first(await tx.insert(units).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Unit'), { code: input.code }),
    );
  }
  listUnits(tenantId: string, limit: number, cursor?: string): Promise<Page<UnitRow>> {
    return this.uow.inTenant(tenantId, (tx) => pageOf<UnitRow>(tx, units, tenantId, limit, cursor), { readOnly: true });
  }
  updateUnit(tenantId: string, id: string, version: number, input: UpdateUnitInput): Promise<UnitRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'unit', 'updated', await updateVersioned<UnitRow>(tx, units, tenantId, id, version, input, 'Unit'), { fields: Object.keys(input) }),
    );
  }

  // ---- tax codes ----------------------------------------------------------------------------------------------
  createTaxCode(tenantId: string, input: CreateTaxCodeInput): Promise<TaxCodeRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'tax_code', 'created', first(await tx.insert(taxCodes).values({ tenantId, id: uuidv7(), ...input }).returning(), 'Tax code'), { code: input.code, kind: input.kind }),
    );
  }
  listTaxCodes(tenantId: string, limit: number, cursor?: string): Promise<Page<TaxCodeRow>> {
    return this.uow.inTenant(tenantId, (tx) => pageOf<TaxCodeRow>(tx, taxCodes, tenantId, limit, cursor), { readOnly: true });
  }
  getTaxCode(tenantId: string, id: string): Promise<TaxCodeRow> {
    return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(taxCodes).where(and(eq(taxCodes.tenantId, tenantId), eq(taxCodes.id, id))), 'Tax code'), { readOnly: true });
  }
  updateTaxCode(tenantId: string, id: string, version: number, input: UpdateTaxCodeInput): Promise<TaxCodeRow> {
    return this.uow.inTenant(tenantId, async (tx) =>
      this.recorder.record(tx, tenantId, 'tax_code', 'updated', await updateVersioned<TaxCodeRow>(tx, taxCodes, tenantId, id, version, input, 'Tax code'), { fields: Object.keys(input) }),
    );
  }

  /**
   * Adds a rate version. If the code has an open-ended version that started before the new one, it is closed the day before
   * (so "the rate changed on 1 Oct" is one call). The database refuses any overlap, so history can never be ambiguous.
   * Only `gst` codes carry a rate; the IGST rate is given and CGST/SGST are each half.
   */
  addTaxRate(tenantId: string, taxCodeId: string, input: CreateTaxRateInput): Promise<TaxRateRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const code = first(await tx.select().from(taxCodes).where(and(eq(taxCodes.tenantId, tenantId), eq(taxCodes.id, taxCodeId))).for('update'), 'Tax code');
      if (code.kind !== 'gst' && (input.igstRate !== 0 || input.cessRate !== 0)) throw new AppError(422, 'rate_not_allowed', `A ${code.kind} tax code cannot carry a rate`);
      const open = await tx
        .select()
        .from(taxCodeRates)
        .where(and(eq(taxCodeRates.tenantId, tenantId), eq(taxCodeRates.taxCodeId, taxCodeId), isNull(taxCodeRates.effectiveTo)));
      for (const previous of open) {
        if (previous.effectiveFrom < input.effectiveFrom) {
          await tx.update(taxCodeRates).set({ effectiveTo: dayBefore(input.effectiveFrom) }).where(and(eq(taxCodeRates.tenantId, tenantId), eq(taxCodeRates.id, previous.id)));
        }
      }
      const half = (input.igstRate / 2).toFixed(4);
      const row = first(
        await tx
          .insert(taxCodeRates)
          .values({ tenantId, id: uuidv7(), taxCodeId, effectiveFrom: input.effectiveFrom, igstRate: input.igstRate.toFixed(4), cgstRate: half, sgstRate: half, cessRate: input.cessRate.toFixed(4) })
          .returning(),
        'Tax rate',
      );
      return this.recorder.record(tx, tenantId, 'tax_rate', 'created', row, { taxCodeId, code: code.code, effectiveFrom: input.effectiveFrom, igstRate: input.igstRate, cessRate: input.cessRate });
    });
  }
  listTaxRates(tenantId: string, taxCodeId: string): Promise<TaxRateRow[]> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        first(await tx.select({ id: taxCodes.id }).from(taxCodes).where(and(eq(taxCodes.tenantId, tenantId), eq(taxCodes.id, taxCodeId))), 'Tax code');
        return tx.select().from(taxCodeRates).where(and(eq(taxCodeRates.tenantId, tenantId), eq(taxCodeRates.taxCodeId, taxCodeId))).orderBy(desc(taxCodeRates.effectiveFrom));
      },
      { readOnly: true },
    );
  }
  /** The rate version in force on a date. Documents call this with their OWN date, so back-dated documents get the right rate. */
  async taxRateOn(tx: Tx, tenantId: string, taxCodeId: string, date: string): Promise<TaxRateRow> {
    const [row] = await tx
      .select()
      .from(taxCodeRates)
      .where(and(eq(taxCodeRates.tenantId, tenantId), eq(taxCodeRates.taxCodeId, taxCodeId), lte(taxCodeRates.effectiveFrom, date), or(isNull(taxCodeRates.effectiveTo), gte(taxCodeRates.effectiveTo, date))));
    if (!row) throw notFound(`A tax rate in force on ${date}`);
    return row;
  }
  resolveTaxRate(tenantId: string, taxCodeId: string, date: string): Promise<TaxRateRow> {
    return this.uow.inTenant(tenantId, (tx) => this.taxRateOn(tx, tenantId, taxCodeId, date), { readOnly: true });
  }
}

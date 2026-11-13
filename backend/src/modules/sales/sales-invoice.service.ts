import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { journalLines } from '../accounting/accounting.schema.js';
import { toUnits as moneyToUnits } from '../accounting/money.js';
import { PostingService, type PostingLine } from '../accounting/posting.service.js';
import { qty, value as stockValue } from '../inventory/decimal.js';
import { stockLedger, stockLedgerSerials, stockSerials } from '../inventory/inventory.schema.js';
import { StockService, type MoveLine } from '../inventory/stock.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { CatalogService } from '../masterdata/catalog.service.js';
import { items, parties, partyAddresses, paymentTerms, taxCodes } from '../masterdata/masterdata.schema.js';
import { financialYearOf, NumberingService } from '../numbering/numbering.service.js';
import { numberAllocations } from '../../platform/services/platform.schema.js';
import { businessLocations, gstRegistrations } from '../organization/organization.schema.js';
import { computeInvoice, computeLine, paiseToMoney, placeOfSupply, supplyTypeOf, taxRegime, type LineTax, type Rates, type TaxRegime } from './gst.js';
import { receivableAllocations, salesInvoiceLines, salesInvoices } from './sales.schema.js';
import type { CreateInvoiceInput, CreateNoteInput, ListInvoicesQuery } from './sales.schemas.js';
import { SalesSettingsService, type SalesSettingsRow } from './sales-settings.service.js';

export type InvoiceRow = typeof salesInvoices.$inferSelect;
export type InvoiceLineRow = typeof salesInvoiceLines.$inferSelect;
export interface Posted { invoice: InvoiceRow; lines: InvoiceLineRow[]; warnings: { code: string; message: string; [k: string]: unknown }[] }

const ZERO: Rates = { igst: '0', cgst: '0', sgst: '0', cess: '0' };
const moneyOf = (paise: bigint): string => paiseToMoney(paise);

/** A document line after pricing and tax, before it is written. */
interface PricedLine {
  itemId: string; originalLineId?: string; description: string; hsn: string | null; quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean;
  taxCodeId: string | null; rates: Rates; tax: LineTax; isService: boolean;
  warehouseId?: string | undefined; batchId?: string | undefined; serialNos?: string[] | undefined; unitCost?: string; costValue?: string; stock: boolean;
  orderLineId?: string | undefined; reservationId?: string | undefined;
}

/** Set when an invoice is raised from a sales order. */
export interface InvoiceExtras { orderId?: string; lines?: { orderLineId?: string; reservationId?: string }[] }

/**
 * Tax invoices, bills of supply, credit notes (with stock returns), debit notes and cancellations. One call posts everything the
 * document means: the number, stock out/in at cost, the receivable/revenue/tax/round-off journal, the document itself, audit and
 * event, in one transaction. A document that cannot post leaves nothing behind (not even its number).
 */
@Injectable()
export class SalesInvoiceService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(SalesSettingsService) private readonly settings: SalesSettingsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- tax invoice / bill of supply ---------------------------------------------------------------------------------
  createInvoice(tenantId: string, actorId: string, input: CreateInvoiceInput): Promise<Posted> {
    return this.uow.inTenant(tenantId, (tx) => this.postInvoice(tx, tenantId, actorId, input));
  }

  /**
   * Validates and prices a document without posting anything: registration, customer, place of supply, tax rates in force, per-line
   * tax and totals. Invoices post the result; quotes and orders use it for estimates.
   */
  async priceDocument(tx: Tx, tenantId: string, input: CreateInvoiceInput, opts: { requireWarehouse: boolean }) {
    const registration = await this.registrationFor(tx, tenantId, input.companyId, input.gstRegistrationId, input.invoiceDate, input.documentType);
    if (input.businessLocationId) {
      const [loc] = await tx.select({ id: businessLocations.id }).from(businessLocations).where(and(eq(businessLocations.tenantId, tenantId), eq(businessLocations.companyId, input.companyId), eq(businessLocations.id, input.businessLocationId)));
      if (!loc) throw validationFailed([{ path: 'businessLocationId', message: 'This location does not belong to the company' }]);
    }
    const customer = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, input.customerId))), 'Customer');
    if (!customer.isCustomer) throw new AppError(422, 'not_a_customer', `${customer.code} is not a customer`);
    if (customer.status !== 'active') throw new AppError(422, 'customer_not_active', `${customer.code} is ${customer.status}`);

    const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))])))).map((i) => [i.id, i]));
    const supplyType = supplyTypeOf(customer.gstTreatment);
    if ((supplyType === 'sez' || supplyType === 'export') && !input.taxPayment) throw validationFailed([{ path: 'taxPayment', message: 'SEZ and export supplies need taxPayment: with_payment or without_payment' }]);
    if (supplyType !== 'sez' && supplyType !== 'export' && input.taxPayment) throw validationFailed([{ path: 'taxPayment', message: 'Only SEZ and export supplies take taxPayment' }]);

    const billTo = await this.addressState(tx, tenantId, customer.id, input.billToAddressId, 'billing');
    const shipTo = await this.addressState(tx, tenantId, customer.id, input.shipToAddressId, 'shipping');
    const anyGoods = input.lines.some((l) => itemRows.get(l.itemId)?.itemType !== 'service');
    const anyServices = input.lines.some((l) => itemRows.get(l.itemId)?.itemType === 'service');
    const supplierState = registration.stateCode;
    const common = { supplierState, supplyType, billToState: billTo, shipToState: shipTo, override: input.placeOfSupplyState };
    const goodsPos = anyGoods ? placeOfSupply({ ...common, kind: 'goods' }) : undefined;
    const servicesPos = anyServices ? placeOfSupply({ ...common, kind: 'services' }) : undefined;
    if (goodsPos && servicesPos && goodsPos !== servicesPos) throw new AppError(422, 'mixed_place_of_supply', `Goods and services have different places of supply (${goodsPos}, ${servicesPos}); issue separate invoices`);
    const pos = (goodsPos ?? servicesPos) as string;
    const regime = taxRegime(supplierState, pos, supplyType);
    const noTax = registration.registrationType === 'composition' || input.documentType === 'bill_of_supply' || input.taxPayment === 'without_payment';

    const lines: PricedLine[] = [];
    for (const [i, l] of input.lines.entries()) {
      const item = itemRows.get(l.itemId);
      if (!item) throw validationFailed([{ path: `lines.${i}.itemId`, message: 'This item does not exist' }]);
      if (!item.isSellable || item.status !== 'active') throw new AppError(422, 'item_not_sellable', `${item.code} cannot be sold`);
      const { taxCodeId, rates } = noTax ? { taxCodeId: l.taxCodeId ?? item.taxCodeId ?? null, rates: ZERO } : await this.ratesFor(tx, tenantId, item.code, l.taxCodeId ?? item.taxCodeId, input.invoiceDate);
      if (opts.requireWarehouse && item.isStocked && !l.warehouseId) throw validationFailed([{ path: `lines.${i}.warehouseId`, message: `${item.code} is stocked: say which warehouse it leaves` }]);
      if (!item.isStocked && (l.warehouseId || l.batchId || l.serialNos)) throw validationFailed([{ path: `lines.${i}`, message: `${item.code} is a service: no warehouse, batch or serial numbers` }]);
      // Only the rates that apply to this supply are recorded on the line.
      const applied: Rates = regime === 'intra' ? { ...rates, igst: '0' } : { ...rates, cgst: '0', sgst: '0' };
      const tax = computeLine({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, rates: applied }, regime, !noTax);
      lines.push({ itemId: l.itemId, description: l.description ?? item.name, hsn: item.hsnSacCode, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxCodeId, rates: applied, tax, isService: item.itemType === 'service', warehouseId: l.warehouseId, batchId: l.batchId, serialNos: l.serialNos, stock: item.isStocked });
    }
    const totals = computeInvoice(lines.map((l) => l.tax), input.reverseCharge);
    if (input.documentType === 'bill_of_supply' && totals.cgst + totals.sgst + totals.igst + totals.cess > 0n) throw new AppError(422, 'bill_of_supply_has_tax', 'A bill of supply cannot carry tax');

    return { registration, customer, supplyType, pos, regime, lines, totals };
  }

  async postInvoice(tx: Tx, tenantId: string, actorId: string, input: CreateInvoiceInput, extras: InvoiceExtras = {}): Promise<Posted> {
    const { registration, customer, supplyType, pos, regime, lines, totals } = await this.priceDocument(tx, tenantId, input, { requireWarehouse: true });
    lines.forEach((l, i) => {
      const e = extras.lines?.[i];
      if (e) {
        l.orderLineId = e.orderLineId;
        l.reservationId = e.reservationId;
      }
    });
    const invoiceId = uuidv7();
    const allocation = await this.number(tx, tenantId, registration.id, input.documentType, input.invoiceDate, invoiceId);
    const header = {
      companyId: input.companyId, gstRegistrationId: registration.id, businessLocationId: input.businessLocationId ?? null, documentType: input.documentType, invoiceNo: allocation, invoiceDate: input.invoiceDate,
      customerId: customer.id, customerName: customer.tradeName ?? customer.legalName, customerGstin: customer.gstin, customerGstTreatment: customer.gstTreatment, placeOfSupply: pos, supplyType,
      taxPayment: input.taxPayment ?? null, reverseCharge: input.reverseCharge, taxRegime: regime, originalInvoiceId: null, reason: null, orderId: extras.orderId ?? null, dueDate: await this.dueDate(tx, tenantId, customer.paymentTermsId, input.invoiceDate),
    };
    return this.finish(tx, tenantId, actorId, invoiceId, header, lines, totals, 'invoice');
  }

  // ---- credit and debit notes -----------------------------------------------------------------------------------------
  createCreditNote(tenantId: string, actorId: string, input: CreateNoteInput): Promise<Posted> {
    return this.uow.inTenant(tenantId, (tx) => this.postNote(tx, tenantId, actorId, input, 'credit_note'));
  }
  createDebitNote(tenantId: string, actorId: string, input: CreateNoteInput): Promise<Posted> {
    return this.uow.inTenant(tenantId, (tx) => this.postNote(tx, tenantId, actorId, input, 'debit_note'));
  }

  private async postNote(tx: Tx, tenantId: string, actorId: string, input: CreateNoteInput, kind: 'credit_note' | 'debit_note'): Promise<Posted> {
    const original = first(await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, input.originalInvoiceId))).for('share'), 'Original invoice');
    if (original.documentType === 'credit_note' || original.documentType === 'debit_note') throw new AppError(422, 'original_is_a_note', 'A note must refer to an invoice, not to another note');
    if (original.status !== 'posted') throw new AppError(409, 'invoice_cancelled', 'This invoice was cancelled');
    if (input.noteDate < original.invoiceDate) throw validationFailed([{ path: 'noteDate', message: 'A note cannot be dated before its invoice' }]);
    const originalLines = new Map((await tx.select().from(salesInvoiceLines).where(and(eq(salesInvoiceLines.tenantId, tenantId), eq(salesInvoiceLines.invoiceId, original.id)))).map((l) => [l.id, l]));
    const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set([...originalLines.values()].map((l) => l.itemId))])))).map((i) => [i.id, i]));
    const charge = original.taxPayment !== 'without_payment';

    const credited = new Map<string, bigint>();
    if (kind === 'credit_note') {
      const rows = await tx.execute<{ original_line_id: string; q: string }>(sql`
        SELECT l.original_line_id, SUM(l.quantity)::text AS q FROM erp.sales_invoice_lines l JOIN erp.sales_invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
         WHERE l.tenant_id = ${tenantId}::uuid AND i.original_invoice_id = ${original.id}::uuid AND i.document_type = 'credit_note' AND i.status = 'posted' GROUP BY l.original_line_id`);
      for (const r of rows.rows) credited.set(r.original_line_id, qty.parse(r.q));
    }
    const lines: PricedLine[] = [];
    const taken = new Map<string, bigint>();
    for (const [i, l] of input.lines.entries()) {
      const o = originalLines.get(l.originalLineId);
      if (!o) throw validationFailed([{ path: `lines.${i}.originalLineId`, message: 'This line is not on the original invoice' }]);
      const item = itemRows.get(o.itemId) as typeof items.$inferSelect;
      const q = qty.parse(l.quantity);
      if (kind === 'credit_note') {
        const used = (credited.get(o.id) ?? 0n) + (taken.get(o.id) ?? 0n);
        if (used + q > qty.parse(o.quantity)) throw new AppError(409, 'credit_exceeds_invoice', `Line ${o.lineNo} was invoiced for ${o.quantity} and ${qty.format(used)} is already credited or credited in this note`, { lineNo: o.lineNo });
        taken.set(o.id, (taken.get(o.id) ?? 0n) + q);
      }
      const unitPrice = l.unitPrice ?? o.unitPrice;
      if (moneyToUnits(unitPrice) > moneyToUnits(o.unitPrice) && kind === 'credit_note') throw validationFailed([{ path: `lines.${i}.unitPrice`, message: 'A credit note cannot credit more than the invoiced price' }]);
      const rates: Rates = { igst: o.igstRate, cgst: o.cgstRate, sgst: o.sgstRate, cess: o.cessRate }; // a note reverses at the ORIGINAL rate
      const tax = computeLine({ quantity: l.quantity, unitPrice, discountPercent: o.discountPercent, taxInclusive: false, rates }, original.taxRegime as TaxRegime, charge);
      const priced: PricedLine = { itemId: o.itemId, originalLineId: o.id, description: o.description, hsn: o.hsnSacCode, quantity: l.quantity, unitPrice, discountPercent: o.discountPercent, taxInclusive: false, taxCodeId: o.taxCodeId, rates, tax, isService: item.itemType === 'service', stock: false };
      if (kind === 'credit_note' && item.isStocked && l.returnStock !== false) {
        if (o.unitCost === null) throw new AppError(409, 'no_cost_recorded', `Line ${o.lineNo} has no recorded cost to return stock at`);
        priced.stock = true;
        priced.warehouseId = l.warehouseId ?? o.warehouseId ?? undefined;
        priced.batchId = o.batchId ?? undefined;
        priced.unitCost = o.unitCost;
        if (item.tracking === 'serial') {
          const allowed = new Set(o.serialNos ?? []);
          if (!l.serialNos || BigInt(l.serialNos.length) * 10n ** 6n !== q || l.serialNos.some((s) => !allowed.has(s))) throw new AppError(422, 'serial_required', `Line ${o.lineNo}: give the serial numbers being returned (from those invoiced)`);
          priced.serialNos = l.serialNos;
        }
      }
      lines.push(priced);
    }
    const totals = computeInvoice(lines.map((l) => l.tax), original.reverseCharge);
    const noteId = uuidv7();
    const noteNo = await this.number(tx, tenantId, original.gstRegistrationId, kind, input.noteDate, noteId);
    const header = {
      companyId: original.companyId, gstRegistrationId: original.gstRegistrationId, businessLocationId: original.businessLocationId, documentType: kind, invoiceNo: noteNo, invoiceDate: input.noteDate,
      customerId: original.customerId, customerName: original.customerName, customerGstin: original.customerGstin, customerGstTreatment: original.customerGstTreatment, placeOfSupply: original.placeOfSupply,
      supplyType: original.supplyType, taxPayment: original.taxPayment, reverseCharge: original.reverseCharge, taxRegime: original.taxRegime, originalInvoiceId: original.id, reason: input.reason,
    };
    return this.finish(tx, tenantId, actorId, noteId, header, lines, totals, kind);
  }

  // ---- the shared posting step ----------------------------------------------------------------------------------------
  private async finish(tx: Tx, tenantId: string, actorId: string, documentId: string, header: Omit<typeof salesInvoices.$inferInsert, 'tenantId' | 'id' | 'taxableTotal' | 'grandTotal'>, lines: PricedLine[], totals: ReturnType<typeof computeInvoice>, kind: 'invoice' | 'credit_note' | 'debit_note'): Promise<Posted> {
    const taxCharged = !header.reverseCharge;
    const needs: Parameters<SalesSettingsService['require']>[3] = ['receivableAccountId'];
    if (lines.some((l) => !l.isService)) needs.push('salesAccountId');
    else if (lines.some((l) => l.isService)) needs.push('serviceSalesAccountId');
    if (lines.some((l) => l.stock)) needs.push('cogsAccountId');
    if (totals.roundOff !== 0n) needs.push('roundOffAccountId');
    if (taxCharged && totals.cgst > 0n) needs.push('outputCgstAccountId', 'outputSgstAccountId');
    if (taxCharged && totals.igst > 0n) needs.push('outputIgstAccountId');
    if (taxCharged && totals.cess > 0n) needs.push('outputCessAccountId');
    const settings = await this.settings.require(tx, tenantId, header.companyId, needs);

    // Stock: an invoice issues at cost, a credit note returns at the original cost.
    let movementId: string | null = null;
    const stockLines = lines.filter((l) => l.stock);
    if (stockLines.length > 0) {
      const moveLines: MoveLine[] = stockLines.map((l) => (kind === 'credit_note'
        ? { warehouseId: l.warehouseId as string, itemId: l.itemId, direction: 'in' as const, quantity: l.quantity, unitCost: l.unitCost, batchId: l.batchId, serialNos: l.serialNos, restore: l.serialNos !== undefined }
        : { warehouseId: l.warehouseId as string, itemId: l.itemId, direction: 'out' as const, quantity: l.quantity, batchId: l.batchId, serialNos: l.serialNos, reservationId: l.reservationId }));
      const { movement, results } = await this.stock.move(tx, tenantId, {
        companyId: header.companyId, movementType: kind === 'credit_note' ? 'receipt' : 'issue', postingDate: header.invoiceDate, description: `${kind === 'credit_note' ? 'Return against' : 'Sale'} ${header.invoiceNo}`,
        offsetAccountId: settings.cogsAccountId as string, allowControlOffset: true, lines: moveLines, source: { type: 'sales_invoice', id: documentId, event: kind === 'credit_note' ? 'return' : 'issue' }, postedBy: actorId,
      });
      movementId = movement.id;
      stockLines.forEach((l, idx) => {
        const r = results[idx];
        if (r && kind !== 'credit_note') {
          l.unitCost = r.ledger.unitCost;
          l.costValue = r.ledger.value.replace('-', '');
        } else if (r) l.costValue = r.ledger.value;
      });
    }

    // Journal
    let journalId: string | null = null;
    if (totals.taxable > 0n || totals.grand > 0n) {
      const credit = kind === 'credit_note';
      const jl: PostingLine[] = [];
      const add = (accountId: string | null, paise: bigint, side: 'dr' | 'cr', partyId?: string) => {
        if (paise === 0n || !accountId) return;
        const dr = side === 'dr';
        jl.push({ accountId, ...(dr ? { debit: moneyOf(paise) } : { credit: moneyOf(paise) }), partyId, description: `${header.invoiceNo}` });
      };
      const goods = lines.filter((l) => !l.isService).reduce((a, l) => a + l.tax.taxable, 0n);
      const services = lines.filter((l) => l.isService).reduce((a, l) => a + l.tax.taxable, 0n);
      const revenueSide = credit ? 'dr' : 'cr';
      add(settings.salesAccountId, goods, revenueSide);
      add(settings.serviceSalesAccountId ?? settings.salesAccountId, services, revenueSide);
      if (taxCharged) {
        add(settings.outputCgstAccountId, totals.cgst, revenueSide);
        add(settings.outputSgstAccountId, totals.sgst, revenueSide);
        add(settings.outputIgstAccountId, totals.igst, revenueSide);
        add(settings.outputCessAccountId, totals.cess, revenueSide);
      }
      // grand = payable + roundOff: a positive round-off is extra income, a negative one a concession
      if (totals.roundOff > 0n) add(settings.roundOffAccountId, totals.roundOff, credit ? 'dr' : 'cr');
      if (totals.roundOff < 0n) add(settings.roundOffAccountId, -totals.roundOff, credit ? 'cr' : 'dr');
      add(settings.receivableAccountId, totals.grand, credit ? 'cr' : 'dr', header.customerId);
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: header.companyId, postingDate: header.invoiceDate, journalType: 'system', description: `${header.documentType.replaceAll('_', ' ')} ${header.invoiceNo} to ${header.customerName}`, lines: jl,
        source: { type: 'sales_invoice', id: documentId, event: 'revenue' }, postedBy: actorId,
      });
      journalId = entry.id;
    }

    const invoice = first(
      await tx
        .insert(salesInvoices)
        .values({
          ...header, tenantId, id: documentId, taxableTotal: moneyOf(totals.taxable), cgstTotal: moneyOf(totals.cgst), sgstTotal: moneyOf(totals.sgst), igstTotal: moneyOf(totals.igst), cessTotal: moneyOf(totals.cess),
          roundOff: moneyOf(totals.roundOff), grandTotal: moneyOf(totals.grand), journalEntryId: journalId, stockMovementId: movementId, postedBy: actorId,
        })
        .returning(),
      'Sales document',
    );
    const rows = await tx
      .insert(salesInvoiceLines)
      .values(
        lines.map((l, i) => ({
          tenantId, id: uuidv7(), invoiceId: documentId, lineNo: i + 1, itemId: l.itemId, originalLineId: l.originalLineId ?? null, orderLineId: l.orderLineId ?? null, description: l.description, hsnSacCode: l.hsn, quantity: l.quantity, unitPrice: l.unitPrice,
          discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxableValue: moneyOf(l.tax.taxable), taxCodeId: l.taxCodeId, igstRate: l.rates.igst, cgstRate: l.rates.cgst, sgstRate: l.rates.sgst, cessRate: l.rates.cess,
          cgstAmount: moneyOf(l.tax.cgst), sgstAmount: moneyOf(l.tax.sgst), igstAmount: moneyOf(l.tax.igst), cessAmount: moneyOf(l.tax.cess), lineTotal: moneyOf(l.tax.total),
          warehouseId: l.warehouseId ?? null, batchId: l.batchId ?? null, serialNos: l.serialNos ?? null, unitCost: l.unitCost ?? null, costValue: l.costValue ?? null,
        })),
      )
      .returning();
    await this.recorder.record(tx, tenantId, 'sales_invoice', 'posted', invoice, { invoiceNo: invoice.invoiceNo, documentType: invoice.documentType, customerId: invoice.customerId, grandTotal: invoice.grandTotal });
    return { invoice, lines: rows, warnings: await this.creditWarnings(tx, tenantId, invoice, settings) };
  }

  /** Advisory only: a customer over their credit limit is reported, never blocked. */
  private async creditWarnings(tx: Tx, tenantId: string, invoice: InvoiceRow, settings: SalesSettingsRow): Promise<Posted['warnings']> {
    if (invoice.documentType === 'credit_note' || !settings.receivableAccountId) return [];
    const [customer] = await tx.select({ creditLimit: parties.creditLimit }).from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, invoice.customerId)));
    if (!customer?.creditLimit) return [];
    const [row] = await tx
      .select({ net: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)::text` })
      .from(journalLines)
      .where(and(eq(journalLines.tenantId, tenantId), eq(journalLines.companyId, invoice.companyId), eq(journalLines.accountId, settings.receivableAccountId), eq(journalLines.partyId, invoice.customerId)));
    const exposure = row?.net.startsWith('-') ? -moneyToUnits(row.net.slice(1)) : moneyToUnits(row?.net ?? '0');
    return exposure > moneyToUnits(customer.creditLimit) ? [{ code: 'credit_limit_exceeded', message: 'This customer is over their credit limit', creditLimit: customer.creditLimit, exposure: stockValue.format(exposure) }] : [];
  }

  private readonly cancelHooks: ((tx: Tx, tenantId: string, invoice: InvoiceRow, lines: InvoiceLineRow[]) => Promise<void>)[] = [];
  /** Other documents (sales orders, receipts) react to an invoice being cancelled in the same transaction. */
  onCancel(hook: (tx: Tx, tenantId: string, invoice: InvoiceRow, lines: InvoiceLineRow[]) => Promise<void>): void {
    this.cancelHooks.push(hook);
  }

  // ---- cancellation ---------------------------------------------------------------------------------------------------
  /**
   * Cancels an invoice or bill of supply: reverses its journal, brings its stock back at the exact value it left at, and marks the
   * number cancelled (it is never reused). Not possible once credit or debit notes exist against it.
   */
  cancel(tenantId: string, actorId: string, id: string, input: { cancelDate: string; reason: string }): Promise<Posted> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const invoice = first(await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, id))).for('update'), 'Sales document');
      if (invoice.documentType === 'credit_note' || invoice.documentType === 'debit_note') throw new AppError(409, 'note_cannot_be_cancelled', 'Credit and debit notes are not cancelled; issue the opposite note');
      if (invoice.status !== 'posted') throw new AppError(409, 'already_cancelled', 'This invoice is already cancelled');
      if (input.cancelDate < invoice.invoiceDate) throw validationFailed([{ path: 'cancelDate', message: 'Cannot be before the invoice date' }]);
      const [note] = await tx.select({ no: salesInvoices.invoiceNo }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.originalInvoiceId, id), eq(salesInvoices.status, 'posted'))).limit(1);
      if (note) throw new AppError(409, 'has_notes', `Credit/debit note ${note.no} exists against this invoice`);
      await this.assertNoSettlements(tx, tenantId, id);

      let cancelJournalId: string | null = null;
      if (invoice.journalEntryId) {
        const { entry } = await this.posting.reverse(tx, tenantId, invoice.journalEntryId, { postingDate: input.cancelDate, reason: `Cancelled: ${input.reason}`, postedBy: actorId, allowSystem: true });
        cancelJournalId = entry.id;
      }
      let cancelMovementId: string | null = null;
      if (invoice.stockMovementId) {
        const ledger = await tx.select().from(stockLedger).where(and(eq(stockLedger.tenantId, tenantId), eq(stockLedger.movementId, invoice.stockMovementId))).orderBy(asc(stockLedger.lineNo));
        const serials = await tx.select({ ledgerId: stockLedgerSerials.ledgerId, serialNo: stockSerials.serialNo }).from(stockLedgerSerials).innerJoin(stockSerials, and(eq(stockSerials.tenantId, stockLedgerSerials.tenantId), eq(stockSerials.id, stockLedgerSerials.serialId))).where(and(eq(stockLedgerSerials.tenantId, tenantId), inArray(stockLedgerSerials.ledgerId, ledger.map((l) => l.id).concat('00000000-0000-0000-0000-000000000000'))));
        const settings = await this.settings.require(tx, tenantId, invoice.companyId, ['cogsAccountId']);
        const moveLines: MoveLine[] = ledger.map((l) => {
          const sn = serials.filter((s) => s.ledgerId === l.id).map((s) => s.serialNo);
          return { warehouseId: l.warehouseId, itemId: l.itemId, direction: 'in', quantity: l.quantity.replace('-', ''), fixedValue: l.value.replace('-', ''), unitCost: l.unitCost, batchId: l.batchId ?? undefined, serialNos: sn.length > 0 ? sn : undefined, restore: sn.length > 0 };
        });
        const { movement } = await this.stock.move(tx, tenantId, {
          companyId: invoice.companyId, movementType: 'receipt', postingDate: input.cancelDate, description: `Cancellation of ${invoice.invoiceNo}`, offsetAccountId: settings.cogsAccountId as string, allowControlOffset: true,
          lines: moveLines, source: { type: 'sales_invoice', id, event: 'cancel' }, postedBy: actorId,
        });
        cancelMovementId = movement.id;
      }
      // The number stays on record, marked cancelled.
      const [allocation] = await tx.select({ id: numberAllocations.id }).from(numberAllocations).where(and(eq(numberAllocations.tenantId, tenantId), eq(numberAllocations.documentRef, id)));
      if (allocation) await this.numbering.cancel(tx, tenantId, allocation.id, input.reason);
      const updated = first(
        await tx.update(salesInvoices).set({ status: 'cancelled', cancelledAt: new Date(), cancelDate: input.cancelDate, cancelReason: input.reason, cancelJournalEntryId: cancelJournalId, cancelMovementId }).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, id))).returning(),
        'Sales document',
      );
      const lines = await this.linesOf(tx, tenantId, id);
      for (const hook of this.cancelHooks) await hook(tx, tenantId, updated, lines);
      await this.recorder.record(tx, tenantId, 'sales_invoice', 'cancelled', updated, { invoiceNo: updated.invoiceNo, reason: input.reason });
      return { invoice: updated, lines, warnings: [] };
    });
  }

  /** An invoice with money allocated to it cannot be cancelled: release the allocations first. */
  private async assertNoSettlements(tx: Tx, tenantId: string, invoiceId: string): Promise<void> {
    const [a] = await tx.select({ id: receivableAllocations.id }).from(receivableAllocations).where(and(eq(receivableAllocations.tenantId, tenantId), eq(receivableAllocations.invoiceId, invoiceId), sql`${receivableAllocations.reversedAt} IS NULL`)).limit(1);
    if (a) throw new AppError(409, 'has_settlements', 'Money is allocated to this invoice; reverse the allocations first');
  }

  /** Invoice date plus the customer's payment terms (none: due on the invoice date). */
  private async dueDate(tx: Tx, tenantId: string, termsId: string | null, invoiceDate: string): Promise<string> {
    if (!termsId) return invoiceDate;
    const [t] = await tx.select({ days: paymentTerms.netDays }).from(paymentTerms).where(and(eq(paymentTerms.tenantId, tenantId), eq(paymentTerms.id, termsId)));
    return new Date(Date.parse(`${invoiceDate}T00:00:00Z`) + (t?.days ?? 0) * 86_400_000).toISOString().slice(0, 10);
  }

  // ---- reads ------------------------------------------------------------------------------------------------------------
  get(tenantId: string, id: string): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] }> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => ({ invoice: first(await tx.select().from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, id))), 'Sales document'), lines: await this.linesOf(tx, tenantId, id) }),
      { readOnly: true },
    );
  }

  list(tenantId: string, q: ListInvoicesQuery) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const rows = await tx
          .select()
          .from(salesInvoices)
          .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.companyId, q.companyId), before ? lt(salesInvoices.id, before) : undefined, q.customerId ? eq(salesInvoices.customerId, q.customerId) : undefined, q.documentType ? eq(salesInvoices.documentType, q.documentType) : undefined, q.status ? eq(salesInvoices.status, q.status) : undefined, q.from ? gte(salesInvoices.invoiceDate, q.from) : undefined, q.to ? lte(salesInvoices.invoiceDate, q.to) : undefined))
          .orderBy(desc(salesInvoices.id))
          .limit(q.limit + 1);
        const items2 = rows.slice(0, q.limit);
        const last = items2.at(-1);
        return { items: items2, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
      },
      { readOnly: true },
    );
  }

  // ---- internals --------------------------------------------------------------------------------------------------------
  private linesOf(tx: Tx, tenantId: string, id: string): Promise<InvoiceLineRow[]> {
    return tx.select().from(salesInvoiceLines).where(and(eq(salesInvoiceLines.tenantId, tenantId), eq(salesInvoiceLines.invoiceId, id))).orderBy(asc(salesInvoiceLines.lineNo));
  }

  private async number(tx: Tx, tenantId: string, registrationId: string, documentType: string, date: string, documentRef: string): Promise<string> {
    const a = await this.numbering.allocate(tx, tenantId, { gstRegistrationId: registrationId, documentType, financialYear: financialYearOf(new Date(`${date}T00:00:00Z`)), documentRef });
    return a.formatted;
  }

  private async registrationFor(tx: Tx, tenantId: string, companyId: string, id: string, date: string, documentType: string) {
    const [r] = await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.companyId, companyId), eq(gstRegistrations.id, id)));
    if (!r) throw validationFailed([{ path: 'gstRegistrationId', message: 'This GST registration does not belong to the company' }]);
    if (r.status !== 'active' || r.effectiveFrom > date || (r.effectiveTo !== null && r.effectiveTo < date)) throw new AppError(422, 'registration_not_effective', `GSTIN ${r.gstin} is not active on ${date}`);
    if (!['regular', 'composition', 'sez_unit', 'sez_developer'].includes(r.registrationType)) throw new AppError(422, 'registration_type_not_supported', `A ${r.registrationType} registration does not issue sales invoices here`);
    if (r.registrationType === 'composition' && documentType !== 'bill_of_supply') throw new AppError(422, 'composition_cannot_issue_tax_invoice', 'A composition-scheme supplier issues a bill of supply, not a tax invoice');
    return r;
  }

  private async addressState(tx: Tx, tenantId: string, customerId: string, addressId: string | undefined, kind: 'billing' | 'shipping'): Promise<string | undefined> {
    if (addressId) {
      const [a] = await tx.select().from(partyAddresses).where(and(eq(partyAddresses.tenantId, tenantId), eq(partyAddresses.partyId, customerId), eq(partyAddresses.id, addressId)));
      if (!a) throw validationFailed([{ path: kind === 'billing' ? 'billToAddressId' : 'shipToAddressId', message: 'This address does not belong to the customer' }]);
      return a.stateCode;
    }
    const [d] = await tx.select().from(partyAddresses).where(and(eq(partyAddresses.tenantId, tenantId), eq(partyAddresses.partyId, customerId), eq(partyAddresses.kind, kind), eq(partyAddresses.isDefault, true), eq(partyAddresses.status, 'active')));
    return d?.stateCode;
  }

  private async ratesFor(tx: Tx, tenantId: string, itemCode: string, taxCodeId: string | null | undefined, date: string): Promise<{ taxCodeId: string; rates: Rates }> {
    if (!taxCodeId) throw new AppError(422, 'tax_code_required', `${itemCode} has no tax code; set one on the item or the line`);
    const [code] = await tx.select().from(taxCodes).where(and(eq(taxCodes.tenantId, tenantId), eq(taxCodes.id, taxCodeId)));
    if (!code) throw validationFailed([{ path: 'taxCodeId', message: 'This tax code does not exist' }]);
    if (code.kind !== 'gst') return { taxCodeId, rates: ZERO };
    try {
      const r = await this.catalog.taxRateOn(tx, tenantId, taxCodeId, date);
      return { taxCodeId, rates: { igst: r.igstRate, cgst: r.cgstRate, sgst: r.sgstRate, cess: r.cessRate } };
    } catch (error) {
      if (error instanceof AppError && error.status === 404) throw new AppError(422, 'tax_rate_missing', `Tax code ${code.code} has no rate in force on ${date}`);
      throw error;
    }
  }
}


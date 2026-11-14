import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { accounts } from '../accounting/accounting.schema.js';
import { PostingService, type PostingLine } from '../accounting/posting.service.js';
import { cost, divRound, qty, value, valueOf } from '../inventory/decimal.js';
import { StockService, type MoveLine, type RevalueLine } from '../inventory/stock.service.js';
import { CatalogService } from '../masterdata/catalog.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { items, parties, partyAddresses, paymentTerms, taxCodes } from '../masterdata/masterdata.schema.js';
import { gstRegistrations, businessLocations } from '../organization/organization.schema.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { computeInvoice, computeLine, type LineTax, type Rates, type TaxRegime } from '../sales/gst.js';
import { deviation, formatPercent, percentUnits, within, type MatchIssue } from './match.js';
import { goodsReceiptLines, goodsReceipts, purchaseOrderLines, purchaseOrders, purchasingSettings, receiptReturnLines, receiptReturns, supplierBillLines, supplierBills } from './purchasing.schema.js';
import { netUnitCost } from './purchase-orders.service.js';
import type { CreateBillInput, CreateDebitNoteInput, ReturnReceiptInput } from './purchasing.schemas.js';
import { PurchasingSettingsService, type AccountSetting } from './purchasing-settings.service.js';

export type BillRow = typeof supplierBills.$inferSelect;
export type BillLineRow = typeof supplierBillLines.$inferSelect;
export interface PostedBill { bill: BillRow; lines: BillLineRow[] }

const ZERO: Rates = { igst: '0', cgst: '0', sgst: '0', cess: '0' };
const NO_ID = '00000000-0000-0000-0000-000000000000';
/** Paise (1/100) to value units (1/10000). */
const V = (paise: bigint): bigint => paise * 100n;
const taxOf = (t: LineTax): bigint => t.cgst + t.sgst + t.igst + t.cess;

/** Collects journal lines, netting nothing but skipping zeros and flipping negative amounts to the other side. */
class Journal {
  readonly lines: PostingLine[] = [];
  add(accountId: string | null | undefined, units: bigint, side: 'dr' | 'cr', partyId?: string, description?: string): void {
    if (units === 0n || !accountId) return;
    const flip = units < 0n;
    const amount = value.format(flip ? -units : units);
    const debit = (side === 'dr') !== flip;
    this.lines.push({ accountId, ...(debit ? { debit: amount } : { credit: amount }), ...(partyId ? { partyId } : {}), ...(description ? { description } : {}) });
  }
}

/** A bill line after pricing, matching and tax, before it is written. */
interface PricedBillLine {
  itemId: string; description: string; hsn: string | null; quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean; taxCodeId: string | null; rates: Rates; tax: LineTax;
  itcEligible: boolean; stocked: boolean; poLineId: string | null; grnLineId: string | null; expenseAccountId: string | null;
  clearedQuantity: bigint; clearedValue: bigint; priceVariance: bigint; capitalisedTax: bigint; originalLineId?: string; warehouseId?: string;
}

/**
 * Supplier bills and what happens to them: three-way match against the order and receipt, GST input credit (or the tax added to cost
 * where it is not creditable), reverse charge, GRNI cleared with the price difference to purchase price variance, debit notes for
 * returns after billing, returns of goods not yet billed, and cancellation.
 */
@Injectable()
export class SupplierBillsService {
  private readonly cancelHooks: ((tx: Tx, tenantId: string, bill: BillRow) => Promise<void>)[] = [];

  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(PurchasingSettingsService) private readonly settings: PurchasingSettingsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  /** Other documents (payments) may veto a cancellation or react to it, in the same transaction. */
  onCancel(hook: (tx: Tx, tenantId: string, bill: BillRow) => Promise<void>): void {
    this.cancelHooks.push(hook);
  }

  // ---- the bill ---------------------------------------------------------------------------------------------------------
  createBill(tenantId: string, actorId: string, input: CreateBillInput, canApprove: boolean): Promise<PostedBill> {
    return this.uow.inTenant(tenantId, (tx) => this.postBill(tx, tenantId, actorId, input, canApprove));
  }

  async postBill(tx: Tx, tenantId: string, actorId: string, input: CreateBillInput, canApprove: boolean): Promise<PostedBill> {
    const registration = first(await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.companyId, input.companyId), eq(gstRegistrations.id, input.gstRegistrationId))), 'GST registration');
    if (registration.status !== 'active') throw new AppError(422, 'registration_inactive', 'This GST registration is not active');
    if (input.businessLocationId) {
      const [loc] = await tx.select({ id: businessLocations.id }).from(businessLocations).where(and(eq(businessLocations.tenantId, tenantId), eq(businessLocations.companyId, input.companyId), eq(businessLocations.id, input.businessLocationId)));
      if (!loc) throw validationFailed([{ path: 'businessLocationId', message: 'This location does not belong to the company' }]);
    }
    const supplier = first(await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, input.supplierId))), 'Supplier');
    if (!supplier.isSupplier || supplier.status !== 'active') throw validationFailed([{ path: 'supplierId', message: 'This is not an active supplier' }]);
    const [dupe] = await tx.select({ billNo: supplierBills.billNo }).from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.companyId, input.companyId), eq(supplierBills.supplierId, supplier.id), eq(supplierBills.documentType, 'bill'), eq(supplierBills.status, 'posted'), sql`lower(${supplierBills.supplierInvoiceNo}) = lower(${input.supplierInvoiceNo})`));
    if (dupe) throw new AppError(409, 'duplicate_supplier_invoice', `Supplier invoice ${input.supplierInvoiceNo} is already booked as ${dupe.billNo}`, { billNo: dupe.billNo });

    // Where the tax goes: the supplier's state against the place of supply.
    const supplierState = await this.supplierState(tx, tenantId, supplier, input.supplierStateCode);
    const pos = input.placeOfSupplyState ?? registration.stateCode;
    const foreign = supplier.gstTreatment === 'overseas' || supplier.gstTreatment === 'sez';
    const regime: TaxRegime = foreign || supplierState !== pos ? 'inter' : 'intra';
    const chargesTax = ['registered_regular', 'sez', 'overseas', 'deemed_export'].includes(supplier.gstTreatment);
    const taxApplies = input.reverseCharge || chargesTax; // composition / unregistered suppliers charge nothing, unless the buyer pays under reverse charge
    const buyerCanClaim = registration.registrationType !== 'composition';

    const [settingsRow] = await tx.select().from(purchasingSettings).where(and(eq(purchasingSettings.tenantId, tenantId), eq(purchasingSettings.companyId, input.companyId)));
    const priceTol = percentUnits(settingsRow?.priceTolerancePercent ?? '0');
    const qtyTol = percentUnits(settingsRow?.quantityTolerancePercent ?? '0');

    // Lines: pricing, tax and the three-way match.
    const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))])))).map((i) => [i.id, i]));
    const grnLineIds = [...new Set(input.lines.flatMap((l) => (l.grnLineId ? [l.grnLineId] : [])))].sort();
    const grnRows = new Map<string, { line: typeof goodsReceiptLines.$inferSelect; receipt: typeof goodsReceipts.$inferSelect }>();
    for (const id of grnLineIds) {
      const [line] = await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, id))).for('update');
      if (!line) continue;
      const [receipt] = await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, line.receiptId)));
      if (receipt) grnRows.set(id, { line, receipt });
    }
    const poLineIds = [...new Set(input.lines.flatMap((l) => [l.poLineId ?? (l.grnLineId ? grnRows.get(l.grnLineId)?.line.orderLineId : undefined)].filter((x): x is string => !!x)))].sort();
    const poRows = new Map<string, typeof purchaseOrderLines.$inferSelect>();
    for (const id of poLineIds) {
      const [row] = await tx.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, id))).for('update');
      if (row) poRows.set(id, row);
    }

    const issues: MatchIssue[] = [];
    const takenFromGrn = new Map<string, bigint>();
    const lines: PricedBillLine[] = [];
    for (const [i, l] of input.lines.entries()) {
      const at = (f: string) => `lines.${i}.${f}`;
      const item = itemRows.get(l.itemId);
      if (!item || item.status !== 'active' || !item.isPurchasable) throw new AppError(422, 'item_not_purchasable', `${item?.code ?? l.itemId} cannot be purchased`);
      const grn = l.grnLineId ? grnRows.get(l.grnLineId) : undefined;
      if (l.grnLineId && !grn) throw validationFailed([{ path: at('grnLineId'), message: 'This receipt line does not exist' }]);
      if (grn && (grn.receipt.companyId !== input.companyId || grn.receipt.supplierId !== supplier.id || grn.line.itemId !== item.id)) throw validationFailed([{ path: at('grnLineId'), message: 'This receipt line is for another company, supplier or item' }]);
      if (item.isStocked && !grn) throw new AppError(422, 'receipt_required', `${item.code} is a stocked item: receive it first and bill the receipt line (grnLineId)`);
      if (!item.isStocked && grn) throw validationFailed([{ path: at('grnLineId'), message: `${item.code} is not a stocked item and has no receipt` }]);
      if (l.expenseAccountId) {
        if (item.isStocked) throw validationFailed([{ path: at('expenseAccountId'), message: 'Only non-stock lines take an expense account' }]);
        const [acct] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, input.companyId), eq(accounts.id, l.expenseAccountId)));
        if (!acct || acct.isGroup || acct.status !== 'active' || acct.controlKind || (acct.type !== 'expense' && acct.type !== 'asset')) throw validationFailed([{ path: at('expenseAccountId'), message: 'Must be an active, ordinary expense (or asset) account of this company' }]);
      }
      const poLineId = l.poLineId ?? grn?.line.orderLineId ?? null;
      const po = poLineId ? poRows.get(poLineId) : undefined;
      if (poLineId && !po) throw validationFailed([{ path: at('poLineId'), message: 'This order line does not exist' }]);
      if (po && l.poLineId && grn?.line.orderLineId && l.poLineId !== grn.line.orderLineId) throw validationFailed([{ path: at('poLineId'), message: 'The receipt line belongs to a different order line' }]);
      if (po) {
        const [order] = await tx.select({ supplierId: purchaseOrders.supplierId, companyId: purchaseOrders.companyId }).from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, po.orderId)));
        if (!order || order.supplierId !== supplier.id || order.companyId !== input.companyId) throw validationFailed([{ path: at('poLineId'), message: 'This order line is for another supplier or company' }]);
      }

      const { taxCodeId, rates } = !taxApplies ? { taxCodeId: l.taxCodeId ?? item.taxCodeId ?? null, rates: ZERO } : await this.ratesFor(tx, tenantId, item.code, l.taxCodeId ?? item.taxCodeId, input.billDate);
      const applied: Rates = regime === 'intra' ? { ...rates, igst: '0' } : { ...rates, cgst: '0', sgst: '0' };
      const tax = computeLine({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, rates: applied }, regime, taxApplies);
      const q = qty.parse(l.quantity);
      const billNet = q === 0n ? 0n : divRound(tax.taxable * 10n ** 10n, q); // net unit price as a 6-place cost

      const priced: PricedBillLine = {
        itemId: item.id, description: l.description ?? item.name, hsn: item.hsnSacCode, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxCodeId, rates: applied, tax,
        itcEligible: l.itcEligible && buyerCanClaim, stocked: item.isStocked, poLineId, grnLineId: l.grnLineId ?? null, expenseAccountId: l.expenseAccountId ?? null, clearedQuantity: 0n, clearedValue: 0n, priceVariance: 0n, capitalisedTax: 0n,
      };
      if (grn) {
        const open = qty.parse(grn.line.quantity) - qty.parse(grn.line.quantityBilled) - qty.parse(grn.line.quantityReturned) - (takenFromGrn.get(grn.line.id) ?? 0n);
        const clear = q < open ? q : open;
        takenFromGrn.set(grn.line.id, (takenFromGrn.get(grn.line.id) ?? 0n) + clear);
        const grnCost = cost.parse(grn.line.unitCost);
        const priceDev = deviation(billNet, grnCost);
        if (!within(priceDev, priceTol)) issues.push({ lineNo: i + 1, kind: 'price', expected: cost.format(grnCost), actual: cost.format(billNet), deviationPercent: priceDev === null ? null : formatPercent(priceDev), tolerancePercent: formatPercent(priceTol) });
        if (q > open) {
          const qd = deviation(q, open); // billed against what is still open on the receipt
          if (!within(qd, qtyTol)) issues.push({ lineNo: i + 1, kind: 'quantity', expected: qty.format(open), actual: qty.format(q), deviationPercent: qd === null ? null : formatPercent(qd), tolerancePercent: formatPercent(qtyTol) });
        }
        const remainingValue = value.parse(grn.line.value) - value.parse(grn.line.valueBilled) - value.parse(grn.line.valueReturned);
        priced.clearedQuantity = clear;
        priced.clearedValue = clear === 0n ? 0n : clear === open ? remainingValue : valueOf(clear, grnCost);
        // A line takes what is open first; a second bill line against the same receipt line only takes the rest.
        if ((takenFromGrn.get(grn.line.id) ?? 0n) > qty.parse(grn.line.quantity)) throw new AppError(409, 'receipt_overbilled', `Receipt line ${grn.line.lineNo} is already billed`);
        priced.warehouseId = grn.line.warehouseId;
      } else if (po) {
        const poNet = cost.parse(netUnitCost(po.unitPrice, po.discountPercent));
        const priceDev = deviation(billNet, poNet);
        if (!within(priceDev, priceTol)) issues.push({ lineNo: i + 1, kind: 'price', expected: cost.format(poNet), actual: cost.format(billNet), deviationPercent: priceDev === null ? null : formatPercent(priceDev), tolerancePercent: formatPercent(priceTol) });
        const open = qty.parse(po.quantity) - qty.parse(po.quantityBilled);
        if (q > open) {
          const qd = deviation(q, open > 0n ? open : 0n);
          if (!within(qd, qtyTol)) issues.push({ lineNo: i + 1, kind: 'quantity', expected: qty.format(open > 0n ? open : 0n), actual: qty.format(q), deviationPercent: qd === null ? null : formatPercent(qd), tolerancePercent: formatPercent(qtyTol) });
        }
      }
      lines.push(priced);
    }

    let matchStatus: 'matched' | 'overridden' | 'not_applicable' = lines.some((l) => l.grnLineId || l.poLineId) ? 'matched' : 'not_applicable';
    if (issues.length > 0) {
      if (!input.overrideMatch) throw new AppError(409, 'match_failed', 'The bill is outside the company price/quantity tolerance. A user with approval rights can post it with an override reason.', { issues });
      if (!canApprove) throw new AppError(403, 'approval_required', 'Posting a bill outside the match tolerance needs the purchasing:approve right', { issues });
      matchStatus = 'overridden';
    } else if (input.overrideMatch) throw validationFailed([{ path: 'overrideMatch', message: 'The bill matches; there is nothing to override' }]);

    const totals = computeInvoice(lines.map((l) => l.tax), input.reverseCharge);
    for (const l of lines) {
      const t = taxOf(l.tax);
      if (!l.itcEligible) l.capitalisedTax = V(t);
      if (l.stocked) l.priceVariance = V(l.tax.taxable) - l.clearedValue;
    }

    // Accounts this particular bill needs.
    const needs = new Set<AccountSetting>(['payableAccountId']);
    if (lines.some((l) => l.stocked)) needs.add('grniAccountId');
    if (lines.some((l) => l.stocked && l.priceVariance !== 0n)) needs.add('purchasePriceVarianceAccountId');
    if (lines.some((l) => !l.stocked && !l.expenseAccountId)) needs.add('expensePurchaseAccountId');
    if (lines.some((l) => l.stocked && l.capitalisedTax !== 0n)) needs.add('costVarianceAccountId');
    if (totals.roundOff !== 0n) needs.add('roundOffAccountId');
    const eligible = lines.filter((l) => l.itcEligible).reduce((a, l) => ({ cgst: a.cgst + l.tax.cgst, sgst: a.sgst + l.tax.sgst, igst: a.igst + l.tax.igst, cess: a.cess + l.tax.cess }), { cgst: 0n, sgst: 0n, igst: 0n, cess: 0n });
    if (eligible.cgst > 0n) needs.add('inputCgstAccountId');
    if (eligible.sgst > 0n) needs.add('inputSgstAccountId');
    if (eligible.igst > 0n) needs.add('inputIgstAccountId');
    if (eligible.cess > 0n) needs.add('inputCessAccountId');
    if (input.reverseCharge) {
      if (totals.cgst > 0n) needs.add('rcmCgstAccountId');
      if (totals.sgst > 0n) needs.add('rcmSgstAccountId');
      if (totals.igst > 0n) needs.add('rcmIgstAccountId');
      if (totals.cess > 0n) needs.add('rcmCessAccountId');
    }
    const accountsRow = await this.settings.require(tx, tenantId, input.companyId, [...needs]);
    for (const l of lines) if (!l.stocked) l.expenseAccountId = l.expenseAccountId ?? accountsRow.expensePurchaseAccountId;

    const billId = uuidv7();
    const billNo = await nextDocNumber(tx, tenantId, input.companyId, input.billDate, 'BILL');

    // Non-creditable tax on stock is added to the cost of that stock.
    let revaluationMovementId: string | null = null;
    const revalueLines: RevalueLine[] = lines.flatMap((l) => {
      if (!l.stocked || l.capitalisedTax === 0n) return [];
      const g = grnRows.get(l.grnLineId as string)?.line as typeof goodsReceiptLines.$inferSelect;
      return [{ warehouseId: g.warehouseId, itemId: l.itemId, amount: value.format(l.capitalisedTax), receivedQuantity: l.quantity, ledgerId: g.stockLedgerId ?? undefined }];
    });
    if (revalueLines.length > 0) {
      const { movement } = await this.stock.revalue(tx, tenantId, {
        companyId: input.companyId, postingDate: input.billDate, description: `Non-creditable tax on bill ${billNo}`, lines: revalueLines, offsetAccountId: accountsRow.grniAccountId as string,
        expenseAccountId: accountsRow.costVarianceAccountId as string, source: { type: 'supplier_bill', id: billId, event: 'capitalise' }, postedBy: actorId,
      });
      revaluationMovementId = movement?.id ?? null;
    }

    // The journal.
    const j = new Journal();
    for (const l of lines) {
      if (l.stocked) {
        j.add(accountsRow.grniAccountId, l.clearedValue + l.capitalisedTax, 'dr', undefined, billNo);
        j.add(accountsRow.purchasePriceVarianceAccountId, l.priceVariance, 'dr', undefined, billNo);
      } else j.add(l.expenseAccountId, V(l.tax.taxable) + l.capitalisedTax, 'dr', undefined, billNo);
    }
    j.add(accountsRow.inputCgstAccountId, V(eligible.cgst), 'dr', undefined, billNo);
    j.add(accountsRow.inputSgstAccountId, V(eligible.sgst), 'dr', undefined, billNo);
    j.add(accountsRow.inputIgstAccountId, V(eligible.igst), 'dr', undefined, billNo);
    j.add(accountsRow.inputCessAccountId, V(eligible.cess), 'dr', undefined, billNo);
    if (input.reverseCharge) {
      j.add(accountsRow.rcmCgstAccountId, V(totals.cgst), 'cr', undefined, billNo);
      j.add(accountsRow.rcmSgstAccountId, V(totals.sgst), 'cr', undefined, billNo);
      j.add(accountsRow.rcmIgstAccountId, V(totals.igst), 'cr', undefined, billNo);
      j.add(accountsRow.rcmCessAccountId, V(totals.cess), 'cr', undefined, billNo);
    }
    j.add(accountsRow.roundOffAccountId, V(totals.roundOff), 'dr', undefined, billNo); // a positive round-off is extra payable (a cost)
    j.add(accountsRow.payableAccountId, V(totals.grand), 'cr', supplier.id, billNo);
    const { entry } = await this.posting.post(tx, tenantId, {
      companyId: input.companyId, postingDate: input.billDate, journalType: 'system', description: `Supplier bill ${billNo} (${supplier.tradeName ?? supplier.legalName} ${input.supplierInvoiceNo})`, lines: j.lines,
      source: { type: 'supplier_bill', id: billId, event: 'bill' }, postedBy: actorId,
    });

    const header = first(
      await tx
        .insert(supplierBills)
        .values({
          tenantId, id: billId, companyId: input.companyId, documentType: 'bill', billNo, supplierInvoiceNo: input.supplierInvoiceNo, supplierInvoiceDate: input.supplierInvoiceDate, billDate: input.billDate,
          dueDate: await this.dueDate(tx, tenantId, supplier.paymentTermsId, input.billDate), gstRegistrationId: registration.id, businessLocationId: input.businessLocationId ?? null, supplierId: supplier.id,
          supplierName: supplier.tradeName ?? supplier.legalName, supplierGstin: supplier.gstin, supplierGstTreatment: supplier.gstTreatment, supplierState, placeOfSupply: pos, taxRegime: regime, reverseCharge: input.reverseCharge,
          taxableTotal: value.format(V(totals.taxable)), cgstTotal: value.format(V(totals.cgst)), sgstTotal: value.format(V(totals.sgst)), igstTotal: value.format(V(totals.igst)), cessTotal: value.format(V(totals.cess)),
          itcTotal: value.format(V(eligible.cgst + eligible.sgst + eligible.igst + eligible.cess)), roundOff: value.format(V(totals.roundOff)), grandTotal: value.format(V(totals.grand)),
          matchStatus, matchIssues: issues.length > 0 ? issues : null, matchOverrideBy: matchStatus === 'overridden' ? actorId : null, matchOverrideReason: input.overrideMatch?.reason ?? null, matchOverrideAt: matchStatus === 'overridden' ? new Date() : null,
          journalEntryId: entry.id, revaluationMovementId, postedBy: actorId,
        })
        .returning(),
      'Supplier bill',
    );
    const rows = await tx.insert(supplierBillLines).values(lines.map((l, i) => this.lineRow(tenantId, billId, i + 1, l))).returning();

    // Give the quantities to the receipts and orders.
    for (const l of lines) {
      if (l.grnLineId && l.clearedQuantity > 0n) {
        const g = (grnRows.get(l.grnLineId) as { line: typeof goodsReceiptLines.$inferSelect }).line;
        const cur = (await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, g.id))))[0] as typeof g;
        await tx.update(goodsReceiptLines).set({ quantityBilled: qty.format(qty.parse(cur.quantityBilled) + l.clearedQuantity), valueBilled: value.format(value.parse(cur.valueBilled) + l.clearedValue) }).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, g.id)));
      }
    }
    const byPo = new Map<string, bigint>();
    for (const l of lines) if (l.poLineId) byPo.set(l.poLineId, (byPo.get(l.poLineId) ?? 0n) + qty.parse(l.quantity));
    for (const [id, add] of byPo) {
      const [cur] = await tx.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, id)));
      if (cur) await tx.update(purchaseOrderLines).set({ quantityBilled: qty.format(qty.parse(cur.quantityBilled) + add) }).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, id)));
    }

    await this.recorder.record(tx, tenantId, 'supplier_bill', 'posted', header, { billNo, supplierId: supplier.id, supplierInvoiceNo: input.supplierInvoiceNo, grandTotal: header.grandTotal, matchStatus });
    if (matchStatus === 'overridden') await this.recorder.record(tx, tenantId, 'supplier_bill', 'match_overridden', header, { billNo, reason: input.overrideMatch?.reason, issues, approvedBy: actorId });
    return { bill: header, lines: rows };
  }

  private lineRow(tenantId: string, billId: string, lineNo: number, l: PricedBillLine): typeof supplierBillLines.$inferInsert {
    const m = (p: bigint) => value.format(V(p));
    return {
      tenantId, id: uuidv7(), billId, lineNo, itemId: l.itemId, description: l.description, hsnSacCode: l.hsn, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxCodeId: l.taxCodeId,
      igstRate: l.rates.igst, cgstRate: l.rates.cgst, sgstRate: l.rates.sgst, cessRate: l.rates.cess, taxableValue: m(l.tax.taxable), cgstAmount: m(l.tax.cgst), sgstAmount: m(l.tax.sgst), igstAmount: m(l.tax.igst), cessAmount: m(l.tax.cess), lineTotal: m(l.tax.total),
      itcEligible: l.itcEligible, poLineId: l.poLineId, grnLineId: l.grnLineId, expenseAccountId: l.expenseAccountId, clearedQuantity: qty.format(l.clearedQuantity), clearedValue: value.format(l.clearedValue), priceVariance: value.format(l.priceVariance),
      capitalisedTax: value.format(l.capitalisedTax), originalLineId: l.originalLineId ?? null,
    };
  }

  // ---- debit notes: goods returned after the bill ---------------------------------------------------------------------
  createDebitNote(tenantId: string, actorId: string, input: CreateDebitNoteInput): Promise<PostedBill> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const original = first(await tx.select().from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.id, input.originalBillId))).for('update'), 'Supplier bill');
      if (original.documentType !== 'bill') throw new AppError(422, 'original_is_a_note', 'A debit note must refer to a bill');
      if (original.status !== 'posted') throw new AppError(409, 'bill_cancelled', 'This bill was cancelled');
      if (input.noteDate < original.billDate) throw validationFailed([{ path: 'noteDate', message: 'A debit note cannot be dated before its bill' }]);
      const originalLines = new Map((await tx.select().from(supplierBillLines).where(and(eq(supplierBillLines.tenantId, tenantId), eq(supplierBillLines.billId, original.id)))).map((l) => [l.id, l]));
      const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set([...originalLines.values()].map((l) => l.itemId))])))).map((i) => [i.id, i]));
      const returned = new Map<string, bigint>();
      const prior = await tx.execute<{ original_line_id: string; q: string }>(sql`
        SELECT l.original_line_id, SUM(l.quantity)::text AS q FROM erp.supplier_bill_lines l JOIN erp.supplier_bills b ON b.tenant_id = l.tenant_id AND b.id = l.bill_id
         WHERE l.tenant_id = ${tenantId}::uuid AND b.original_bill_id = ${original.id}::uuid AND b.status = 'posted' GROUP BY l.original_line_id`);
      for (const r of prior.rows) returned.set(r.original_line_id, qty.parse(r.q));

      const regime = original.taxRegime as TaxRegime;
      const taxApplies = original.reverseCharge || ['registered_regular', 'sez', 'overseas', 'deemed_export'].includes(original.supplierGstTreatment);
      const lines: PricedBillLine[] = [];
      const taken = new Map<string, bigint>();
      for (const [i, l] of input.lines.entries()) {
        const o = originalLines.get(l.originalLineId);
        if (!o) throw validationFailed([{ path: `lines.${i}.originalLineId`, message: 'This line is not on the bill' }]);
        const q = qty.parse(l.quantity);
        const used = (returned.get(o.id) ?? 0n) + (taken.get(o.id) ?? 0n);
        if (used + q > qty.parse(o.quantity)) throw new AppError(409, 'return_exceeds_bill', `Line ${o.lineNo} was billed for ${o.quantity} and ${qty.format(used)} is already returned`, { lineNo: o.lineNo });
        taken.set(o.id, (taken.get(o.id) ?? 0n) + q);
        const unitPrice = l.unitPrice ?? o.unitPrice;
        if (Number(unitPrice) > Number(o.unitPrice)) throw validationFailed([{ path: `lines.${i}.unitPrice`, message: 'A debit note cannot credit more than the billed price' }]);
        const rates: Rates = { igst: o.igstRate, cgst: o.cgstRate, sgst: o.sgstRate, cess: o.cessRate }; // reversed at the ORIGINAL rates
        const tax = computeLine({ quantity: l.quantity, unitPrice, discountPercent: o.discountPercent, taxInclusive: o.taxInclusive, rates }, regime, taxApplies);
        const item = itemRows.get(o.itemId) as typeof items.$inferSelect;
        const grn = o.grnLineId ? (await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, o.grnLineId))))[0] : undefined;
        const priced: PricedBillLine = {
          itemId: o.itemId, description: o.description, hsn: o.hsnSacCode, quantity: l.quantity, unitPrice, discountPercent: o.discountPercent, taxInclusive: o.taxInclusive, taxCodeId: o.taxCodeId, rates, tax, itcEligible: o.itcEligible,
          stocked: item.isStocked, poLineId: o.poLineId, grnLineId: o.grnLineId, expenseAccountId: o.expenseAccountId, clearedQuantity: 0n, clearedValue: 0n, priceVariance: 0n, capitalisedTax: o.itcEligible ? 0n : V(taxOf(tax)), originalLineId: o.id,
        };
        if (grn) priced.warehouseId = grn.warehouseId;
        lines.push(priced);
      }
      const totals = computeInvoice(lines.map((l) => l.tax), original.reverseCharge);
      const needs = new Set<AccountSetting>(['payableAccountId']);
      if (lines.some((l) => l.stocked)) needs.add('purchasePriceVarianceAccountId');
      if (lines.some((l) => !l.stocked && !l.expenseAccountId)) needs.add('expensePurchaseAccountId');
      if (totals.roundOff !== 0n) needs.add('roundOffAccountId');
      const eligible = lines.filter((l) => l.itcEligible).reduce((a, l) => ({ cgst: a.cgst + l.tax.cgst, sgst: a.sgst + l.tax.sgst, igst: a.igst + l.tax.igst, cess: a.cess + l.tax.cess }), { cgst: 0n, sgst: 0n, igst: 0n, cess: 0n });
      if (eligible.cgst > 0n) needs.add('inputCgstAccountId');
      if (eligible.sgst > 0n) needs.add('inputSgstAccountId');
      if (eligible.igst > 0n) needs.add('inputIgstAccountId');
      if (eligible.cess > 0n) needs.add('inputCessAccountId');
      if (original.reverseCharge) {
        if (totals.cgst > 0n) needs.add('rcmCgstAccountId');
        if (totals.sgst > 0n) needs.add('rcmSgstAccountId');
        if (totals.igst > 0n) needs.add('rcmIgstAccountId');
        if (totals.cess > 0n) needs.add('rcmCessAccountId');
      }
      const acc = await this.settings.require(tx, tenantId, original.companyId, [...needs]);
      const noteId = uuidv7();
      const noteNo = await nextDocNumber(tx, tenantId, original.companyId, input.noteDate, 'PDN');

      // Stock goes back to the supplier at its current cost; the difference to the credit is purchase price variance.
      const stockLines = lines.filter((l) => l.stocked);
      const issueValue = new Map<PricedBillLine, bigint>();
      let movementId: string | null = null;
      if (stockLines.length > 0) {
        const moveLines: MoveLine[] = stockLines.map((l) => {
          const src = input.lines[lines.indexOf(l)];
          return { warehouseId: l.warehouseId as string, itemId: l.itemId, direction: 'out' as const, quantity: l.quantity, batchId: src?.batchId, serialNos: src?.serialNos };
        });
        const { movement, results } = await this.stock.move(tx, tenantId, {
          companyId: original.companyId, movementType: 'issue', postingDate: input.noteDate, description: `Return against ${original.billNo}`, lines: moveLines, offsetAccountId: acc.purchasePriceVarianceAccountId as string,
          allowControlOffset: false, source: { type: 'supplier_bill', id: noteId, event: 'return' }, postedBy: actorId,
        });
        movementId = movement.id;
        stockLines.forEach((l, idx) => issueValue.set(l, value.parseSigned(results[idx]?.ledger.value ?? '0') * -1n));
      }
      const j = new Journal();
      for (const l of lines) {
        const credit = V(l.tax.taxable) + l.capitalisedTax;
        if (l.stocked) j.add(acc.purchasePriceVarianceAccountId, credit, 'cr', undefined, noteNo);
        else j.add(l.expenseAccountId ?? acc.expensePurchaseAccountId, credit, 'cr', undefined, noteNo);
        l.priceVariance = l.stocked ? (issueValue.get(l) ?? 0n) - credit : 0n; // what the PPV account nets to for this line (debit positive)
      }
      j.add(acc.inputCgstAccountId, V(eligible.cgst), 'cr', undefined, noteNo);
      j.add(acc.inputSgstAccountId, V(eligible.sgst), 'cr', undefined, noteNo);
      j.add(acc.inputIgstAccountId, V(eligible.igst), 'cr', undefined, noteNo);
      j.add(acc.inputCessAccountId, V(eligible.cess), 'cr', undefined, noteNo);
      if (original.reverseCharge) {
        j.add(acc.rcmCgstAccountId, V(totals.cgst), 'dr', undefined, noteNo);
        j.add(acc.rcmSgstAccountId, V(totals.sgst), 'dr', undefined, noteNo);
        j.add(acc.rcmIgstAccountId, V(totals.igst), 'dr', undefined, noteNo);
        j.add(acc.rcmCessAccountId, V(totals.cess), 'dr', undefined, noteNo);
      }
      j.add(acc.roundOffAccountId, V(totals.roundOff), 'cr', undefined, noteNo);
      j.add(acc.payableAccountId, V(totals.grand), 'dr', original.supplierId, noteNo);
      const { entry } = await this.posting.post(tx, tenantId, {
        companyId: original.companyId, postingDate: input.noteDate, journalType: 'system', description: `Debit note ${noteNo} against ${original.billNo}: ${input.reason}`, lines: j.lines,
        source: { type: 'supplier_bill', id: noteId, event: 'debit_note' }, postedBy: actorId,
      });
      const header = first(
        await tx
          .insert(supplierBills)
          .values({
            tenantId, id: noteId, companyId: original.companyId, documentType: 'debit_note', billNo: noteNo, supplierInvoiceNo: original.supplierInvoiceNo, supplierInvoiceDate: original.supplierInvoiceDate, billDate: input.noteDate, dueDate: input.noteDate,
            gstRegistrationId: original.gstRegistrationId, businessLocationId: original.businessLocationId, supplierId: original.supplierId, supplierName: original.supplierName, supplierGstin: original.supplierGstin, supplierGstTreatment: original.supplierGstTreatment,
            supplierState: original.supplierState, placeOfSupply: original.placeOfSupply, taxRegime: original.taxRegime, reverseCharge: original.reverseCharge, taxableTotal: value.format(V(totals.taxable)), cgstTotal: value.format(V(totals.cgst)),
            sgstTotal: value.format(V(totals.sgst)), igstTotal: value.format(V(totals.igst)), cessTotal: value.format(V(totals.cess)), itcTotal: value.format(V(eligible.cgst + eligible.sgst + eligible.igst + eligible.cess)), roundOff: value.format(V(totals.roundOff)),
            grandTotal: value.format(V(totals.grand)), originalBillId: original.id, reason: input.reason, matchStatus: 'not_applicable', journalEntryId: entry.id, stockMovementId: movementId, postedBy: actorId,
          })
          .returning(),
        'Debit note',
      );
      const rows = await tx.insert(supplierBillLines).values(lines.map((l, i) => this.lineRow(tenantId, noteId, i + 1, l))).returning();
      // The order lines can be billed again for what went back.
      for (const l of lines) {
        if (!l.poLineId) continue;
        const [cur] = await tx.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, l.poLineId)));
        if (cur) await tx.update(purchaseOrderLines).set({ quantityBilled: qty.format(qty.parse(cur.quantityBilled) - qty.parse(l.quantity)) }).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, l.poLineId)));
      }
      await this.recorder.record(tx, tenantId, 'supplier_bill', 'debit_note_posted', header, { billNo: noteNo, originalBillNo: original.billNo, grandTotal: header.grandTotal });
      return { bill: header, lines: rows };
    });
  }

  // ---- goods returned before they were billed ----------------------------------------------------------------------
  /** Sends received goods back: stock out, GRNI cleared at the value it was accrued at, any difference to purchase price variance. */
  returnReceipt(tenantId: string, actorId: string, receiptId: string, input: ReturnReceiptInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const receipt = first(await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, receiptId))), 'Goods receipt');
      if (input.returnDate < receipt.receiptDate) throw validationFailed([{ path: 'returnDate', message: 'Cannot be before the receipt date' }]);
      const acc = await this.settings.require(tx, tenantId, receipt.companyId, ['grniAccountId', 'purchasePriceVarianceAccountId']);
      const ids = [...new Set(input.lines.map((l) => l.receiptLineId))].sort();
      const lineRows = new Map<string, typeof goodsReceiptLines.$inferSelect>();
      for (const id of ids) {
        const [row] = await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, id), eq(goodsReceiptLines.receiptId, receiptId))).for('update');
        if (!row) throw validationFailed([{ path: 'lines', message: 'A receipt line is not on this receipt' }]);
        lineRows.set(id, row);
      }
      const taken = new Map<string, bigint>();
      const prepared = input.lines.map((l, i) => {
        const g = lineRows.get(l.receiptLineId) as typeof goodsReceiptLines.$inferSelect;
        const q = qty.parse(l.quantity);
        const open = qty.parse(g.quantity) - qty.parse(g.quantityBilled) - qty.parse(g.quantityReturned) - (taken.get(g.id) ?? 0n);
        if (q > open) throw new AppError(409, 'return_exceeds_open', `Only ${qty.format(open)} of receipt line ${g.lineNo} is unbilled and can be returned (billed goods go back on a debit note)`, { lineNo: g.lineNo, open: qty.format(open) });
        taken.set(g.id, (taken.get(g.id) ?? 0n) + q);
        const remainingValue = value.parse(g.value) - value.parse(g.valueBilled) - value.parse(g.valueReturned);
        const receiptValue = q === open ? remainingValue : valueOf(q, cost.parse(g.unitCost));
        return { l, g, q, receiptValue, i };
      });
      const returnId = uuidv7();
      const returnNo = await nextDocNumber(tx, tenantId, receipt.companyId, input.returnDate, 'PRET');
      const { movement, results } = await this.stock.move(tx, tenantId, {
        companyId: receipt.companyId, movementType: 'issue', postingDate: input.returnDate, description: `Return to supplier ${returnNo} of ${receipt.grnNo}`,
        lines: prepared.map((p) => ({ warehouseId: p.g.warehouseId, itemId: p.g.itemId, direction: 'out' as const, quantity: p.l.quantity, batchId: p.l.batchId, serialNos: p.l.serialNos })),
        offsetAccountId: acc.grniAccountId as string, allowControlOffset: true, source: { type: 'goods_receipt', id: returnId, event: 'return' }, postedBy: actorId,
      });
      // GRNI must come down by the value it was accrued at, not by what the stock happened to leave at.
      const issued = prepared.map((p, idx) => value.parseSigned(results[idx]?.ledger.value ?? '0') * -1n);
      const diff = prepared.reduce((a, p, idx) => a + p.receiptValue - (issued[idx] ?? 0n), 0n);
      let journalId: string | null = null;
      if (diff !== 0n) {
        const j = new Journal();
        j.add(acc.grniAccountId, diff, 'dr', undefined, returnNo);
        j.add(acc.purchasePriceVarianceAccountId, diff, 'cr', undefined, returnNo);
        const { entry } = await this.posting.post(tx, tenantId, { companyId: receipt.companyId, postingDate: input.returnDate, journalType: 'system', description: `Return ${returnNo}: receipt value vs stock cost`, lines: j.lines, source: { type: 'goods_receipt', id: returnId, event: 'return_variance' }, postedBy: actorId });
        journalId = entry.id;
      }
      const header = first(await tx.insert(receiptReturns).values({ tenantId, id: returnId, companyId: receipt.companyId, returnNo, receiptId, returnDate: input.returnDate, reason: input.reason, stockMovementId: movement.id, journalEntryId: journalId, createdBy: actorId }).returning(), 'Receipt return');
      const lines = await tx.insert(receiptReturnLines).values(prepared.map((p, idx) => ({ tenantId, id: uuidv7(), returnId, lineNo: idx + 1, receiptLineId: p.g.id, quantity: p.l.quantity, receiptValue: value.format(p.receiptValue), issueValue: value.format(issued[idx] ?? 0n) }))).returning();
      for (const [id, q] of taken) {
        const g = lineRows.get(id) as typeof goodsReceiptLines.$inferSelect;
        const rv = prepared.filter((p) => p.g.id === id).reduce((a, p) => a + p.receiptValue, 0n);
        await tx.update(goodsReceiptLines).set({ quantityReturned: qty.format(qty.parse(g.quantityReturned) + q), valueReturned: value.format(value.parse(g.valueReturned) + rv) }).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, id)));
      }
      await this.recorder.record(tx, tenantId, 'receipt_return', 'posted', header, { returnNo, receiptId, grnNo: receipt.grnNo });
      return { return: header, lines };
    });
  }

  // ---- cancellation -------------------------------------------------------------------------------------------------------
  cancel(tenantId: string, actorId: string, id: string, input: { cancelDate: string; reason: string }): Promise<PostedBill> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const bill = first(await tx.select().from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.id, id))).for('update'), 'Supplier bill');
      if (bill.documentType !== 'bill') throw new AppError(409, 'note_cannot_be_cancelled', 'Debit notes are not cancelled; book the bill again if the return was a mistake');
      if (bill.status !== 'posted') throw new AppError(409, 'already_cancelled', 'This bill is already cancelled');
      if (input.cancelDate < bill.billDate) throw validationFailed([{ path: 'cancelDate', message: 'Cannot be before the bill date' }]);
      const [note] = await tx.select({ no: supplierBills.billNo }).from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.originalBillId, id), eq(supplierBills.status, 'posted'))).limit(1);
      if (note) throw new AppError(409, 'has_notes', `Debit note ${note.no} exists against this bill`);
      for (const hook of this.cancelHooks) await hook(tx, tenantId, bill);
      const lines = await tx.select().from(supplierBillLines).where(and(eq(supplierBillLines.tenantId, tenantId), eq(supplierBillLines.billId, id))).orderBy(asc(supplierBillLines.lineNo));
      const { entry } = await this.posting.reverse(tx, tenantId, bill.journalEntryId as string, { postingDate: input.cancelDate, reason: `Cancelled: ${input.reason}`, postedBy: actorId, allowSystem: true });
      // Take back any tax that was added to stock cost.
      const grnLines = new Map((await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), inArray(goodsReceiptLines.id, lines.flatMap((l) => (l.grnLineId ? [l.grnLineId] : [])).concat(NO_ID))))).map((g) => [g.id, g]));
      const back: RevalueLine[] = lines.filter((l) => l.grnLineId && value.parse(l.capitalisedTax) > 0n).map((l) => {
        const g = grnLines.get(l.grnLineId as string) as typeof goodsReceiptLines.$inferSelect;
        return { warehouseId: g.warehouseId, itemId: l.itemId, amount: `-${l.capitalisedTax}`, receivedQuantity: l.quantity, ledgerId: g.stockLedgerId ?? undefined };
      });
      if (back.length > 0) {
        const acc = await this.settings.require(tx, tenantId, bill.companyId, ['grniAccountId', 'costVarianceAccountId']);
        await this.stock.revalue(tx, tenantId, { companyId: bill.companyId, postingDate: input.cancelDate, description: `Cancellation of ${bill.billNo}`, lines: back, offsetAccountId: acc.grniAccountId as string, expenseAccountId: acc.costVarianceAccountId as string, source: { type: 'supplier_bill', id, event: 'capitalise_cancel' }, postedBy: actorId });
      }
      for (const l of lines) {
        if (l.grnLineId && qty.parse(l.clearedQuantity) > 0n) {
          const g = grnLines.get(l.grnLineId) as typeof goodsReceiptLines.$inferSelect;
          await tx.update(goodsReceiptLines).set({ quantityBilled: qty.format(qty.parse(g.quantityBilled) - qty.parse(l.clearedQuantity)), valueBilled: value.format(value.parse(g.valueBilled) - value.parse(l.clearedValue)) }).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.id, g.id)));
          g.quantityBilled = qty.format(qty.parse(g.quantityBilled) - qty.parse(l.clearedQuantity));
          g.valueBilled = value.format(value.parse(g.valueBilled) - value.parse(l.clearedValue));
        }
        if (l.poLineId) {
          const [po] = await tx.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, l.poLineId)));
          if (po) await tx.update(purchaseOrderLines).set({ quantityBilled: qty.format(qty.parse(po.quantityBilled) - qty.parse(l.quantity)) }).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, l.poLineId)));
        }
      }
      const updated = first(await tx.update(supplierBills).set({ status: 'cancelled', cancelledAt: new Date(), cancelDate: input.cancelDate, cancelReason: input.reason, cancelJournalEntryId: entry.id }).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.id, id))).returning(), 'Supplier bill');
      await this.recorder.record(tx, tenantId, 'supplier_bill', 'cancelled', updated, { billNo: updated.billNo, reason: input.reason });
      return { bill: updated, lines };
    });
  }

  // ---- reads --------------------------------------------------------------------------------------------------------------
  get(tenantId: string, id: string): Promise<PostedBill> {
    return this.uow.inTenant(tenantId, async (tx) => ({ bill: first(await tx.select().from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.id, id))), 'Supplier bill'), lines: await tx.select().from(supplierBillLines).where(and(eq(supplierBillLines.tenantId, tenantId), eq(supplierBillLines.billId, id))).orderBy(asc(supplierBillLines.lineNo)) }), { readOnly: true });
  }
  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; supplierId?: string | undefined; documentType?: string | undefined; status?: string | undefined; from?: string | undefined; to?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(supplierBills).where(and(eq(supplierBills.tenantId, tenantId), eq(supplierBills.companyId, q.companyId), before ? lt(supplierBills.id, before) : undefined, q.supplierId ? eq(supplierBills.supplierId, q.supplierId) : undefined, q.documentType ? eq(supplierBills.documentType, q.documentType) : undefined, q.status ? eq(supplierBills.status, q.status) : undefined, q.from ? gte(supplierBills.billDate, q.from) : undefined, q.to ? lte(supplierBills.billDate, q.to) : undefined)).orderBy(desc(supplierBills.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }
  getReturn(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => ({ return: first(await tx.select().from(receiptReturns).where(and(eq(receiptReturns.tenantId, tenantId), eq(receiptReturns.id, id))), 'Receipt return'), lines: await tx.select().from(receiptReturnLines).where(and(eq(receiptReturnLines.tenantId, tenantId), eq(receiptReturnLines.returnId, id))).orderBy(asc(receiptReturnLines.lineNo)) }), { readOnly: true });
  }

  // ---- helpers -------------------------------------------------------------------------------------------------------------
  private async supplierState(tx: Tx, tenantId: string, supplier: typeof parties.$inferSelect, override: string | undefined): Promise<string> {
    if (supplier.gstTreatment === 'overseas') return '96';
    if (supplier.gstin) return supplier.gstin.slice(0, 2);
    if (override) return override;
    const [a] = await tx.select().from(partyAddresses).where(and(eq(partyAddresses.tenantId, tenantId), eq(partyAddresses.partyId, supplier.id), eq(partyAddresses.kind, 'billing'), eq(partyAddresses.isDefault, true), eq(partyAddresses.status, 'active')));
    if (a) return a.stateCode;
    throw new AppError(422, 'supplier_state_unknown', 'The supplier has no GSTIN or billing address: give supplierStateCode so the tax can be split correctly');
  }

  private async dueDate(tx: Tx, tenantId: string, termsId: string | null, date: string): Promise<string> {
    if (!termsId) return date;
    const [t] = await tx.select({ days: paymentTerms.netDays }).from(paymentTerms).where(and(eq(paymentTerms.tenantId, tenantId), eq(paymentTerms.id, termsId)));
    return new Date(Date.parse(`${date}T00:00:00Z`) + (t?.days ?? 0) * 86_400_000).toISOString().slice(0, 10);
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

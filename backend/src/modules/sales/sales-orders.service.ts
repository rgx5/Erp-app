import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { qty } from '../inventory/decimal.js';
import { stockReservations } from '../inventory/inventory.schema.js';
import { ReservationsService } from '../inventory/reservations.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { nextDocNumber } from './doc-number.js';
import { paiseToMoney } from './gst.js';
import { salesInvoices, salesOrderLines, salesOrders, salesQuoteLines, salesQuotes } from './sales.schema.js';
import type { CreateInvoiceInput, CreateOrderInput, CreateQuoteInput } from './sales.schemas.js';
import { SalesInvoiceService, type Posted } from './sales-invoice.service.js';

export type QuoteRow = typeof salesQuotes.$inferSelect;
export type OrderRow = typeof salesOrders.$inferSelect;
export type OrderLineRow = typeof salesOrderLines.$inferSelect;

const moneyOf = (paise: bigint): string => paiseToMoney(paise);

/** Quotes and sales orders. Orders can hold stock and are invoiced (fully or in parts) through the normal invoice posting. */
@Injectable()
export class SalesOrdersService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {
    // An invoice that came from an order gives its quantities back to the order when it is cancelled.
    this.invoices.onCancel(async (tx, tenantId, invoice, lines) => {
      if (!invoice.orderId) return;
      for (const l of lines) {
        if (!l.orderLineId) continue;
        const [ol] = await tx.select().from(salesOrderLines).where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.id, l.orderLineId)));
        if (ol) await tx.update(salesOrderLines).set({ quantityInvoiced: qty.format(qty.parse(ol.quantityInvoiced) - qty.parse(l.quantity)) }).where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.id, ol.id)));
      }
      await this.refreshStatus(tx, tenantId, invoice.orderId);
    });
  }

  // ---- quotes ---------------------------------------------------------------------------------------------------------
  createQuote(tenantId: string, actorId: string, input: CreateQuoteInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const priced = await this.invoices.priceDocument(tx, tenantId, this.asInvoice(input, input.quoteDate), { requireWarehouse: false });
      const quoteNo = await nextDocNumber(tx, tenantId, input.companyId, input.quoteDate, 'QT');
      const tax = priced.totals.cgst + priced.totals.sgst + priced.totals.igst + priced.totals.cess;
      const quote = first(
        await tx
          .insert(salesQuotes)
          .values({
            tenantId, id: uuidv7(), companyId: input.companyId, quoteNo, gstRegistrationId: input.gstRegistrationId, businessLocationId: input.businessLocationId ?? null, customerId: input.customerId, quoteDate: input.quoteDate,
            validUntil: input.validUntil, billToAddressId: input.billToAddressId ?? null, shipToAddressId: input.shipToAddressId ?? null, placeOfSupplyState: input.placeOfSupplyState ?? null, reverseCharge: input.reverseCharge,
            taxPayment: input.taxPayment ?? null, notes: input.notes ?? null, estimatedTaxable: moneyOf(priced.totals.taxable), estimatedTax: moneyOf(input.reverseCharge ? 0n : tax), estimatedTotal: moneyOf(priced.totals.grand), createdBy: actorId,
          })
          .returning(),
        'Quote',
      );
      const lines = await tx
        .insert(salesQuoteLines)
        .values(input.lines.map((l, i) => ({ tenantId, id: uuidv7(), quoteId: quote.id, lineNo: i + 1, itemId: l.itemId, description: priced.lines[i]?.description ?? '', quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxCodeId: l.taxCodeId ?? null, warehouseId: l.warehouseId ?? null, estimatedTaxable: moneyOf(priced.lines[i]?.tax.taxable ?? 0n), estimatedTotal: moneyOf(priced.lines[i]?.tax.total ?? 0n) })))
        .returning();
      await this.recorder.record(tx, tenantId, 'sales_quote', 'created', quote, { quoteNo, customerId: input.customerId, estimatedTotal: quote.estimatedTotal });
      return { quote, lines };
    });
  }

  rejectQuote(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const quote = first(await tx.select().from(salesQuotes).where(and(eq(salesQuotes.tenantId, tenantId), eq(salesQuotes.id, id))).for('update'), 'Quote');
      if (quote.status !== 'open') throw new AppError(409, 'quote_not_open', `This quote is ${quote.status}`);
      const updated = first(await tx.update(salesQuotes).set({ status: 'rejected' }).where(and(eq(salesQuotes.tenantId, tenantId), eq(salesQuotes.id, id))).returning(), 'Quote');
      await this.recorder.record(tx, tenantId, 'sales_quote', 'rejected', updated, { quoteNo: updated.quoteNo });
      return this.readQuote(tx, tenantId, id);
    });
  }

  /** Turns an open, unexpired quote into a sales order with the same lines and addresses. */
  convertQuote(tenantId: string, actorId: string, id: string, input: { orderDate: string; customerReference?: string | undefined; reserveStock: boolean }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const quote = first(await tx.select().from(salesQuotes).where(and(eq(salesQuotes.tenantId, tenantId), eq(salesQuotes.id, id))).for('update'), 'Quote');
      if (quote.status !== 'open') throw new AppError(409, 'quote_not_open', `This quote is ${quote.status}`);
      if (input.orderDate > quote.validUntil) throw new AppError(409, 'quote_expired', `This quote was valid until ${quote.validUntil}`);
      const lines = await tx.select().from(salesQuoteLines).where(and(eq(salesQuoteLines.tenantId, tenantId), eq(salesQuoteLines.quoteId, id))).orderBy(asc(salesQuoteLines.lineNo));
      const order = await this.placeOrder(tx, tenantId, actorId, {
        companyId: quote.companyId, gstRegistrationId: quote.gstRegistrationId, businessLocationId: quote.businessLocationId ?? undefined, customerId: quote.customerId, billToAddressId: quote.billToAddressId ?? undefined,
        shipToAddressId: quote.shipToAddressId ?? undefined, placeOfSupplyState: quote.placeOfSupplyState ?? undefined, reverseCharge: quote.reverseCharge, taxPayment: (quote.taxPayment ?? undefined) as 'with_payment' | 'without_payment' | undefined,
        documentType: 'tax_invoice', orderDate: input.orderDate, customerReference: input.customerReference, reserveStock: input.reserveStock,
        lines: lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxCodeId: l.taxCodeId ?? undefined, warehouseId: l.warehouseId ?? undefined })),
      }, quote.id);
      await tx.update(salesQuotes).set({ status: 'converted', orderId: order.order.id }).where(and(eq(salesQuotes.tenantId, tenantId), eq(salesQuotes.id, id)));
      await this.recorder.record(tx, tenantId, 'sales_quote', 'converted', quote, { quoteNo: quote.quoteNo, orderNo: order.order.orderNo });
      return order;
    });
  }

  // ---- orders ---------------------------------------------------------------------------------------------------------
  createOrder(tenantId: string, actorId: string, input: CreateOrderInput) {
    return this.uow.inTenant(tenantId, (tx) => this.placeOrder(tx, tenantId, actorId, input, null));
  }

  private async placeOrder(tx: Tx, tenantId: string, actorId: string, input: CreateOrderInput, quoteId: string | null) {
    // Validates registration, customer, items, tax codes and the place of supply now, so an order is never un-invoiceable on day one.
    await this.invoices.priceDocument(tx, tenantId, this.asInvoice(input, input.orderDate), { requireWarehouse: input.reserveStock });
    const orderNo = await nextDocNumber(tx, tenantId, input.companyId, input.orderDate, 'ORD');
    const order = first(
      await tx
        .insert(salesOrders)
        .values({
          tenantId, id: uuidv7(), companyId: input.companyId, orderNo, gstRegistrationId: input.gstRegistrationId, businessLocationId: input.businessLocationId ?? null, customerId: input.customerId, orderDate: input.orderDate,
          customerReference: input.customerReference ?? null, billToAddressId: input.billToAddressId ?? null, shipToAddressId: input.shipToAddressId ?? null, placeOfSupplyState: input.placeOfSupplyState ?? null,
          reverseCharge: input.reverseCharge, taxPayment: input.taxPayment ?? null, documentType: input.documentType, reserveStock: input.reserveStock, quoteId, createdBy: actorId,
        })
        .returning(),
      'Sales order',
    );
    const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))])))).map((i) => [i.id, i]));
    const lines: OrderLineRow[] = [];
    for (const [i, l] of input.lines.entries()) {
      const item = itemRows.get(l.itemId);
      let reservationId: string | null = null;
      if (input.reserveStock && item?.isStocked) {
        if (!l.warehouseId) throw validationFailed([{ path: `lines.${i}.warehouseId`, message: `${item.code} is stocked: say which warehouse to reserve from` }]);
        if (item.tracking === 'serial') throw new AppError(422, 'serial_reservation', `${item.code} is serial tracked and cannot be reserved; its serial numbers are chosen at invoicing`);
        reservationId = (await this.reservations.create(tenantId, actorId, { companyId: input.companyId, warehouseId: l.warehouseId, itemId: l.itemId, batchId: l.batchId, quantity: l.quantity, referenceType: 'sales_order', referenceId: `${order.id}:${i + 1}` })).id;
      }
      lines.push(first(await tx.insert(salesOrderLines).values({ tenantId, id: uuidv7(), orderId: order.id, lineNo: i + 1, itemId: l.itemId, description: l.description ?? item?.name ?? '', quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, taxCodeId: l.taxCodeId ?? null, warehouseId: l.warehouseId ?? null, batchId: l.batchId ?? null, reservationId }).returning(), 'Order line'));
    }
    await this.recorder.record(tx, tenantId, 'sales_order', 'created', order, { orderNo, customerId: input.customerId, reserved: input.reserveStock });
    return { order, lines };
  }

  /** Invoices the outstanding quantities (or the lines given) through the normal invoice posting, consuming the reservations. */
  invoiceOrder(tenantId: string, actorId: string, id: string, input: { invoiceDate: string; lines?: { orderLineId: string; quantity: string; serialNos?: string[] | undefined }[] | undefined }): Promise<Posted> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const order = first(await tx.select().from(salesOrders).where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, id))).for('update'), 'Sales order');
      if (order.status !== 'open' && order.status !== 'partially_invoiced') throw new AppError(409, 'order_not_invoiceable', `This order is ${order.status}`);
      const orderLines = await tx.select().from(salesOrderLines).where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.orderId, id))).orderBy(asc(salesOrderLines.lineNo));
      const wanted = input.lines ?? orderLines.filter((l) => qty.parse(l.quantity) > qty.parse(l.quantityInvoiced)).map((l) => ({ orderLineId: l.id, quantity: qty.format(qty.parse(l.quantity) - qty.parse(l.quantityInvoiced)), serialNos: undefined as string[] | undefined }));
      if (wanted.length === 0) throw new AppError(409, 'nothing_to_invoice', 'Everything on this order has been invoiced');
      const picked: { line: OrderLineRow; quantity: string; serialNos?: string[] | undefined }[] = [];
      wanted.forEach((w, i) => {
        const line = orderLines.find((l) => l.id === w.orderLineId);
        if (!line) throw validationFailed([{ path: `lines.${i}.orderLineId`, message: 'This line is not on the order' }]);
        const remaining = qty.parse(line.quantity) - qty.parse(line.quantityInvoiced);
        if (qty.parse(w.quantity) > remaining) throw new AppError(409, 'invoice_exceeds_order', `Only ${qty.format(remaining)} of line ${line.lineNo} remains to be invoiced`, { remaining: qty.format(remaining) });
        picked.push({ line, quantity: w.quantity, serialNos: w.serialNos });
      });
      const invoiceInput: CreateInvoiceInput = {
        companyId: order.companyId, gstRegistrationId: order.gstRegistrationId, businessLocationId: order.businessLocationId ?? undefined, documentType: order.documentType as 'tax_invoice' | 'bill_of_supply', invoiceDate: input.invoiceDate,
        customerId: order.customerId, billToAddressId: order.billToAddressId ?? undefined, shipToAddressId: order.shipToAddressId ?? undefined, placeOfSupplyState: order.placeOfSupplyState ?? undefined, reverseCharge: order.reverseCharge,
        taxPayment: (order.taxPayment ?? undefined) as 'with_payment' | 'without_payment' | undefined,
        lines: picked.map((p) => ({ itemId: p.line.itemId, description: p.line.description, quantity: p.quantity, unitPrice: p.line.unitPrice, discountPercent: p.line.discountPercent, taxInclusive: p.line.taxInclusive, taxCodeId: p.line.taxCodeId ?? undefined, warehouseId: p.line.warehouseId ?? undefined, batchId: p.line.batchId ?? undefined, serialNos: p.serialNos })),
      };
      // Only pass a reservation on while it is still active (it may have been released by hand).
      const reservationFor = async (l: OrderLineRow): Promise<string | undefined> => {
        if (!l.reservationId) return undefined;
        const [r] = await tx.select({ status: stockReservations.status }).from(stockReservations).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.id, l.reservationId)));
        return r?.status === 'active' ? l.reservationId : undefined;
      };
      const extras = { orderId: id, lines: await Promise.all(picked.map(async (p) => ({ orderLineId: p.line.id, reservationId: await reservationFor(p.line) }))) };
      const posted = await this.invoices.postInvoice(tx, tenantId, actorId, invoiceInput, extras);
      for (const p of picked) await tx.update(salesOrderLines).set({ quantityInvoiced: qty.format(qty.parse(p.line.quantityInvoiced) + qty.parse(p.quantity)) }).where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.id, p.line.id)));
      await this.refreshStatus(tx, tenantId, id);
      return posted;
    });
  }

  /** Cancels an order nothing was invoiced against and releases what it held. */
  cancelOrder(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const order = await this.lockLive(tx, tenantId, id);
      const [invoiced] = await tx.select({ n: salesInvoices.invoiceNo }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.orderId, id), eq(salesInvoices.status, 'posted'))).limit(1);
      if (invoiced || order.status !== 'open') throw new AppError(409, 'has_invoices', 'Part of this order was invoiced; close it instead');
      return this.finishOrder(tx, tenantId, order, 'cancelled', 'cancelled');
    });
  }

  /** Stops an order from being invoiced further and releases the stock it still held. */
  closeOrder(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => this.finishOrder(tx, tenantId, await this.lockLive(tx, tenantId, id), 'closed', 'closed'));
  }

  private async lockLive(tx: Tx, tenantId: string, id: string): Promise<OrderRow> {
    const order = first(await tx.select().from(salesOrders).where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, id))).for('update'), 'Sales order');
    if (order.status === 'closed' || order.status === 'cancelled') throw new AppError(409, 'order_finished', `This order is already ${order.status}`);
    return order;
  }

  private async finishOrder(tx: Tx, tenantId: string, order: OrderRow, status: 'closed' | 'cancelled', verb: string) {
    const lines = await tx.select().from(salesOrderLines).where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.orderId, order.id)));
    for (const l of lines) {
      if (!l.reservationId) continue;
      const [r] = await tx.select({ status: stockReservations.status }).from(stockReservations).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.id, l.reservationId)));
      if (r?.status === 'active') await this.reservations.release(tenantId, l.reservationId);
    }
    const updated = first(await tx.update(salesOrders).set({ status, closedAt: new Date() }).where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, order.id))).returning(), 'Sales order');
    await this.recorder.record(tx, tenantId, 'sales_order', verb, updated, { orderNo: updated.orderNo });
    return this.readOrder(tx, tenantId, order.id);
  }

  private async refreshStatus(tx: Tx, tenantId: string, orderId: string): Promise<void> {
    const [order] = await tx.select().from(salesOrders).where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, orderId)));
    if (!order || order.status === 'closed' || order.status === 'cancelled') return;
    const lines = await tx.select().from(salesOrderLines).where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.orderId, orderId)));
    const all = lines.every((l) => qty.parse(l.quantityInvoiced) === qty.parse(l.quantity));
    const none = lines.every((l) => qty.parse(l.quantityInvoiced) === 0n);
    const status = all ? 'invoiced' : none ? 'open' : 'partially_invoiced';
    if (status !== order.status) await tx.update(salesOrders).set({ status }).where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, orderId)));
  }

  // ---- reads ------------------------------------------------------------------------------------------------------------
  getQuote(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.readQuote(tx, tenantId, id), { readOnly: true }); }
  getOrder(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.readOrder(tx, tenantId, id), { readOnly: true }); }
  private async readQuote(tx: Tx, tenantId: string, id: string) {
    return { quote: first(await tx.select().from(salesQuotes).where(and(eq(salesQuotes.tenantId, tenantId), eq(salesQuotes.id, id))), 'Quote'), lines: await tx.select().from(salesQuoteLines).where(and(eq(salesQuoteLines.tenantId, tenantId), eq(salesQuoteLines.quoteId, id))).orderBy(asc(salesQuoteLines.lineNo)) };
  }
  private async readOrder(tx: Tx, tenantId: string, id: string) {
    const order = first(await tx.select().from(salesOrders).where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, id))), 'Sales order');
    const lines = await tx.select().from(salesOrderLines).where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.orderId, id))).orderBy(asc(salesOrderLines.lineNo));
    const invoices = await tx.select({ id: salesInvoices.id, invoiceNo: salesInvoices.invoiceNo, status: salesInvoices.status, grandTotal: salesInvoices.grandTotal }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.orderId, id))).orderBy(asc(salesInvoices.id));
    return { order, lines, invoices };
  }

  listQuotes(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; customerId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(salesQuotes).where(and(eq(salesQuotes.tenantId, tenantId), eq(salesQuotes.companyId, q.companyId), before ? lt(salesQuotes.id, before) : undefined, q.customerId ? eq(salesQuotes.customerId, q.customerId) : undefined, q.status ? eq(salesQuotes.status, q.status) : undefined)).orderBy(desc(salesQuotes.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }
  listOrders(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; customerId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(salesOrders).where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.companyId, q.companyId), before ? lt(salesOrders.id, before) : undefined, q.customerId ? eq(salesOrders.customerId, q.customerId) : undefined, q.status ? eq(salesOrders.status, q.status) : undefined)).orderBy(desc(salesOrders.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  /** The invoice-shaped view of a quote/order, so the same validation and pricing apply. */
  private asInvoice(input: { companyId: string; gstRegistrationId: string; businessLocationId?: string | undefined; documentType: 'tax_invoice' | 'bill_of_supply'; customerId: string; billToAddressId?: string | undefined; shipToAddressId?: string | undefined; placeOfSupplyState?: string | undefined; reverseCharge: boolean; taxPayment?: 'with_payment' | 'without_payment' | undefined; lines: { itemId: string; description?: string | undefined; quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean; taxCodeId?: string | undefined; warehouseId?: string | undefined; batchId?: string | undefined }[] }, date: string): CreateInvoiceInput {
    return { ...input, invoiceDate: date, lines: input.lines.map((l) => ({ ...l })) };
  }
}

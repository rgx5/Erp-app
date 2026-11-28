import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { Recorder } from '../masterdata/helpers.js';
import { buildEInvoice, buildEway, checkEInvoice, checkEway, computeIrn, type InvoiceIn, type Issue, type LineIn, type PartyIn, type Transport } from './einvoice.build.js';

type Tx = Parameters<Parameters<UnitOfWork['inTenant']>[1]>[0];

type InvRow = { id: string; company_id: string; document_type: InvoiceIn['documentType']; invoice_no: string; invoice_date: string; status: string; supply_type: string; tax_payment: string | null; reverse_charge: boolean; place_of_supply: string; customer_id: string; customer_name: string; customer_gstin: string | null; taxable_total: string; cgst_total: string; sgst_total: string; igst_total: string; cess_total: string; round_off: string; grand_total: string; tcs_amount: string; original_invoice_id: string | null; gst_registration_id: string; business_location_id: string | null };
interface Loaded { companyId: string; invoice: InvoiceIn; seller: PartyIn; buyer: PartyIn; shipTo: PartyIn | undefined; sellerGstin: string }

export interface EInvoiceRecord { id: string; invoiceId: string; irn: string; ackNo: string; ackDate: string; signedQr: string; status: 'active' | 'cancelled'; cancelledAt: string | null; cancelReason: string | null }
export interface EwayRecord { id: string; invoiceId: string; billNo: string; billDate: string; validUntil: string | null; transportMode: string; distanceKm: number | null; vehicleNo: string | null; transporterId: string | null; transporterName: string | null; transDocNo: string | null; status: 'active' | 'cancelled'; cancelledAt: string | null }

/** The portal writes its acknowledgement time as "2026-04-15 10:31:22" in Indian time. */
export function parsePortalTime(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+05:30`);
  m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*[AP]M)?$/i.exec(t);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+05:30`);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const iso = (v: unknown): string => new Date(v as string).toISOString();
const rec = (r: { id: string; invoice_id: string; irn: string; ack_no: string; ack_date: string; signed_qr: string; status: 'active' | 'cancelled'; cancelled_at: string | null; cancel_reason: string | null }): EInvoiceRecord => ({ id: r.id, invoiceId: r.invoice_id, irn: r.irn, ackNo: r.ack_no, ackDate: iso(r.ack_date), signedQr: r.signed_qr, status: r.status, cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null, cancelReason: r.cancel_reason });
const ewr = (r: { id: string; invoice_id: string; bill_no: string; bill_date: string; valid_until: string | null; transport_mode: string; distance_km: number | null; vehicle_no: string | null; transporter_id: string | null; transporter_name: string | null; trans_doc_no: string | null; status: 'active' | 'cancelled'; cancelled_at: string | null }): EwayRecord => ({ id: r.id, invoiceId: r.invoice_id, billNo: r.bill_no, billDate: iso(r.bill_date), validUntil: r.valid_until ? iso(r.valid_until) : null, transportMode: r.transport_mode, distanceKm: r.distance_km, vehicleNo: r.vehicle_no, transporterId: r.transporter_id, transporterName: r.transporter_name, transDocNo: r.trans_doc_no, status: r.status, cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null });

export interface ReplyItem { irn?: string | undefined; ackNo?: string | number | undefined; ackDate?: string | undefined; signedQr?: string | undefined; signedInvoice?: string | undefined; docNo?: string | undefined }
export interface ReplyOutcome { docNo: string | null; irn: string | null; result: 'recorded' | 'already_recorded' | 'unmatched' | 'invalid'; message: string }

@Injectable()
export class EInvoiceService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  // ---- loading ------------------------------------------------------------------------------------------------------------
  private async load(tx: Tx, tenantId: string, invoiceId: string): Promise<Loaded> {
    const inv = (await tx.execute<InvRow>(sql`SELECT id, company_id, document_type, invoice_no, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date, status, supply_type, tax_payment, reverse_charge, place_of_supply, customer_id, customer_name, customer_gstin, taxable_total, cgst_total, sgst_total, igst_total, cess_total, round_off, grand_total, tcs_amount, original_invoice_id, gst_registration_id, business_location_id FROM erp.sales_invoices WHERE tenant_id = ${tenantId}::uuid AND id = ${invoiceId}::uuid`)).rows[0];
    if (!inv) throw new AppError(404, 'not_found', 'Sales document not found');
    const reg = (await tx.execute<{ gstin: string; state_code: string; legal_name: string; trade_name: string | null }>(sql`SELECT gstin, state_code, legal_name, trade_name FROM erp.gst_registrations WHERE tenant_id = ${tenantId}::uuid AND id = ${inv.gst_registration_id}::uuid`)).rows[0];
    const loc = (await tx.execute<{ address_line1: string; address_line2: string | null; city: string; state_code: string; pincode: string }>(sql`SELECT address_line1, address_line2, city, state_code, pincode FROM erp.business_locations WHERE tenant_id = ${tenantId}::uuid AND company_id = ${inv.company_id}::uuid AND status = 'active' AND (id = ${inv.business_location_id}::uuid OR ${inv.business_location_id}::uuid IS NULL) ORDER BY (id = ${inv.business_location_id}::uuid) DESC NULLS LAST, (gst_registration_id = ${inv.gst_registration_id}::uuid) DESC NULLS LAST, is_principal_place DESC, created_at LIMIT 1`)).rows[0];
    const party = (await tx.execute<{ legal_name: string; trade_name: string | null; gstin: string | null }>(sql`SELECT legal_name, trade_name, gstin FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${inv.customer_id}::uuid`)).rows[0];
    const addrs = (await tx.execute<{ kind: string; line1: string; line2: string | null; city: string; state_code: string; pincode: string | null }>(sql`SELECT kind, line1, line2, city, state_code, pincode FROM erp.party_addresses WHERE tenant_id = ${tenantId}::uuid AND party_id = ${inv.customer_id}::uuid AND status = 'active' ORDER BY is_default DESC, created_at`)).rows;
    const billing = addrs.find((a) => a.kind === 'billing' || a.kind === 'registered') ?? addrs[0];
    const shipping = addrs.find((a) => a.kind === 'shipping');
    const lines = (await tx.execute<{ line_no: number; description: string; hsn_sac_code: string | null; item_type: string; quantity: string; unit_price: string; discount_percent: string; tax_inclusive: boolean; taxable_value: string; igst_rate: string; cgst_rate: string; sgst_rate: string; cess_rate: string; igst_amount: string; cgst_amount: string; sgst_amount: string; cess_amount: string; line_total: string; uqc: string | null; unit_code: string | null }>(sql`
      SELECT l.line_no, l.description, l.hsn_sac_code, i.item_type, l.quantity, l.unit_price, l.discount_percent, l.tax_inclusive, l.taxable_value, l.igst_rate, l.cgst_rate, l.sgst_rate, l.cess_rate, l.igst_amount, l.cgst_amount, l.sgst_amount, l.cess_amount, l.line_total, u.uqc, u.code AS unit_code
      FROM erp.sales_invoice_lines l JOIN erp.items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id LEFT JOIN erp.units u ON u.tenant_id = i.tenant_id AND u.id = i.base_uom_id
      WHERE l.tenant_id = ${tenantId}::uuid AND l.invoice_id = ${invoiceId}::uuid ORDER BY l.line_no`)).rows;
    const original = inv.original_invoice_id ? (await tx.execute<{ invoice_no: string; invoice_date: string }>(sql`SELECT invoice_no, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date FROM erp.sales_invoices WHERE tenant_id = ${tenantId}::uuid AND id = ${inv.original_invoice_id}::uuid`)).rows[0] : undefined;
    const co = (await tx.execute<{ legal_name: string; trade_name: string | null }>(sql`SELECT legal_name, trade_name FROM erp.companies WHERE tenant_id = ${tenantId}::uuid AND id = ${inv.company_id}::uuid`)).rows[0];
    const toParty = (a: { line1: string; line2: string | null; city: string; state_code: string; pincode: string | null } | undefined): Pick<PartyIn, 'address1' | 'address2' | 'city' | 'pincode' | 'stateCode'> => ({ address1: a?.line1 ?? null, address2: a?.line2 ?? null, city: a?.city ?? null, pincode: a?.pincode ?? null, stateCode: a?.state_code ?? null });
    const seller: PartyIn = { gstin: reg?.gstin ?? null, legalName: reg?.legal_name && reg.legal_name.trim().length >= 3 ? reg.legal_name : co?.legal_name ?? reg?.legal_name ?? '', tradeName: reg?.trade_name ?? co?.trade_name ?? null, address1: loc?.address_line1 ?? null, address2: loc?.address_line2 ?? null, city: loc?.city ?? null, pincode: loc?.pincode ?? null, stateCode: reg?.state_code ?? loc?.state_code ?? null };
    const buyer: PartyIn = { gstin: inv.customer_gstin ?? party?.gstin ?? null, legalName: party?.legal_name ?? inv.customer_name, tradeName: party?.trade_name ?? null, ...toParty(billing) };
    const invoice: InvoiceIn = {
      invoiceNo: inv.invoice_no, documentType: inv.document_type, invoiceDate: inv.invoice_date, status: inv.status, supplyType: inv.supply_type, taxPayment: inv.tax_payment, reverseCharge: inv.reverse_charge, placeOfSupply: inv.place_of_supply,
      taxableTotal: inv.taxable_total, cgstTotal: inv.cgst_total, sgstTotal: inv.sgst_total, igstTotal: inv.igst_total, cessTotal: inv.cess_total, roundOff: inv.round_off, grandTotal: inv.grand_total, tcsAmount: inv.tcs_amount,
      original: original ? { invoiceNo: original.invoice_no, invoiceDate: original.invoice_date } : null,
      lines: lines.map((l): LineIn => ({ lineNo: l.line_no, description: l.description, hsn: l.hsn_sac_code, isService: l.item_type === 'service', quantity: l.quantity, unitPrice: l.unit_price, discountPercent: l.discount_percent, taxInclusive: l.tax_inclusive, taxableValue: l.taxable_value, igstRate: l.igst_rate, cgstRate: l.cgst_rate, sgstRate: l.sgst_rate, cessRate: l.cess_rate, igstAmount: l.igst_amount, cgstAmount: l.cgst_amount, sgstAmount: l.sgst_amount, cessAmount: l.cess_amount, lineTotal: l.line_total, uqc: l.uqc, unitCode: l.unit_code ?? '' })),
    };
    return { companyId: inv.company_id, invoice, seller, buyer, shipTo: shipping ? { ...buyer, ...toParty(shipping) } : undefined, sellerGstin: seller.gstin ?? '' };
  }

  private async activeRecord(tx: Tx, tenantId: string, invoiceId: string): Promise<EInvoiceRecord | null> {
    const r = (await tx.execute<Parameters<typeof rec>[0]>(sql`SELECT id, invoice_id, irn, ack_no, ack_date, signed_qr, status, cancelled_at, cancel_reason FROM erp.einvoice_records WHERE tenant_id = ${tenantId}::uuid AND invoice_id = ${invoiceId}::uuid ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`)).rows[0];
    return r ? rec(r) : null;
  }

  // ---- reads --------------------------------------------------------------------------------------------------------------
  /** Everything the invoice screen needs: the e-invoice state with what is wrong, and the e-way bills. */
  status(tenantId: string, invoiceId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const d = await this.load(tx, tenantId, invoiceId);
      const record = await this.activeRecord(tx, tenantId, invoiceId);
      const issues = checkEInvoice(d.invoice, d.seller, d.buyer, record?.status === 'active');
      const applicable = !issues.some((i) => i.field === 'document' || i.field === 'buyer');
      const eway = (await tx.execute<Parameters<typeof ewr>[0]>(sql`SELECT id, invoice_id, bill_no, bill_date, valid_until, transport_mode, distance_km, vehicle_no, transporter_id, transporter_name, trans_doc_no, status, cancelled_at FROM erp.eway_bills WHERE tenant_id = ${tenantId}::uuid AND invoice_id = ${invoiceId}::uuid ORDER BY created_at DESC`)).rows.map(ewr);
      return { applicable, irn: d.sellerGstin ? computeIrn(d.sellerGstin, d.invoice.invoiceDate, d.invoice.documentType, d.invoice.invoiceNo) : null, record, issues: record?.status === 'active' ? [] : issues, canFile: applicable && !issues.some((i) => i.blocking), eway };
    }, { readOnly: true });
  }

  /** Posted sales to businesses, SEZ units and exports in a date range, with whether each has its IRN yet. */
  pending(tenantId: string, q: { from?: string | undefined; to?: string | undefined; state: 'pending' | 'issued' | 'all' }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = (await tx.execute<{ id: string; invoice_no: string; document_type: string; invoice_date: string; customer_name: string; supply_type: string; grand_total: string; irn: string | null; ack_no: string | null }>(sql`
        SELECT s.id, s.invoice_no, s.document_type, to_char(s.invoice_date,'YYYY-MM-DD') AS invoice_date, s.customer_name, s.supply_type, s.grand_total, e.irn, e.ack_no
        FROM erp.sales_invoices s LEFT JOIN erp.einvoice_records e ON e.tenant_id = s.tenant_id AND e.invoice_id = s.id AND e.status = 'active'
        WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'posted' AND s.document_type IN ('tax_invoice','credit_note','debit_note') AND s.supply_type IN ('b2b','sez','export')
          AND (${q.from ?? null}::date IS NULL OR s.invoice_date >= ${q.from ?? null}::date) AND (${q.to ?? null}::date IS NULL OR s.invoice_date <= ${q.to ?? null}::date)
          AND (${q.state} = 'all' OR (${q.state} = 'pending' AND e.id IS NULL) OR (${q.state} = 'issued' AND e.id IS NOT NULL))
        ORDER BY s.invoice_date DESC, s.invoice_no DESC LIMIT 500`)).rows;
      return { items: rows.map((r) => ({ id: r.id, invoiceNo: r.invoice_no, documentType: r.document_type, invoiceDate: r.invoice_date, customerName: r.customer_name, supplyType: r.supply_type, grandTotal: r.grand_total, irn: r.irn, ackNo: r.ack_no })) };
    }, { readOnly: true });
  }

  // ---- e-invoice file -----------------------------------------------------------------------------------------------------
  /** One JSON file with every chosen invoice in the portal's layout. Invoices that fail the checks are left out and listed. */
  file(tenantId: string, invoiceIds: string[]) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const invoices: Record<string, unknown>[] = []; const included: { id: string; invoiceNo: string; irn: string }[] = []; const skipped: { id: string; invoiceNo: string; issues: Issue[] }[] = [];
      for (const id of invoiceIds) {
        const d = await this.load(tx, tenantId, id);
        const issues = checkEInvoice(d.invoice, d.seller, d.buyer, (await this.activeRecord(tx, tenantId, id))?.status === 'active');
        if (issues.some((i) => i.blocking)) { skipped.push({ id, invoiceNo: d.invoice.invoiceNo, issues }); continue; }
        invoices.push(buildEInvoice(d.invoice, d.seller, d.buyer)); included.push({ id, invoiceNo: d.invoice.invoiceNo, irn: computeIrn(d.sellerGstin, d.invoice.invoiceDate, d.invoice.documentType, d.invoice.invoiceNo) });
      }
      if (invoices.length === 0) throw new AppError(422, 'einvoice_not_ready', 'None of the chosen invoices can go to the e-invoice portal yet', { skipped });
      await this.recorder.record(tx, tenantId, 'einvoice', 'file_prepared', { id: included[0]?.id ?? '' }, { count: included.length, invoiceNos: included.map((i) => i.invoiceNo) });
      return { fileName: `einvoice-${new Date().toISOString().slice(0, 10)}-${included.length}.json`, invoices, included, skipped };
    });
  }

  /** The portal's reply (its own JSON) loaded back: each answer is matched to an invoice by the reference number worked out from the invoice itself. */
  recordReply(tenantId: string, actorId: string, items: ReplyItem[]) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const outcomes: ReplyOutcome[] = [];
      for (const it of items) {
        const irn = (it.irn ?? '').trim().toLowerCase(); const docNo = it.docNo?.trim() ?? null;
        if (!/^[0-9a-f]{64}$/.test(irn)) { outcomes.push({ docNo, irn: irn || null, result: 'invalid', message: 'No valid 64-character IRN in this entry' }); continue; }
        const ack = it.ackNo === undefined ? '' : String(it.ackNo).trim(); const when = it.ackDate ? parsePortalTime(it.ackDate) : null; const qr = (it.signedQr ?? '').trim();
        if (!ack || !when || !qr) { outcomes.push({ docNo, irn, result: 'invalid', message: 'The acknowledgement number, date or signed QR code is missing' }); continue; }
        const candidates = (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.sales_invoices WHERE tenant_id = ${tenantId}::uuid AND document_type IN ('tax_invoice','credit_note','debit_note') AND (${docNo}::text IS NULL OR invoice_no = ${docNo}::text) ORDER BY invoice_date DESC LIMIT 5000`)).rows;
        let matched: { id: string; d: Loaded } | null = null;
        for (const c of candidates) {
          const d = await this.load(tx, tenantId, c.id);
          if (d.sellerGstin && computeIrn(d.sellerGstin, d.invoice.invoiceDate, d.invoice.documentType, d.invoice.invoiceNo) === irn) { matched = { id: c.id, d }; break; }
        }
        if (!matched) { outcomes.push({ docNo, irn, result: 'unmatched', message: 'No invoice here produces this IRN' }); continue; }
        const existing = await this.activeRecord(tx, tenantId, matched.id);
        if (existing?.status === 'active') { outcomes.push({ docNo: matched.d.invoice.invoiceNo, irn, result: 'already_recorded', message: 'Already recorded' }); continue; }
        if (matched.d.invoice.status !== 'posted') { outcomes.push({ docNo: matched.d.invoice.invoiceNo, irn, result: 'invalid', message: 'That invoice is cancelled here' }); continue; }
        await tx.execute(sql`INSERT INTO erp.einvoice_records (tenant_id, id, company_id, invoice_id, irn, ack_no, ack_date, signed_qr, signed_invoice, created_by) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${matched.d.companyId}::uuid, ${matched.id}::uuid, ${irn}, ${ack}, ${when.toISOString()}::timestamptz, ${qr}, ${it.signedInvoice ?? null}, ${actorId}::uuid)`);
        await this.recorder.record(tx, tenantId, 'einvoice', 'recorded', { id: matched.id }, { invoiceNo: matched.d.invoice.invoiceNo, irn, ackNo: ack });
        outcomes.push({ docNo: matched.d.invoice.invoiceNo, irn, result: 'recorded', message: 'Recorded' });
      }
      return { outcomes, recorded: outcomes.filter((o) => o.result === 'recorded').length };
    });
  }

  /** Typing in the number from the portal, for one invoice. */
  recordManual(tenantId: string, actorId: string, invoiceId: string, input: { irn: string; ackNo: string; ackDate: string; signedQr: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const d = await this.load(tx, tenantId, invoiceId);
      if (d.invoice.status !== 'posted') throw new AppError(409, 'invoice_cancelled', 'This invoice is cancelled');
      const irn = input.irn.trim().toLowerCase();
      if (irn !== computeIrn(d.sellerGstin, d.invoice.invoiceDate, d.invoice.documentType, d.invoice.invoiceNo)) throw validationFailed([{ path: 'irn', message: 'This IRN does not belong to this invoice. Check the invoice number, date and the seller GSTIN on the portal.' }]);
      const when = parsePortalTime(input.ackDate);
      if (!when) throw validationFailed([{ path: 'ackDate', message: 'The acknowledgement date is not readable. Write it like 2026-04-15 10:31:22.' }]);
      if ((await this.activeRecord(tx, tenantId, invoiceId))?.status === 'active') throw new AppError(409, 'already_recorded', 'An IRN is already recorded for this invoice');
      await tx.execute(sql`INSERT INTO erp.einvoice_records (tenant_id, id, company_id, invoice_id, irn, ack_no, ack_date, signed_qr, created_by) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${d.companyId}::uuid, ${invoiceId}::uuid, ${irn}, ${input.ackNo.trim()}, ${when.toISOString()}::timestamptz, ${input.signedQr.trim()}, ${actorId}::uuid)`);
      await this.recorder.record(tx, tenantId, 'einvoice', 'recorded', { id: invoiceId }, { invoiceNo: d.invoice.invoiceNo, irn, ackNo: input.ackNo });
      return (await this.activeRecord(tx, tenantId, invoiceId)) as EInvoiceRecord;
    });
  }

  /** Records that the IRN was cancelled on the portal (it must be done there first, within 24 hours of issue). Lets the invoice itself be cancelled here. */
  cancelRecord(tenantId: string, invoiceId: string, reason: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute(sql`UPDATE erp.einvoice_records SET status = 'cancelled', cancelled_at = now(), cancel_reason = ${reason} WHERE tenant_id = ${tenantId}::uuid AND invoice_id = ${invoiceId}::uuid AND status = 'active'`);
      if ((r.rowCount ?? 0) === 0) throw new AppError(404, 'not_found', 'No active IRN is recorded for this invoice');
      await this.recorder.record(tx, tenantId, 'einvoice', 'cancelled', { id: invoiceId }, { reason });
      return { ok: true };
    });
  }

  // ---- e-way bill ---------------------------------------------------------------------------------------------------------
  ewayFile(tenantId: string, invoiceId: string, t: Transport) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const d = await this.load(tx, tenantId, invoiceId);
      const issues = checkEway(d.invoice, d.seller, d.buyer, t);
      if (issues.some((i) => i.blocking)) throw new AppError(422, 'eway_not_ready', 'The e-way bill file cannot be made yet', { issues });
      await this.recorder.record(tx, tenantId, 'eway_bill', 'file_prepared', { id: invoiceId }, { invoiceNo: d.invoice.invoiceNo });
      return { fileName: `eway-${d.invoice.invoiceNo.replace(/[^A-Za-z0-9]/g, '_')}.json`, json: buildEway(d.invoice, d.seller, d.buyer, t, d.shipTo), issues };
    });
  }

  ewayCheck(tenantId: string, invoiceId: string, t: Transport) {
    return this.uow.inTenant(tenantId, async (tx) => { const d = await this.load(tx, tenantId, invoiceId); return { issues: checkEway(d.invoice, d.seller, d.buyer, t) }; }, { readOnly: true });
  }

  recordEway(tenantId: string, actorId: string, invoiceId: string, input: { billNo: string; billDate: string; validUntil?: string | undefined; transportMode: 'road' | 'rail' | 'air' | 'ship'; distanceKm?: number | undefined; vehicleNo?: string | undefined; transporterId?: string | undefined; transporterName?: string | undefined; transDocNo?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const d = await this.load(tx, tenantId, invoiceId);
      if (d.invoice.status !== 'posted') throw new AppError(409, 'invoice_cancelled', 'This invoice is cancelled');
      const when = parsePortalTime(input.billDate);
      if (!when) throw validationFailed([{ path: 'billDate', message: 'The e-way bill date is not readable. Write it like 2026-04-15 10:31:22.' }]);
      const until = input.validUntil ? parsePortalTime(input.validUntil) : null;
      if (input.validUntil && !until) throw validationFailed([{ path: 'validUntil', message: 'The validity date is not readable.' }]);
      const dup = await tx.execute(sql`SELECT 1 FROM erp.eway_bills WHERE tenant_id = ${tenantId}::uuid AND bill_no = ${input.billNo}`);
      if (dup.rows.length > 0) throw new AppError(409, 'duplicate_eway', 'This e-way bill number is already recorded');
      await tx.execute(sql`UPDATE erp.eway_bills SET status = 'cancelled', cancelled_at = now() WHERE tenant_id = ${tenantId}::uuid AND invoice_id = ${invoiceId}::uuid AND status = 'active'`); // a new bill replaces the old one (vehicle change, or re-issue)
      await tx.execute(sql`INSERT INTO erp.eway_bills (tenant_id, id, company_id, invoice_id, bill_no, bill_date, valid_until, transport_mode, distance_km, vehicle_no, transporter_id, transporter_name, trans_doc_no, created_by) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${d.companyId}::uuid, ${invoiceId}::uuid, ${input.billNo}, ${when.toISOString()}::timestamptz, ${until ? until.toISOString() : null}::timestamptz, ${input.transportMode}, ${input.distanceKm ?? null}, ${input.vehicleNo ? input.vehicleNo.replace(/[\s-]/g, '').toUpperCase() : null}, ${input.transporterId ?? null}, ${input.transporterName ?? null}, ${input.transDocNo ?? null}, ${actorId}::uuid)`);
      await this.recorder.record(tx, tenantId, 'eway_bill', 'recorded', { id: invoiceId }, { invoiceNo: d.invoice.invoiceNo, billNo: input.billNo });
      return { ok: true };
    });
  }

  cancelEway(tenantId: string, invoiceId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute(sql`UPDATE erp.eway_bills SET status = 'cancelled', cancelled_at = now() WHERE tenant_id = ${tenantId}::uuid AND invoice_id = ${invoiceId}::uuid AND status = 'active'`);
      if ((r.rowCount ?? 0) === 0) throw new AppError(404, 'not_found', 'No active e-way bill is recorded for this invoice');
      await this.recorder.record(tx, tenantId, 'eway_bill', 'cancelled', { id: invoiceId }, {});
      return { ok: true };
    });
  }
}

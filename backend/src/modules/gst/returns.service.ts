import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { qty } from '../inventory/decimal.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { gstRegistrations } from '../organization/organization.schema.js';
import { gstReturnSettings } from './gst.schema.js';

const u = (t: string): bigint => (t.startsWith('-') ? -toUnits(t.slice(1)) : toUnits(t));
const m = fromUnits;
const rateText = (units: bigint): string => `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;
const qtyFormat = (units: bigint): string => (units < 0n ? `-${qty.format(-units)}` : qty.format(units));
const B2CL_LIMIT = 250_000n * 10_000n; // inter-state B2C invoices above 2.5 lakh are reported one by one

export interface Period { from: string; to: string; label: string }
export function monthPeriod(period: string): Period {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new AppError(422, 'invalid_period', 'Use a month as YYYY-MM');
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}`, label: period };
}
/** A quarter of the financial year: `2025-Q1` is April to June 2025, `2025-Q4` is January to March 2026. */
export function quarterPeriod(quarter: string): Period {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new AppError(422, 'invalid_period', 'Use a financial-year quarter as YYYY-Qn (Q1 = April to June of that year)');
  const y = Number(match[1]);
  const q = Number(match[2]);
  const startMonth = 4 + (q - 1) * 3; // 4, 7, 10, 13
  const start = new Date(Date.UTC(y, startMonth - 1, 1));
  const end = new Date(Date.UTC(y, startMonth + 2, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), label: quarter };
}

type SalesRow = {
  id: string; document_type: string; invoice_no: string; invoice_date: string; customer_gstin: string | null; customer_gst_treatment: string; place_of_supply: string; supply_type: string;
  tax_payment: string | null; reverse_charge: boolean; tax_regime: string; grand_total: string; original_no: string | null; original_date: string | null;
  hsn: string | null; quantity: string; taxable: string; igst_rate: string; cgst_rate: string; sgst_rate: string; igst: string; cgst: string; sgst: string; cess: string; uqc: string | null;
};
type BillRow = {
  id: string; document_type: string; bill_no: string; bill_date: string; supplier_gstin: string | null; supplier_gst_treatment: string; supplier_state: string; place_of_supply: string; tax_regime: string; reverse_charge: boolean;
  taxable: string; igst: string; cgst: string; sgst: string; cess: string; itc_eligible: boolean; stocked: boolean; original_bill_id: string | null;
};
interface Tax { txval: bigint; igst: bigint; cgst: bigint; sgst: bigint; cess: bigint }
const zero = (): Tax => ({ txval: 0n, igst: 0n, cgst: 0n, sgst: 0n, cess: 0n });
const add = (a: Tax, b: Tax, sign = 1n): Tax => ({ txval: a.txval + sign * b.txval, igst: a.igst + sign * b.igst, cgst: a.cgst + sign * b.cgst, sgst: a.sgst + sign * b.sgst, cess: a.cess + sign * b.cess });
const out = (t: Tax) => ({ txval: m(t.txval), iamt: m(t.igst), camt: m(t.cgst), samt: m(t.sgst), csamt: m(t.cess) });

/** GSTR-1, GSTR-3B, the input credit register and CMP-08, computed from sales invoices and supplier bills. Nothing is filed or stored. */
@Injectable()
export class GstReturnsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- settings ------------------------------------------------------------------------------------------------------------------
  getSettings(tenantId: string, registrationId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const reg = first(await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.id, registrationId))), 'GST registration');
      const [s] = await tx.select().from(gstReturnSettings).where(and(eq(gstReturnSettings.tenantId, tenantId), eq(gstReturnSettings.gstRegistrationId, registrationId)));
      return { gstRegistrationId: registrationId, registrationType: reg.registrationType, compositionRate: s?.compositionRate ?? null };
    }, { readOnly: true });
  }
  putSettings(tenantId: string, registrationId: string, compositionRate: string | null) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const reg = first(await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.id, registrationId))), 'GST registration');
      if (compositionRate !== null && reg.registrationType !== 'composition') throw new AppError(422, 'not_composition', 'A composition rate only applies to a composition registration');
      await tx.insert(gstReturnSettings).values({ tenantId, companyId: reg.companyId, gstRegistrationId: registrationId, compositionRate }).onConflictDoUpdate({ target: [gstReturnSettings.tenantId, gstReturnSettings.gstRegistrationId], set: { compositionRate } });
      await this.recorder.record(tx, tenantId, 'gst_return_settings', 'updated', { id: registrationId }, { registrationId, compositionRate });
      const [row] = await tx.select().from(gstReturnSettings).where(and(eq(gstReturnSettings.tenantId, tenantId), eq(gstReturnSettings.gstRegistrationId, registrationId)));
      return { gstRegistrationId: registrationId, registrationType: reg.registrationType, compositionRate: row?.compositionRate ?? null };
    });
  }

  // ---- data ----------------------------------------------------------------------------------------------------------------------
  private async registration(tx: Tx, tenantId: string, id: string, kind: 'regular' | 'composition') {
    const reg = first(await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.id, id))), 'GST registration');
    const composition = reg.registrationType === 'composition';
    if (kind === 'composition' && !composition) throw new AppError(422, 'not_composition', 'CMP-08 is for composition registrations');
    if (kind === 'regular' && composition) throw new AppError(422, 'is_composition', 'A composition taxpayer files CMP-08 and GSTR-4, not GSTR-1 or GSTR-3B');
    return reg;
  }

  private async sales(tx: Tx, tenantId: string, registrationId: string, p: Period): Promise<SalesRow[]> {
    const res = await tx.execute<SalesRow>(sql`
      SELECT i.id::text, i.document_type, i.invoice_no, i.invoice_date::text, i.customer_gstin, i.customer_gst_treatment, i.place_of_supply, i.supply_type, i.tax_payment, i.reverse_charge, i.tax_regime, i.grand_total::text,
             o.invoice_no AS original_no, o.invoice_date::text AS original_date, l.hsn_sac_code AS hsn, l.quantity::text, l.taxable_value::text AS taxable, l.igst_rate::text, l.cgst_rate::text, l.sgst_rate::text,
             l.igst_amount::text AS igst, l.cgst_amount::text AS cgst, l.sgst_amount::text AS sgst, l.cess_amount::text AS cess, un.code AS uqc
        FROM erp.sales_invoices i
        JOIN erp.sales_invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
        JOIN erp.items it ON it.tenant_id = l.tenant_id AND it.id = l.item_id
        LEFT JOIN erp.units un ON un.tenant_id = it.tenant_id AND un.id = it.base_uom_id
        LEFT JOIN erp.sales_invoices o ON o.tenant_id = i.tenant_id AND o.id = i.original_invoice_id
       WHERE i.tenant_id = ${tenantId}::uuid AND i.gst_registration_id = ${registrationId}::uuid AND i.invoice_date BETWEEN ${p.from}::date AND ${p.to}::date AND (i.status = 'posted' OR i.cancel_date > ${p.to}::date)
       ORDER BY i.invoice_date, i.invoice_no, l.line_no`);
    return res.rows;
  }

  private async bills(tx: Tx, tenantId: string, registrationId: string, p: Period): Promise<BillRow[]> {
    const res = await tx.execute<BillRow>(sql`
      SELECT b.id::text, b.document_type, b.bill_no, b.bill_date::text, b.supplier_gstin, b.supplier_gst_treatment, b.supplier_state, b.place_of_supply, b.tax_regime, b.reverse_charge,
             l.taxable_value::text AS taxable, l.igst_amount::text AS igst, l.cgst_amount::text AS cgst, l.sgst_amount::text AS sgst, l.cess_amount::text AS cess, l.itc_eligible, it.is_stocked AS stocked, b.original_bill_id::text
        FROM erp.supplier_bills b
        JOIN erp.supplier_bill_lines l ON l.tenant_id = b.tenant_id AND l.bill_id = b.id
        JOIN erp.items it ON it.tenant_id = l.tenant_id AND it.id = l.item_id
       WHERE b.tenant_id = ${tenantId}::uuid AND b.gst_registration_id = ${registrationId}::uuid AND b.bill_date BETWEEN ${p.from}::date AND ${p.to}::date AND (b.status = 'posted' OR b.cancel_date > ${p.to}::date)
       ORDER BY b.bill_date, b.bill_no, l.line_no`);
    return res.rows;
  }

  // ---- GSTR-1 ----------------------------------------------------------------------------------------------------------------------
  gstr1(tenantId: string, registrationId: string, period: string) {
    const p = monthPeriod(period);
    return this.uow.inTenant(tenantId, async (tx) => {
      const reg = await this.registration(tx, tenantId, registrationId, 'regular');
      const rows = await this.sales(tx, tenantId, registrationId, p);
      const isNote = (r: SalesRow) => r.document_type === 'credit_note' || r.document_type === 'debit_note';
      const sign = (r: SalesRow): bigint => (r.document_type === 'credit_note' ? -1n : 1n);
      const rateOf = (r: SalesRow): bigint => (r.tax_regime === 'intra' ? u(r.cgst_rate) + u(r.sgst_rate) : u(r.igst_rate));
      const taxOf = (r: SalesRow): Tax => ({ txval: u(r.taxable), igst: u(r.igst), cgst: u(r.cgst), sgst: u(r.sgst), cess: u(r.cess) });
      const nil = { inter_reg: zero(), intra_reg: zero(), inter_unreg: zero(), intra_unreg: zero() };

      // Group lines into documents, and each document's lines by rate.
      const docs = new Map<string, { head: SalesRow; byRate: Map<string, Tax>; nilTax: Tax }>();
      for (const r of rows) {
        let d = docs.get(r.id);
        if (!d) docs.set(r.id, (d = { head: r, byRate: new Map(), nilTax: zero() }));
        const zeroRated = r.supply_type === 'export' || r.supply_type === 'sez';
        const rate = rateOf(r);
        if (rate === 0n && !zeroRated && taxOf(r).cgst + taxOf(r).igst + taxOf(r).sgst + taxOf(r).cess === 0n) {
          d.nilTax = add(d.nilTax, taxOf(r));
          const reg2 = r.supply_type === 'b2b' ? 'reg' : 'unreg';
          const where = `${r.tax_regime === 'inter' ? 'inter' : 'intra'}_${reg2}` as keyof typeof nil;
          nil[where] = add(nil[where], taxOf(r), sign(r));
        } else {
          const key = rateText(rate);
          d.byRate.set(key, add(d.byRate.get(key) ?? zero(), taxOf(r)));
        }
      }
      const itemsOf = (d: { byRate: Map<string, Tax> }) => [...d.byRate].sort(([a], [b]) => a.localeCompare(b)).map(([rt, t]) => ({ rt, ...out(t) }));
      const b2b = new Map<string, unknown[]>();
      const b2cl = new Map<string, unknown[]>();
      const b2cs = new Map<string, { sply_ty: string; pos: string; rt: string } & Tax>();
      const exp: Record<'WPAY' | 'WOPAY', unknown[]> = { WPAY: [], WOPAY: [] };
      const cdnr = new Map<string, unknown[]>();
      const cdnur: unknown[] = [];
      const summary = { b2b: zero(), b2cl: zero(), b2cs: zero(), exp: zero(), cdnr: zero(), cdnur: zero(), nil: zero() };
      for (const d of docs.values()) {
        const h = d.head;
        const sg = sign(h);
        if (d.byRate.size === 0) continue; // all nil / exempt: reported in the nil table only
        const total = [...d.byRate.values()].reduce((a, t) => add(a, t), zero());
        const common = { val: m(u(h.grand_total) * sg), pos: h.place_of_supply, rchrg: h.reverse_charge ? 'Y' : 'N', items: itemsOf(d) };
        const inv = (extra: object) => ({ inum: h.invoice_no, idt: h.invoice_date, ...common, ...extra });
        if (isNote(h)) {
          const note = { nt_num: h.invoice_no, nt_dt: h.invoice_date, ntty: h.document_type === 'credit_note' ? 'C' : 'D', inum: h.original_no, idt: h.original_date, ...common, val: m(u(h.grand_total)) };
          if (h.supply_type === 'b2b' || h.supply_type === 'sez') { const k = h.customer_gstin ?? ''; cdnr.set(k, [...(cdnr.get(k) ?? []), note]); summary.cdnr = add(summary.cdnr, total, sg); }
          else { cdnur.push({ ...note, typ: h.supply_type === 'export' ? (h.tax_payment === 'with_payment' ? 'EXPWP' : 'EXPWOP') : 'B2CL' }); summary.cdnur = add(summary.cdnur, total, sg); }
          continue;
        }
        if (h.supply_type === 'export') {
          exp[h.tax_payment === 'with_payment' ? 'WPAY' : 'WOPAY'].push(inv({}));
          summary.exp = add(summary.exp, total);
        } else if (h.supply_type === 'b2b' || h.supply_type === 'sez') {
          const typ = h.supply_type === 'sez' ? (h.tax_payment === 'with_payment' ? 'SEWP' : 'SEWOP') : h.reverse_charge ? 'R' : 'R';
          const k = h.customer_gstin ?? '';
          b2b.set(k, [...(b2b.get(k) ?? []), inv({ inv_typ: typ })]);
          summary.b2b = add(summary.b2b, total);
        } else if (h.tax_regime === 'inter' && u(h.grand_total) > B2CL_LIMIT) {
          b2cl.set(h.place_of_supply, [...(b2cl.get(h.place_of_supply) ?? []), inv({})]);
          summary.b2cl = add(summary.b2cl, total);
        } else {
          for (const [rt, t] of d.byRate) {
            const k = `${h.tax_regime}|${h.place_of_supply}|${rt}`;
            const cur = b2cs.get(k) ?? { sply_ty: h.tax_regime === 'inter' ? 'INTER' : 'INTRA', pos: h.place_of_supply, rt, ...zero() };
            b2cs.set(k, { ...cur, ...add(cur, t) });
          }
          summary.b2cs = add(summary.b2cs, total);
        }
      }
      for (const v of Object.values(nil)) summary.nil = add(summary.nil, v);

      // HSN summary (credit notes subtract).
      const hsn = new Map<string, { hsn_sc: string; uqc: string; rt: string; qty: bigint } & Tax>();
      for (const r of rows) {
        const key = `${r.hsn ?? 'NA'}|${r.uqc ?? 'NOS'}|${rateText(rateOf(r))}`;
        const cur = hsn.get(key) ?? { hsn_sc: r.hsn ?? 'NA', uqc: r.uqc ?? 'NOS', rt: rateText(rateOf(r)), qty: 0n, ...zero() };
        const sg = sign(r);
        hsn.set(key, { ...cur, qty: cur.qty + (r.document_type === 'debit_note' ? 0n : sg * qty.parse(r.quantity)), ...add(cur, taxOf(r), sg) });
      }

      // Documents issued, by type, from the number ranges.
      const issued = await tx.execute<{ document_type: string; first: string; last: string; total: string; cancelled: string }>(sql`
        SELECT document_type, MIN(invoice_no) AS first, MAX(invoice_no) AS last, COUNT(*)::text AS total, COUNT(*) FILTER (WHERE status = 'cancelled' AND cancel_date <= ${p.to}::date)::text AS cancelled
          FROM erp.sales_invoices WHERE tenant_id = ${tenantId}::uuid AND gst_registration_id = ${registrationId}::uuid AND invoice_date BETWEEN ${p.from}::date AND ${p.to}::date GROUP BY document_type ORDER BY document_type`);
      return {
        gstin: reg.gstin, period, from: p.from, to: p.to,
        b2b: [...b2b].map(([ctin, inv]) => ({ ctin, inv })), b2cl: [...b2cl].map(([pos, inv]) => ({ pos, inv })),
        b2cs: [...b2cs.values()].map(({ sply_ty, pos, rt, ...t }) => ({ sply_ty, pos, rt, ...out(t) })),
        exp: (['WPAY', 'WOPAY'] as const).filter((k) => exp[k].length > 0).map((k) => ({ exp_typ: k, inv: exp[k] })),
        cdnr: [...cdnr].map(([ctin, nt]) => ({ ctin, nt })), cdnur,
        nil: Object.fromEntries(Object.entries(nil).map(([k, v]) => [k, m(v.txval)])),
        hsn: [...hsn.values()].map(({ qty: q, hsn_sc, uqc, rt, ...t }) => ({ hsn_sc, uqc, rt, qty: qtyFormat(q), ...out(t) })),
        doc_issue: issued.rows.map((r) => ({ doc_typ: r.document_type, from: r.first, to: r.last, totnum: Number(r.total), cancel: Number(r.cancelled), net_issue: Number(r.total) - Number(r.cancelled) })),
        summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, out(v)])),
      };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  // ---- GSTR-3B -----------------------------------------------------------------------------------------------------------------------
  gstr3b(tenantId: string, registrationId: string, period: string) {
    const p = monthPeriod(period);
    return this.uow.inTenant(tenantId, async (tx) => {
      const reg = await this.registration(tx, tenantId, registrationId, 'regular');
      const sales = await this.sales(tx, tenantId, registrationId, p);
      const bills = await this.bills(tx, tenantId, registrationId, p);
      const sg = (r: SalesRow): bigint => (r.document_type === 'credit_note' ? -1n : 1n);
      const tax = (r: SalesRow): Tax => ({ txval: u(r.taxable), igst: u(r.igst), cgst: u(r.cgst), sgst: u(r.sgst), cess: u(r.cess) });
      let a = zero(); let b = zero(); let c = zero(); let rcmOutward = zero();
      const unreg = new Map<string, Tax>(); const compo = new Map<string, Tax>();
      for (const r of sales) {
        const t = tax(r);
        const taxes = t.igst + t.cgst + t.sgst + t.cess;
        if (r.supply_type === 'export' || r.supply_type === 'sez') b = add(b, t, sg(r));
        else if (r.reverse_charge) rcmOutward = add(rcmOutward, t, sg(r));
        else if (taxes === 0n) c = add(c, t, sg(r));
        else a = add(a, t, sg(r));
        if (r.tax_regime === 'inter' && taxes > 0n && !r.reverse_charge && r.supply_type !== 'b2b' && r.supply_type !== 'export' && r.supply_type !== 'sez') unreg.set(r.place_of_supply, add(unreg.get(r.place_of_supply) ?? zero(), t, sg(r)));
        if (r.tax_regime === 'inter' && taxes > 0n && r.customer_gst_treatment === 'registered_composition') compo.set(r.place_of_supply, add(compo.get(r.place_of_supply) ?? zero(), t, sg(r)));
      }
      // Inward: reverse charge, imports, other ITC, reversals and blocked credit.
      let rcm = zero(); let imports = zero(); let other = zero(); let rcmItc = zero(); let reversed = zero(); let blocked = zero();
      const inwardNil = { inter: 0n, intra: 0n };
      for (const r of bills) {
        const t: Tax = { txval: u(r.taxable), igst: u(r.igst), cgst: u(r.cgst), sgst: u(r.sgst), cess: u(r.cess) };
        const taxes = t.igst + t.cgst + t.sgst + t.cess;
        if (r.document_type === 'debit_note') { if (r.itc_eligible) reversed = add(reversed, t); continue; }
        if (r.reverse_charge) { rcm = add(rcm, t); if (r.itc_eligible) rcmItc = add(rcmItc, t); else blocked = add(blocked, t); continue; }
        if (taxes === 0n) { inwardNil[r.tax_regime === 'inter' ? 'inter' : 'intra'] += t.txval; continue; }
        if (!r.itc_eligible) { blocked = add(blocked, t); continue; }
        if (r.supplier_gst_treatment === 'overseas') imports = add(imports, t); else other = add(other, t);
      }
      const itcAvail = add(add(imports, other), rcmItc);
      const itcNet = add(itcAvail, reversed, -1n);
      // Output liability: outward tax (3.1 a and the IGST on zero-rated supplies paid with tax) plus reverse-charge tax, which is paid in cash.
      const output = add(a, { ...b, txval: 0n });
      const credit = { igst: itcNet.igst, cgst: itcNet.cgst, sgst: itcNet.sgst, cess: itcNet.cess };
      const liab = { igst: output.igst, cgst: output.cgst, sgst: output.sgst, cess: output.cess };
      const paid = { igst: 0n, cgst: 0n, sgst: 0n, cess: 0n };
      const use = (from: 'igst' | 'cgst' | 'sgst', to: 'igst' | 'cgst' | 'sgst') => { const x = credit[from] < liab[to] ? credit[from] : liab[to]; if (x > 0n) { credit[from] -= x; liab[to] -= x; paid[to] += x; } };
      for (const to of ['igst', 'cgst', 'sgst'] as const) use('igst', to); // IGST credit first: IGST, then CGST, then SGST
      use('cgst', 'cgst'); use('cgst', 'igst'); use('sgst', 'sgst'); use('sgst', 'igst');
      const cessUse = credit.cess < liab.cess ? credit.cess : liab.cess; credit.cess -= cessUse; liab.cess -= cessUse; paid.cess += cessUse;
      const sect = (t: Tax) => ({ txval: m(t.txval), iamt: m(t.igst), camt: m(t.cgst), samt: m(t.sgst), csamt: m(t.cess) });
      const byPos = (mp: Map<string, Tax>) => [...mp].sort(([x], [y]) => x.localeCompare(y)).map(([pos, t]) => ({ pos, txval: m(t.txval), iamt: m(t.igst) }));
      return {
        gstin: reg.gstin, period, from: p.from, to: p.to,
        sup_details: { osup_det: sect(a), osup_zero: sect(b), osup_nil_exmp: { txval: m(c.txval) }, isup_rev: sect(rcm), osup_nongst: { txval: '0.0000' }, outward_reverse_charge_by_recipient: { txval: m(rcmOutward.txval) } },
        inter_sup: { unreg_details: byPos(unreg), comp_details: byPos(compo) },
        itc_elg: {
          itc_avl: { impg_and_imps: sect(imports), isrc: sect(rcmItc), oth: sect(other) },
          itc_rev: { oth: sect(reversed) }, itc_net: sect(itcNet), itc_inelg: { oth: sect(blocked) },
        },
        inward_sup: { isup_details: { inter: m(inwardNil.inter), intra: m(inwardNil.intra) } },
        tax_pmt: {
          liability: { igst: m(output.igst), cgst: m(output.cgst), sgst: m(output.sgst), cess: m(output.cess), reverse_charge: { igst: m(rcm.igst), cgst: m(rcm.cgst), sgst: m(rcm.sgst), cess: m(rcm.cess) } },
          paid_through_itc: { igst: m(paid.igst), cgst: m(paid.cgst), sgst: m(paid.sgst), cess: m(paid.cess) },
          payable_in_cash: { igst: m(liab.igst + rcm.igst), cgst: m(liab.cgst + rcm.cgst), sgst: m(liab.sgst + rcm.sgst), cess: m(liab.cess + rcm.cess) },
          itc_unused: { igst: m(credit.igst), cgst: m(credit.cgst), sgst: m(credit.sgst), cess: m(credit.cess) },
        },
      };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /** Every bill line with the input credit it carries: available, blocked, or reversed by a debit note. */
  itcRegister(tenantId: string, registrationId: string, period: string) {
    const p = monthPeriod(period);
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.registration(tx, tenantId, registrationId, 'regular');
      const rows = await this.bills(tx, tenantId, registrationId, p);
      const docs = new Map<string, { document: string; type: string; date: string; supplier: string | null; treatment: string; reverseCharge: boolean; igst: bigint; cgst: bigint; sgst: bigint; cess: bigint; taxable: bigint; eligible: bigint; blocked: bigint }>();
      for (const r of rows) {
        const d = docs.get(r.id) ?? { document: r.bill_no, type: r.document_type, date: r.bill_date, supplier: r.supplier_gstin, treatment: r.supplier_gst_treatment, reverseCharge: r.reverse_charge, igst: 0n, cgst: 0n, sgst: 0n, cess: 0n, taxable: 0n, eligible: 0n, blocked: 0n };
        const taxes = u(r.igst) + u(r.cgst) + u(r.sgst) + u(r.cess);
        d.igst += u(r.igst); d.cgst += u(r.cgst); d.sgst += u(r.sgst); d.cess += u(r.cess); d.taxable += u(r.taxable);
        if (r.itc_eligible) d.eligible += taxes; else d.blocked += taxes;
        docs.set(r.id, d);
      }
      const list = [...docs.values()].map((d) => ({ document: d.document, type: d.type, date: d.date, supplierGstin: d.supplier, supplierTreatment: d.treatment, reverseCharge: d.reverseCharge, taxable: m(d.taxable), igst: m(d.igst), cgst: m(d.cgst), sgst: m(d.sgst), cess: m(d.cess), itcAvailable: m(d.type === 'debit_note' ? -d.eligible : d.eligible), itcBlocked: m(d.blocked) }));
      const sum = (pick: (x: (typeof list)[number]) => string) => m(list.reduce((s, x) => s + u(pick(x)), 0n));
      return { period, documents: list, totals: { itcAvailable: sum((x) => x.itcAvailable), itcBlocked: sum((x) => x.itcBlocked) } };
    }, { readOnly: true });
  }

  // ---- CMP-08 -------------------------------------------------------------------------------------------------------------------------
  cmp08(tenantId: string, registrationId: string, quarter: string) {
    const p = quarterPeriod(quarter);
    return this.uow.inTenant(tenantId, async (tx) => {
      const reg = await this.registration(tx, tenantId, registrationId, 'composition');
      const [s] = await tx.select().from(gstReturnSettings).where(and(eq(gstReturnSettings.tenantId, tenantId), eq(gstReturnSettings.gstRegistrationId, registrationId)));
      if (!s?.compositionRate) throw new AppError(409, 'composition_rate_not_set', 'Set the composition rate for this registration first', { missing: ['compositionRate'] });
      const rate = u(s.compositionRate);
      const sales = await this.sales(tx, tenantId, registrationId, p);
      const turnoverByDoc = sales.reduce((acc, r) => acc + (r.document_type === 'credit_note' ? -1n : 1n) * u(r.taxable), 0n);
      const rounded = (turnoverByDoc * rate + 500_000n) / 1_000_000n; // turnover x rate%, both with four decimals, rounded half up
      const central = rounded / 2n;
      const state = rounded - central;
      const bills = await this.bills(tx, tenantId, registrationId, p);
      let rcm = zero();
      for (const r of bills) if (r.reverse_charge && r.document_type === 'bill') rcm = add(rcm, { txval: u(r.taxable), igst: u(r.igst), cgst: u(r.cgst), sgst: u(r.sgst), cess: u(r.cess) });
      const rcmTax = rcm.igst + rcm.cgst + rcm.sgst + rcm.cess;
      return {
        gstin: reg.gstin, quarter, from: p.from, to: p.to,
        outward: { turnover: m(turnoverByDoc), ratePercent: s.compositionRate, central: m(central), state: m(state), integrated: '0.0000', tax: m(rounded) },
        inwardReverseCharge: { taxable: m(rcm.txval), integrated: m(rcm.igst), central: m(rcm.cgst), state: m(rcm.sgst), cess: m(rcm.cess) },
        totalPayable: m(rounded + rcmTax),
      };
    }, { readOnly: true, isolation: 'repeatable read' });
  }
}

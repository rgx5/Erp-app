import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { buyerKit, type Buyer } from '../support/buyer.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof buyerKit>;
beforeAll(async () => { server = await startServer(); k = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const sale = (b: Buyer, customerId: string, lines: { itemId: string; quantity: string; unitPrice: string }[], o: object = {}) =>
  call(server, 'POST', '/v1/sales/invoices', { tenant: b.tenant, body: { companyId: b.companyId, gstRegistrationId: b.regId, customerId, invoiceDate: '2025-04-10', ...(customerId === b.cust.local ? { placeOfSupplyState: '27' } : {}), // the fixture's local customer is delivered to Gujarat unless told otherwise
      lines: lines.map((l) => ({ ...l, warehouseId: b.wh })), ...o } });
const gstin = async (b: Buyer, partyId: string) => (await call(server, 'GET', `/v1/parties/${partyId}`, { tenant: b.tenant })).json.gstin as string;
const ret = async (b: Buyer, what: string, query: string) => (await call(server, 'GET', `/v1/gst/returns/${what}?registrationId=${b.regId}&${query}`, { tenant: b.tenant })).json;

/** April 2025 in a Maharashtra business: every kind of supply once, and every kind of purchase once. */
async function april(name: string) {
  const b = await k.buyer(name);
  const w = b.item.widget;
  const inv1 = ok(await sale(b, b.cust.local, [{ itemId: w, quantity: '10', unitPrice: '1000' }])); // B2B, same state: 10,000 + 900 + 900
  ok(await sale(b, b.cust.other, [{ itemId: w, quantity: '5', unitPrice: '2000' }])); // B2B, other state: 10,000 + 1,800 IGST
  ok(await sale(b, b.cust.consumer, [{ itemId: b.item.cheap, quantity: '20', unitPrice: '100' }])); // B2C small: 2,000 at 5%
  ok(await sale(b, b.cust.consumer, [{ itemId: w, quantity: '10', unitPrice: '30000' }], { placeOfSupplyState: '29' })); // B2C large, other state: 300,000 + 54,000 IGST
  ok(await sale(b, b.cust.overseas, [{ itemId: w, quantity: '2', unitPrice: '5000' }], { taxPayment: 'with_payment' })); // export with payment: 10,000 + 1,800
  ok(await sale(b, b.cust.sez, [{ itemId: w, quantity: '1', unitPrice: '5000' }], { taxPayment: 'without_payment' })); // SEZ without payment
  ok(await sale(b, b.cust.local, [{ itemId: b.item.exemptItem, quantity: '10', unitPrice: '100' }])); // exempt: 1,000
  ok(await call(server, 'POST', '/v1/sales/credit-notes', { tenant: b.tenant, body: { originalInvoiceId: inv1.id, noteDate: '2025-04-20', reason: 'Returned', lines: [{ originalLineId: inv1.lines[0].id, quantity: '2' }] } })); // 2,000 + 180 + 180
  // purchases
  const g1 = await k.ordered(b, b.sup.intra);
  const p1 = ok(await k.bill(b, b.sup.intra, [k.withItem(b, k.bl(g1.grnLine))])); // 5,000 + 450 + 450 credit
  const g2 = await k.ordered(b, b.sup.inter);
  ok(await k.bill(b, b.sup.inter, [k.withItem(b, k.bl(g2.grnLine))])); // 5,000 + 900 IGST credit
  const g3 = await k.ordered(b, b.sup.unreg);
  ok(await k.bill(b, b.sup.unreg, [k.withItem(b, k.bl(g3.grnLine))], { reverseCharge: true, supplierStateCode: '27' })); // reverse charge: 450 + 450 liability and credit
  const g4 = await k.ordered(b, b.sup.intra);
  ok(await k.bill(b, b.sup.intra, [k.withItem(b, k.bl(g4.grnLine, { itcEligible: false }))])); // blocked: 900
  ok(await call(server, 'POST', '/v1/purchasing/debit-notes', { tenant: b.tenant, body: { originalBillId: p1.id, noteDate: '2025-04-20', reason: 'Damaged', lines: [{ originalLineId: p1.lines[0].id, quantity: '3' }] } })); // credit reversed: 135 + 135
  return b;
}

describe('GSTR-1', () => {
  it('sorts every kind of supply into its section, with exact figures', async () => {
    const b = await april('G1 Co');
    const r = await ret(b, 'gstr1', 'period=2025-04');
    expect(r).toMatchObject({ period: '2025-04', from: '2025-04-01', to: '2025-04-30' });
    const local = await gstin(b, b.cust.local);
    const other = await gstin(b, b.cust.other);
    const sez = await gstin(b, b.cust.sez);
    // B2B: local, other state and SEZ (no payment)
    expect(r.b2b.map((c: { ctin: string }) => c.ctin).sort()).toEqual([local, other, sez].sort());
    const ofLocal = r.b2b.find((c: { ctin: string }) => c.ctin === local).inv;
    expect(ofLocal).toHaveLength(1); // the exempt supply to the same customer is in the nil table, not here
    expect(ofLocal[0]).toMatchObject({ inum: 'INV/2526/00001', idt: '2025-04-10', val: '11800.0000', pos: '27', rchrg: 'N', inv_typ: 'R', items: [{ rt: '18.0000', txval: '10000.0000', iamt: '0.0000', camt: '900.0000', samt: '900.0000', csamt: '0.0000' }] });
    expect(r.b2b.find((c: { ctin: string }) => c.ctin === other).inv[0]).toMatchObject({ pos: '29', items: [{ rt: '18.0000', txval: '10000.0000', iamt: '1800.0000', camt: '0.0000' }] });
    expect(r.b2b.find((c: { ctin: string }) => c.ctin === sez).inv[0]).toMatchObject({ inv_typ: 'SEWOP', items: [{ txval: '5000.0000', iamt: '0.0000' }] });
    // B2C: one large inter-state invoice by itself, the small one summarised
    expect(r.b2cl).toEqual([{ pos: '29', inv: [expect.objectContaining({ val: '354000.0000', items: [expect.objectContaining({ txval: '300000.0000', iamt: '54000.0000' })] })] }]);
    expect(r.b2cs).toEqual([{ sply_ty: 'INTRA', pos: '27', rt: '5.0000', txval: '2000.0000', iamt: '0.0000', camt: '50.0000', samt: '50.0000', csamt: '0.0000' }]);
    expect(r.exp).toEqual([{ exp_typ: 'WPAY', inv: [expect.objectContaining({ val: '11800.0000', items: [expect.objectContaining({ txval: '10000.0000', iamt: '1800.0000' })] })] }]);
    expect(r.cdnr).toEqual([{ ctin: local, nt: [expect.objectContaining({ ntty: 'C', inum: 'INV/2526/00001', idt: '2025-04-10', val: '2360.0000', items: [expect.objectContaining({ txval: '2000.0000', camt: '180.0000', samt: '180.0000' })] })] }]);
    expect(r.cdnur).toEqual([]);
    expect(r.nil).toMatchObject({ intra_reg: '1000.0000', inter_reg: '0.0000', intra_unreg: '0.0000', inter_unreg: '0.0000' });
    // HSN: grouped by code and rate; the credit note takes quantity and value back
    const w = r.hsn.find((h: { hsn_sc: string; rt: string }) => h.hsn_sc === '8479' && h.rt === '18.0000');
    expect(w).toMatchObject({ uqc: 'NOS', qty: '25.000000', txval: '328000.0000' }); // 10 + 5 + 10 + 2 - 2 units; the SEZ unit (no tax paid) is its own row at 0%
    expect(r.hsn.length).toBeGreaterThanOrEqual(4);
    expect(r.doc_issue).toEqual([{ doc_typ: 'credit_note', from: 'CN/2526/00001', to: 'CN/2526/00001', totnum: 1, cancel: 0, net_issue: 1 }, { doc_typ: 'tax_invoice', from: 'INV/2526/00001', to: 'INV/2526/00007', totnum: 7, cancel: 0, net_issue: 7 }]);
    // another month has none of it
    const may = await ret(b, 'gstr1', 'period=2025-05');
    expect(may.b2b).toEqual([]);
    expect(may.doc_issue).toEqual([]);
  });

  it('counts a cancelled invoice as issued-and-cancelled, and keeps one cancelled later in its month', async () => {
    const b = await k.buyer('G1 Cancel Co');
    const w = b.item.widget;
    const a = ok(await sale(b, b.cust.local, [{ itemId: w, quantity: '1', unitPrice: '1000' }]));
    const c = ok(await sale(b, b.cust.local, [{ itemId: w, quantity: '1', unitPrice: '2000' }], { invoiceDate: '2025-04-12' }));
    ok(await call(server, 'POST', `/v1/sales/invoices/${a.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-15', reason: 'Wrong customer' } }), 200);
    ok(await call(server, 'POST', `/v1/sales/invoices/${c.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-05-03', reason: 'Late' } }), 200);
    const r = await ret(b, 'gstr1', 'period=2025-04');
    const invoices = r.b2b.flatMap((x: { inv: { inum: string }[] }) => x.inv.map((i) => i.inum));
    expect(invoices).toEqual(['INV/2526/00002']); // cancelled within the month: not reported; cancelled after: still the month's
    expect(r.doc_issue).toEqual([{ doc_typ: 'tax_invoice', from: 'INV/2526/00001', to: 'INV/2526/00002', totnum: 2, cancel: 1, net_issue: 1 }]);
    const may = await ret(b, 'gstr1', 'period=2025-05');
    expect(may.doc_issue).toEqual([]);
  });
});

describe('GSTR-3B and the input credit register', () => {
  it('summarises supplies, input credit and how the tax is paid, to the paisa', async () => {
    const b = await april('G3 Co');
    const r = await ret(b, 'gstr3b', 'period=2025-04');
    // 3.1: taxable outward (net of the credit note), zero-rated, nil
    expect(r.sup_details.osup_det).toEqual({ txval: '320000.0000', iamt: '55800.0000', camt: '770.0000', samt: '770.0000', csamt: '0.0000' });
    expect(r.sup_details.osup_zero).toEqual({ txval: '15000.0000', iamt: '1800.0000', camt: '0.0000', samt: '0.0000', csamt: '0.0000' });
    expect(r.sup_details.osup_nil_exmp.txval).toBe('1000.0000');
    expect(r.sup_details.isup_rev).toMatchObject({ txval: '5000.0000', camt: '450.0000', samt: '450.0000' });
    expect(r.inter_sup.unreg_details).toEqual([{ pos: '29', txval: '300000.0000', iamt: '54000.0000' }]);
    // 4: input credit: regular bills + reverse charge, less the debit note; blocked credit shown apart
    expect(r.itc_elg.itc_avl.oth).toMatchObject({ iamt: '900.0000', camt: '450.0000', samt: '450.0000' });
    expect(r.itc_elg.itc_avl.isrc).toMatchObject({ camt: '450.0000', samt: '450.0000' });
    expect(r.itc_elg.itc_rev.oth).toMatchObject({ camt: '135.0000', samt: '135.0000' });
    expect(r.itc_elg.itc_net).toMatchObject({ iamt: '900.0000', camt: '765.0000', samt: '765.0000' });
    expect(r.itc_elg.itc_inelg.oth).toMatchObject({ camt: '450.0000', samt: '450.0000' });
    // 6: IGST credit goes to IGST; CGST and SGST credit to their own; reverse-charge tax is paid in cash
    expect(r.tax_pmt.liability).toMatchObject({ igst: '57600.0000', cgst: '770.0000', sgst: '770.0000' });
    expect(r.tax_pmt.paid_through_itc).toMatchObject({ igst: '900.0000', cgst: '765.0000', sgst: '765.0000' });
    expect(r.tax_pmt.payable_in_cash).toMatchObject({ igst: '56700.0000', cgst: '455.0000', sgst: '455.0000' }); // 5 + 450 reverse charge
    expect(r.tax_pmt.itc_unused).toMatchObject({ igst: '0.0000', cgst: '0.0000', sgst: '0.0000' });
  });

  it('lets surplus IGST credit pay CGST and SGST, and reports unused credit', async () => {
    const b = await k.buyer('G3 Cross Co');
    const g = await k.ordered(b, b.sup.inter, { price: '10000' }); // 100,000 + 18,000 IGST credit
    ok(await k.bill(b, b.sup.inter, [k.withItem(b, k.bl(g.grnLine, { unitPrice: '10000' }))]));
    ok(await sale(b, b.cust.local, [{ itemId: b.item.widget, quantity: '10', unitPrice: '1000' }])); // CGST 900 and SGST 900 to pay
    const r = await ret(b, 'gstr3b', 'period=2025-04');
    expect(r.tax_pmt.paid_through_itc).toMatchObject({ igst: '0.0000', cgst: '900.0000', sgst: '900.0000' }); // IGST credit pays CGST then SGST
    expect(r.tax_pmt.itc_unused).toMatchObject({ igst: '16200.0000' });
    expect(r.tax_pmt.payable_in_cash).toMatchObject({ igst: '0.0000', cgst: '0.0000', sgst: '0.0000' });
  });

  it('lists bill lines with the credit each carries', async () => {
    const b = await april('G3 Reg Co');
    const r = await ret(b, 'itc-register', 'period=2025-04');
    expect(r.documents).toHaveLength(5);
    expect(r.documents.map((d: { type: string; itcAvailable: string; itcBlocked: string }) => [d.type, d.itcAvailable, d.itcBlocked])).toEqual([['bill', '900.0000', '0.0000'], ['bill', '900.0000', '0.0000'], ['bill', '900.0000', '0.0000'], ['bill', '0.0000', '900.0000'], ['debit_note', '-270.0000', '0.0000']]);
    expect(r.totals).toEqual({ itcAvailable: '2430.0000', itcBlocked: '900.0000' });
    expect(r.documents[2]).toMatchObject({ reverseCharge: true });
  });
});

describe('composition (CMP-08)', () => {
  it('works out the quarter\'s tax on turnover at the configured rate, plus reverse-charge tax', async () => {
    const b = await k.buyer('Cmp Co');
    ok(await sale(b, b.cust.local, [{ itemId: b.item.widget, quantity: '10', unitPrice: '1000' }], { documentType: 'bill_of_supply' }));
    ok(await sale(b, b.cust.consumer, [{ itemId: b.item.widget, quantity: '5', unitPrice: '1000' }], { documentType: 'bill_of_supply', invoiceDate: '2025-06-20' }));
    ok(await sale(b, b.cust.consumer, [{ itemId: b.item.widget, quantity: '1', unitPrice: '1000' }], { documentType: 'bill_of_supply', invoiceDate: '2025-07-02' })); // next quarter
    const g = await k.ordered(b, b.sup.unreg);
    ok(await k.bill(b, b.sup.unreg, [k.withItem(b, k.bl(g.grnLine))], { reverseCharge: true, supplierStateCode: '27' })); // 5,000 + 450 + 450
    await supers.query("UPDATE erp.gst_registrations SET registration_type = 'composition' WHERE id = $1", [b.regId]);
    const cmp = (q: string) => call(server, 'GET', `/v1/gst/returns/cmp08?registrationId=${b.regId}&quarter=${q}`, { tenant: b.tenant });
    expect((await cmp('2025-Q1')).json.code).toBe('composition_rate_not_set');
    const put = (rate: string | null) => call(server, 'PUT', `/v1/gst/registrations/${b.regId}/return-settings`, { tenant: b.tenant, body: { compositionRate: rate } });
    expect((await put('101')).status).toBe(422);
    expect((await put('0')).status).toBe(422);
    ok(await put('1'), 200);
    expect((await call(server, 'GET', `/v1/gst/registrations/${b.regId}/return-settings`, { tenant: b.tenant })).json).toMatchObject({ registrationType: 'composition', compositionRate: '1.0000' });
    const q1 = (await cmp('2025-Q1')).json;
    expect(q1).toMatchObject({ quarter: '2025-Q1', from: '2025-04-01', to: '2025-06-30' });
    expect(q1.outward).toMatchObject({ turnover: '15000.0000', ratePercent: '1.0000', central: '75.0000', state: '75.0000', integrated: '0.0000', tax: '150.0000' });
    expect(q1.inwardReverseCharge).toMatchObject({ taxable: '5000.0000', central: '450.0000', state: '450.0000' });
    expect(q1.totalPayable).toBe('1050.0000');
    expect((await cmp('2025-Q2')).json.outward).toMatchObject({ turnover: '1000.0000', tax: '10.0000' });
    expect((await cmp('2025-Q4')).json.outward.turnover).toBe('0.0000');
    expect((await cmp('2025-Q9')).status).toBe(422);
    // a composition taxpayer does not file GSTR-1 or 3B
    expect((await call(server, 'GET', `/v1/gst/returns/gstr1?registrationId=${b.regId}&period=2025-04`, { tenant: b.tenant })).json.code).toBe('is_composition');
    expect((await call(server, 'GET', `/v1/gst/returns/gstr3b?registrationId=${b.regId}&period=2025-04`, { tenant: b.tenant })).json.code).toBe('is_composition');
  });

  it('keeps regular and composition apart, validates periods, and enforces rights and isolation', async () => {
    const b = await k.buyer('Cmp Guard Co');
    expect((await call(server, 'GET', `/v1/gst/returns/cmp08?registrationId=${b.regId}&quarter=2025-Q1`, { tenant: b.tenant })).json.code).toBe('not_composition');
    expect((await call(server, 'PUT', `/v1/gst/registrations/${b.regId}/return-settings`, { tenant: b.tenant, body: { compositionRate: '1' } })).json.code).toBe('not_composition');
    expect((await call(server, 'GET', `/v1/gst/returns/gstr1?registrationId=${b.regId}&period=2025-13`, { tenant: b.tenant })).status).toBe(422);
    expect((await call(server, 'GET', `/v1/gst/returns/gstr1?registrationId=${b.regId}&period=April`, { tenant: b.tenant })).status).toBe(422);
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: b.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['gst:read']);
    expect((await call(server, 'GET', `/v1/gst/returns/gstr3b?registrationId=${b.regId}&period=2025-04`, { token: reader })).status).toBe(200);
    expect((await call(server, 'PUT', `/v1/gst/registrations/${b.regId}/return-settings`, { token: reader, body: { compositionRate: null } })).status).toBe(403);
    expect((await call(server, 'GET', `/v1/gst/returns/gstr3b?registrationId=${b.regId}&period=2025-04`, { token: await key(['sales:read']) })).status).toBe(403);
    const other = await k.buyer('Cmp Guard Other');
    expect((await call(server, 'GET', `/v1/gst/returns/gstr3b?registrationId=${b.regId}&period=2025-04`, { tenant: other.tenant })).status).toBe(404);
    expect((await ret(other, 'gstr3b', 'period=2025-04')).tax_pmt.payable_in_cash).toMatchObject({ igst: '0.0000' });
  });
});

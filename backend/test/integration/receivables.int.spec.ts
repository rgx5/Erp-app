import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const shop = async (name: string): Promise<Shop> => {
  const s = await kit.shop(name);
  ok(await call(server, 'PUT', `/v1/companies/${s.companyId}/sales-settings`, { tenant: s.tenant, body: { writeOffAccountId: s.acc['5900'] } }), 200);
  return s;
};
const invoice = (s: Shop, customerId: string, o: { price?: string; date?: string; qty?: string } = {}) =>
  call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: o.date ?? '2025-04-10', customerId, lines: [{ itemId: s.item.service, quantity: o.qty ?? '1', unitPrice: o.price ?? '1000' }] } }); // 18% intra -> 1180
const receipt = (s: Shop, customerId: string, amount: string, o: { date?: string; allocations?: object[]; method?: string; account?: string } = {}) =>
  call(server, 'POST', '/v1/receivables/receipts', { tenant: s.tenant, body: { companyId: s.companyId, customerId, receiptDate: o.date ?? '2025-04-12', amount, method: o.method ?? 'bank_transfer', depositAccountId: o.account ?? s.acc['1120'], ...(o.allocations ? { allocations: o.allocations } : {}) } });
const allocate = (s: Shop, source: { type: string; id: string }, allocations: object[], allocatedOn = '2025-04-15') => call(server, 'POST', '/v1/receivables/allocations', { tenant: s.tenant, body: { source, allocatedOn, allocations } });
const position = async (s: Shop, customerId: string, asOf = '2025-12-31') => (await call(server, 'GET', `/v1/receivables/customers/${customerId}/position?companyId=${s.companyId}&asOf=${asOf}`, { tenant: s.tenant })).json;
const recon = async (s: Shop, asOf = '2026-03-31') => (await call(server, 'GET', `/v1/receivables/reconciliation?companyId=${s.companyId}&asOf=${asOf}`, { tenant: s.tenant })).json;
const journalOf = async (entryId: string) => (await supers.query('SELECT a.code, l.debit::text AS dr, l.credit::text AS cr, l.party_id FROM erp.journal_lines l JOIN erp.accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY a.code', [entryId])).rows as { code: string; dr: string; cr: string; party_id: string | null }[];

describe('receipts and allocation', () => {
  it('posts the money to the bank and the receivable, and settles invoices', async () => {
    const s = await shop('Receipt Co');
    const inv = ok(await invoice(s, s.cust.local)); // 1180
    const r = ok(await receipt(s, s.cust.local, '1000', { allocations: [{ invoiceId: inv.id, amount: '1000' }] }));
    expect(r).toMatchObject({ receiptNo: 'RCT/2526/000001', status: 'posted', amount: '1000.0000', method: 'bank_transfer', unallocated: '0.0000' });
    expect(r.allocations).toHaveLength(1);
    expect(await journalOf(r.journalEntryId)).toEqual([{ code: '1120', dr: '1000.0000', cr: '0.0000', party_id: null }, { code: '1130', dr: '0.0000', cr: '1000.0000', party_id: s.cust.local }]);
    const p = await position(s, s.cust.local);
    expect(p.openInvoices).toEqual([expect.objectContaining({ id: inv.id, total: '1180.0000', outstanding: '180.0000' })]);
    expect(p).toMatchObject({ totalOutstanding: '180.0000', totalUnapplied: '0.0000', balance: '180.0000' });
    expect((await recon(s)).reconciled).toBe(true);
    expect((await call(server, 'GET', `/v1/receivables/receipts/${r.id}`, { tenant: s.tenant })).json.allocations).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('tenantId');
  });
  it('keeps unallocated money on account as an advance, and allocates it later within the limits', async () => {
    const s = await shop('Advance Co');
    const r = ok(await receipt(s, s.cust.local, '2000'));
    expect(r.unallocated).toBe('2000.0000');
    expect(await position(s, s.cust.local)).toMatchObject({ totalOutstanding: '0.0000', totalUnapplied: '2000.0000', balance: '-2000.0000', unapplied: [expect.objectContaining({ kind: 'receipt', amount: '2000.0000' })] });
    const a = ok(await invoice(s, s.cust.local));
    const b = ok(await invoice(s, s.cust.local, { price: '500' })); // 590
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: a.id, amount: '1180.01' }])).json.code).toBe('exceeds_outstanding');
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: a.id, amount: '1180' }, { invoiceId: b.id, amount: '590' }, { invoiceId: b.id, amount: '0.01' }])).json.code).toBe('exceeds_outstanding'); // repeated invoices add up
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: a.id, amount: '1180' }, { invoiceId: b.id, amount: '590' }], '2025-04-05')).status).toBe(422); // before the invoice/receipt dates
    const done = await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: a.id, amount: '1180' }, { invoiceId: b.id, amount: '590' }]);
    expect(done.status).toBe(201);
    expect(done.json.items).toHaveLength(2);
    expect((await call(server, 'GET', `/v1/receivables/receipts/${r.id}`, { tenant: s.tenant })).json.unallocated).toBe('230.0000');
    const c = ok(await invoice(s, s.cust.local, { price: '1000' }));
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: c.id, amount: '231' }])).json.code).toBe('exceeds_available');
    ok(await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: c.id, amount: '230' }]));
    expect(await position(s, s.cust.local)).toMatchObject({ totalOutstanding: '950.0000', totalUnapplied: '0.0000', balance: '950.0000' });
    expect((await recon(s)).reconciled).toBe(true);
  });
  it('refuses another customer\'s invoice, credit notes as targets, cancelled invoices, and unknown things', async () => {
    const s = await shop('Allocate Rules Co');
    const r = ok(await receipt(s, s.cust.local, '5000'));
    const mine = ok(await invoice(s, s.cust.local));
    const theirs = ok(await invoice(s, s.cust.other));
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: theirs.id, amount: '100' }])).status).toBe(422);
    const cn = ok(await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: mine.id, noteDate: '2025-04-11', reason: 'x', lines: [{ originalLineId: mine.lines[0].id, quantity: '1', unitPrice: '100' }] } }));
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: cn.id, amount: '10' }])).json.code).toBe('not_settleable');
    const gone = ok(await invoice(s, s.cust.local, { price: '10' }));
    ok(await call(server, 'POST', `/v1/sales/invoices/${gone.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-12', reason: 'x' } }), 200);
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: gone.id, amount: '1' }])).json.code).toBe('invoice_cancelled');
    expect((await allocate(s, { type: 'receipt', id: '01a1cf33-1a44-7104-863e-b26a759d6544' }, [{ invoiceId: mine.id, amount: '1' }])).status).toBe(404);
    expect((await allocate(s, { type: 'credit_note', id: mine.id }, [{ invoiceId: mine.id, amount: '1' }])).json.code).toBe('not_a_credit_note');
    expect((await receipt(s, s.cust.local, '10', { account: s.acc['1130'] })).status).toBe(422); // the receivables control account is not a bank
    expect((await receipt(s, s.cust.local, '10', { account: s.acc['5900'] })).status).toBe(422);
    expect((await receipt(s, s.cust.local, '0')).status).toBe(422);
  });
  it('settles an invoice from a credit note', async () => {
    const s = await shop('Credit Settle Co');
    const inv = ok(await invoice(s, s.cust.local)); // 1180
    const cn = ok(await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-04-11', reason: 'Discount', lines: [{ originalLineId: inv.lines[0].id, quantity: '1', unitPrice: '500' }] } })); // 590
    expect((await position(s, s.cust.local)).unapplied).toEqual([expect.objectContaining({ kind: 'credit_note', number: cn.invoiceNo, amount: '590.0000' })]);
    ok(await allocate(s, { type: 'credit_note', id: cn.id }, [{ invoiceId: inv.id, amount: '590' }]));
    expect(await position(s, s.cust.local)).toMatchObject({ totalOutstanding: '590.0000', totalUnapplied: '0.0000', balance: '590.0000' });
    ok(await receipt(s, s.cust.local, '590', { allocations: [{ invoiceId: inv.id, amount: '590' }] }));
    expect((await position(s, s.cust.local)).openInvoices).toEqual([]);
    expect((await recon(s)).reconciled).toBe(true);
  });
});

describe('write-offs, reversals and cancellation', () => {
  it('writes off a small difference to the configured account, finally', async () => {
    const s = await shop('Writeoff Co');
    const inv = ok(await invoice(s, s.cust.local));
    ok(await receipt(s, s.cust.local, '1179.5', { allocations: [{ invoiceId: inv.id, amount: '1179.5' }] }));
    const wo = ok(await call(server, 'POST', '/v1/receivables/write-offs', { tenant: s.tenant, body: { invoiceId: inv.id, amount: '0.5', date: '2025-04-20', reason: 'Rounding discount' } }));
    expect(wo).toMatchObject({ amount: '0.5000', reason: 'Rounding discount', invoiceId: inv.id });
    expect(await journalOf(wo.writeOffEntryId)).toEqual([{ code: '1130', dr: '0.0000', cr: '0.5000', party_id: s.cust.local }, { code: '5900', dr: '0.5000', cr: '0.0000', party_id: null }]);
    expect((await position(s, s.cust.local)).openInvoices).toEqual([]);
    expect((await call(server, 'POST', `/v1/receivables/allocations/${wo.id}/reverse`, { tenant: s.tenant, body: { on: '2025-04-21', reason: 'x' } })).json.code).toBe('write_off_final');
    expect((await call(server, 'POST', '/v1/receivables/write-offs', { tenant: s.tenant, body: { invoiceId: inv.id, amount: '1', date: '2025-04-21', reason: 'x' } })).json.code).toBe('exceeds_outstanding');
    expect((await recon(s)).reconciled).toBe(true);
    await expect(supers.query("UPDATE erp.receivable_allocations SET reversed_on = '2025-05-01', reversed_at = now() WHERE id = $1", [wo.id])).rejects.toMatchObject({ code: '55000' });
    const bare = await kit.shop('No Writeoff Acct Co');
    const i2 = ok(await invoice(bare, bare.cust.local));
    expect((await call(server, 'POST', '/v1/receivables/write-offs', { tenant: bare.tenant, body: { invoiceId: i2.id, amount: '1', date: '2025-04-20', reason: 'x' } })).json.code).toBe('sales_accounts_not_configured');
  });
  it('reverses an allocation, and history as of an earlier date still shows it settled', async () => {
    const s = await shop('Reverse Alloc Co');
    const inv = ok(await invoice(s, s.cust.local));
    const r = ok(await receipt(s, s.cust.local, '1180', { allocations: [{ invoiceId: inv.id, amount: '1180' }] }));
    const alloc = r.allocations[0];
    ok(await call(server, 'POST', `/v1/receivables/allocations/${alloc.id}/reverse`, { tenant: s.tenant, body: { on: '2025-06-01', reason: 'Applied to wrong invoice' } }), 200);
    expect((await call(server, 'POST', `/v1/receivables/allocations/${alloc.id}/reverse`, { tenant: s.tenant, body: { on: '2025-06-02', reason: 'again' } })).json.code).toBe('already_reversed');
    expect((await position(s, s.cust.local, '2025-05-15')).openInvoices).toEqual([]); // as it stood in May: settled
    expect((await position(s, s.cust.local, '2025-06-01')).openInvoices).toHaveLength(1); // after the reversal: open again
    expect((await position(s, s.cust.local)).unapplied).toEqual([expect.objectContaining({ kind: 'receipt', amount: '1180.0000' })]);
    expect((await recon(s)).reconciled).toBe(true);
  });
  it('cancels a receipt: reverses the books and releases what it settled', async () => {
    const s = await shop('Cancel Receipt Co');
    const inv = ok(await invoice(s, s.cust.local));
    const r = ok(await receipt(s, s.cust.local, '1180', { allocations: [{ invoiceId: inv.id, amount: '1180' }] }));
    const c = ok(await call(server, 'POST', `/v1/receivables/receipts/${r.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-20', reason: 'Cheque bounced' } }), 200);
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'Cheque bounced', unallocated: '0.0000' });
    expect((await position(s, s.cust.local)).openInvoices).toEqual([expect.objectContaining({ outstanding: '1180.0000' })]);
    expect((await position(s, s.cust.local, '2025-04-15')).openInvoices).toEqual([]); // before the bounce it was settled
    expect((await recon(s)).reconciled).toBe(true);
    expect((await recon(s, '2025-04-15')).reconciled).toBe(true);
    expect((await call(server, 'POST', `/v1/receivables/receipts/${r.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-21', reason: 'again' } })).json.code).toBe('already_cancelled');
    expect((await allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: inv.id, amount: '10' }])).json.code).toBe('receipt_cancelled');
    const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant })).json;
    expect(t.balanced).toBe(true);
    expect(t.rows.find((x: { code: string }) => x.code === '1120')).toMatchObject({ closingDebit: '0.0000', closingCredit: '0.0000' });
    // period lock rolls the cancellation back completely
    const r2 = ok(await receipt(s, s.cust.local, '100', { date: '2025-05-05' }));
    ok(await call(server, 'POST', `/v1/accounting-periods/${s.periods.find((p) => p.name === 'Apr 2025')?.id}/close`, { tenant: s.tenant }), 200);
    ok(await call(server, 'POST', `/v1/accounting-periods/${s.periods.find((p) => p.name === 'May 2025')?.id}/close`, { tenant: s.tenant }), 200);
    expect((await call(server, 'POST', `/v1/receivables/receipts/${r2.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-05-20', reason: 'x' } })).json.code).toBe('period_closed');
    expect((await call(server, 'GET', `/v1/receivables/receipts/${r2.id}`, { tenant: s.tenant })).json.status).toBe('posted');
  });
  it('will not cancel an invoice that has money allocated to it', async () => {
    const s = await shop('Settled Cancel Co');
    const inv = ok(await invoice(s, s.cust.local));
    const r = ok(await receipt(s, s.cust.local, '100', { allocations: [{ invoiceId: inv.id, amount: '100' }] }));
    const cancel = () => call(server, 'POST', `/v1/sales/invoices/${inv.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-20', reason: 'x' } });
    expect((await cancel()).json.code).toBe('has_settlements');
    ok(await call(server, 'POST', `/v1/receivables/allocations/${r.allocations[0].id}/reverse`, { tenant: s.tenant, body: { on: '2025-04-19', reason: 'x' } }), 200);
    ok(await cancel(), 200);
    expect((await recon(s)).reconciled).toBe(true);
  });
});

describe('ageing, statement and reconciliation', () => {
  it('buckets open invoices by days past due, using the customer\'s payment terms', async () => {
    const s = await shop('Ageing Co');
    const term = ok(await call(server, 'POST', '/v1/payment-terms', { tenant: s.tenant, body: { code: 'NET30', name: 'Net 30', netDays: 30 } })).id as string;
    const cust = ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: 'AGE-1', legalName: 'Ageing Customer', isCustomer: true, gstTreatment: 'consumer', paymentTermsId: term } })).id as string;
    const a = ok(await invoice(s, cust, { date: '2025-04-01' })); // due 2025-05-01
    ok(await invoice(s, cust, { date: '2025-05-20' })); // due 2025-06-19
    ok(await invoice(s, cust, { date: '2025-06-25' })); // due 2025-07-25
    expect(a.dueDate).toBe('2025-05-01');
    const other = ok(await invoice(s, s.cust.local, { date: '2025-04-01' })); // no terms: due on the invoice date
    expect(other.dueDate).toBe('2025-04-01');
    ok(await receipt(s, s.cust.local, '300', { date: '2025-07-01' })); // unapplied advance
    const age = (await call(server, 'GET', `/v1/receivables/ageing?companyId=${s.companyId}&asOf=2025-07-15`, { tenant: s.tenant })).json;
    const mine = age.customers.find((c: { customerId: string }) => c.customerId === cust);
    expect(mine).toMatchObject({ current: '1180.0000', days1to30: '1180.0000', days31to60: '0.0000', days61to90: '1180.0000', over90: '0.0000', total: '3540.0000' });
    const local = age.customers.find((c: { customerId: string }) => c.customerId === s.cust.local);
    expect(local).toMatchObject({ over90: '1180.0000', unapplied: '300.0000' }); // due 04-01, 105 days past due on 07-15
    expect(age.totals.total).toBe('4720.0000');
    expect(age.totals.unapplied).toBe('300.0000');
    const earlier = (await call(server, 'GET', `/v1/receivables/ageing?companyId=${s.companyId}&asOf=2025-05-10`, { tenant: s.tenant })).json;
    expect(earlier.customers.find((c: { customerId: string }) => c.customerId === cust)).toMatchObject({ days1to30: '1180.0000', current: '0.0000' }); // the later invoices did not exist yet
  });
  it('prints a statement with opening balance, running balance and cancellations', async () => {
    const s = await shop('Statement Co');
    const a = ok(await invoice(s, s.cust.local, { date: '2025-04-05' }));
    ok(await receipt(s, s.cust.local, '500', { date: '2025-04-20', allocations: [{ invoiceId: a.id, amount: '500' }] }));
    const b = ok(await invoice(s, s.cust.local, { date: '2025-05-10', price: '100' })); // 118
    ok(await call(server, 'POST', `/v1/sales/invoices/${b.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-05-12', reason: 'x' } }), 200);
    const st = (await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/statement?companyId=${s.companyId}&from=2025-05-01&to=2025-05-31`, { tenant: s.tenant })).json;
    expect(st).toMatchObject({ openingBalance: '680.0000', closingBalance: '680.0000' });
    expect(st.lines.map((l: { kind: string; balance: string }) => [l.kind, l.balance])).toEqual([['tax_invoice', '798.0000'], ['cancellation', '680.0000']]);
    const all = (await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/statement?companyId=${s.companyId}&from=2025-04-01&to=2025-05-31`, { tenant: s.tenant })).json;
    expect(all.openingBalance).toBe('0.0000');
    expect(all.lines.map((l: { kind: string }) => l.kind)).toEqual(['tax_invoice', 'receipt', 'tax_invoice', 'cancellation']);
    expect((await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/statement?companyId=${s.companyId}&from=2025-06-01&to=2025-05-01`, { tenant: s.tenant })).status).toBe(422);
  });
  it('reconciles documents to the ledger customer by customer through a mixed history, as of any date', async () => {
    const s = await shop('Recon Co');
    const a = ok(await invoice(s, s.cust.local, { date: '2025-04-05' }));
    const b = ok(await invoice(s, s.cust.other, { date: '2025-04-06', price: '2000' }));
    const r = ok(await receipt(s, s.cust.local, '2000', { date: '2025-04-10', allocations: [{ invoiceId: a.id, amount: '1180' }] }));
    ok(await call(server, 'POST', '/v1/receivables/write-offs', { tenant: s.tenant, body: { invoiceId: b.id, amount: '10', date: '2025-04-11', reason: 'x' } }));
    ok(await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: b.id, noteDate: '2025-04-12', reason: 'r', lines: [{ originalLineId: b.lines[0].id, quantity: '1', unitPrice: '100' }] } }));
    ok(await call(server, 'POST', `/v1/receivables/receipts/${r.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-20', reason: 'x' } }), 200);
    for (const asOf of ['2025-04-05', '2025-04-10', '2025-04-15', '2025-04-20', '2026-03-31']) {
      const res = await recon(s, asOf);
      expect(res.reconciled, `as of ${asOf}: ${JSON.stringify(res.rows)}`).toBe(true);
    }
    const final = await recon(s);
    expect(final.rows).toHaveLength(2);
    expect(final).toMatchObject({ documentsTotal: '3412.0000', ledgerTotal: '3412.0000', difference: '0.0000' }); // 1180 + 2360 - 118 - 10 (the receipt was cancelled)
  });
});

describe('integrity under concurrency and at the database', () => {
  it('never settles more than a receipt holds or an invoice is worth', async () => {
    const s = await shop('Race Receipt Co');
    const inv = ok(await invoice(s, s.cust.local, { price: '10000' })); // 11800
    const r = ok(await receipt(s, s.cust.local, '500'));
    const results = await Promise.all(Array.from({ length: 10 }, () => allocate(s, { type: 'receipt', id: r.id }, [{ invoiceId: inv.id, amount: '100' }])));
    expect(results.filter((x) => x.status === 201)).toHaveLength(5);
    expect(results.filter((x) => x.status !== 201).every((x) => x.json.code === 'exceeds_available')).toBe(true);
    const small = ok(await invoice(s, s.cust.local, { price: '100' })); // 118
    const r1 = ok(await receipt(s, s.cust.local, '100'));
    const r2 = ok(await receipt(s, s.cust.local, '100'));
    const both = await Promise.all([r1, r2].map((x) => allocate(s, { type: 'receipt', id: x.id }, [{ invoiceId: small.id, amount: '100' }])));
    expect(both.filter((x) => x.status === 201)).toHaveLength(1); // 118 cannot absorb 200
    expect((await recon(s)).reconciled).toBe(true);
  });
  it('is protected by the database even against raw SQL', async () => {
    const s = await shop('Guard Recv Co');
    const inv = ok(await invoice(s, s.cust.local));
    const r = ok(await receipt(s, s.cust.local, '500', { allocations: [{ invoiceId: inv.id, amount: '400' }] }));
    for (const sql of ["UPDATE erp.customer_receipts SET amount = 1 WHERE id = $1", 'DELETE FROM erp.customer_receipts WHERE id = $1']) await expect(supers.query(sql, [r.id]), sql).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('DELETE FROM erp.receivable_allocations WHERE receipt_id = $1', [r.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('UPDATE erp.receivable_allocations SET amount = 1 WHERE receipt_id = $1', [r.id])).rejects.toMatchObject({ code: '55000' });
    const client = await supers.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO erp.receivable_allocations (tenant_id, id, company_id, customer_id, invoice_id, receipt_id, amount, allocated_on) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 200, $6)', [s.tenant, s.companyId, s.cust.local, inv.id, r.id, '2025-04-20']);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' }); // 600 > the receipt's 500
      await client.query('ROLLBACK').catch(() => undefined);
      await expect(client.query('INSERT INTO erp.receivable_allocations (tenant_id, id, company_id, customer_id, invoice_id, receipt_id, credit_note_id, amount, allocated_on) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $4, 1, $6)', [s.tenant, s.companyId, s.cust.local, inv.id, r.id, '2025-04-20'])).rejects.toMatchObject({ code: '23514' }); // two sources
    } finally { client.release(); }
  });
  it('lowers a customer\'s credit exposure when they pay', async () => {
    const s = await shop('Exposure Co');
    const limited = ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: 'LIM', legalName: 'Limited', isCustomer: true, gstTreatment: 'consumer', creditLimit: '1500' } })).id as string;
    ok(await invoice(s, limited));
    ok(await receipt(s, limited, '1180'));
    expect((await invoice(s, limited)).json.warnings).toBeUndefined();
    expect((await invoice(s, limited)).json.warnings[0].code).toBe('credit_limit_exceeded');
    expect(await position(s, limited)).toMatchObject({ creditLimitExceeded: true });
  });
  it('separates reading, receiving and writing off, and keeps tenants apart', async () => {
    const s = await shop('Recv Access Co');
    const inv = ok(await invoice(s, s.cust.local));
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: s.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['receivables:read']);
    expect((await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/position?companyId=${s.companyId}&asOf=2025-12-31`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/receivables/receipts', { token: reader, body: {} })).status).toBe(403);
    const clerk = await key(['receivables:post']);
    expect((await call(server, 'POST', '/v1/receivables/write-offs', { token: clerk, body: { invoiceId: inv.id, amount: '1', date: '2025-04-20', reason: 'x' } })).status).toBe(403);
    const other = await shop('Recv Other Co');
    expect((await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/position?companyId=${s.companyId}&asOf=2025-12-31`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/receivables/receipts?companyId=${s.companyId}`, { tenant: other.tenant })).json.items).toEqual([]);
  });
});

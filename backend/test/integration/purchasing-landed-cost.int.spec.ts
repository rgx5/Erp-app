import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { buyerKit, type Buyer } from '../support/buyer.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof buyerKit>;
beforeAll(async () => { server = await startServer(); k = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

let seq = 0;
const recon = async (b: Buyer) => (await call(server, 'GET', `/v1/inventory/reconciliation?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json;
/** The charges are normally booked as expenses first (a freight bill); the voucher relieves these accounts. */
const charges = (b: Buyer, freight = '400', duty = '200') => [
  { kind: 'freight', amount: freight, accountId: b.acc['5900'] },
  ...(duty === '0' ? [] : [{ kind: 'customs_duty', description: 'BCD', amount: duty, accountId: b.acc['5230'] }]),
];
const voucher = (b: Buyer, receiptLines: string[], o: object = {}) =>
  call(server, 'POST', '/v1/purchasing/landed-costs', { tenant: b.tenant, body: { companyId: b.companyId, voucherDate: '2025-04-18', description: 'Container 7', charges: charges(b), receiptLines, ...o } });
const cheapOrdered = async (b: Buyer, quantity = '20') => k.ordered(b, b.sup.intra, { itemId: b.item.cheap, quantity, price: '100' });
const issue = (b: Buyer, itemId: string, quantity: string) => call(server, 'POST', '/v1/stock/movements', { tenant: b.tenant, body: { companyId: b.companyId, movementType: 'issue', postingDate: '2025-04-17', description: 'Use', offsetAccountId: b.acc['5100'], lines: [{ warehouseId: b.wh, itemId, quantity }] } });

describe('allocation and capitalisation', () => {
  it('shares the charges over receipt lines by value, adds them to the stock, and relieves the charge accounts', async () => {
    const b = await k.buyer('Lc Value Co');
    const a = await k.ordered(b, b.sup.intra); // widget 10 x 500 = 5,000
    const c = await cheapOrdered(b); // cheap 20 x 100 = 2,000
    const stock = await k.net(b, '1240');
    const r = ok(await voucher(b, [a.grnLine, c.grnLine]));
    expect(r).toMatchObject({ voucherNo: 'LC/2526/000001', basis: 'value', totalAmount: '600.0000', status: 'posted' });
    expect(r.charges).toHaveLength(2);
    // 600 over 5,000 : 2,000, to the last unit of money
    expect(r.lines.map((l: { allocated: string }) => l.allocated)).toEqual(['428.5714', '171.4286']);
    expect(r.lines.every((l: { capitalised: string; expensed: string; allocated: string }) => l.capitalised === l.allocated && l.expensed === '0.0000')).toBe(true);
    expect(await k.net(b, '1240') - stock).toBeCloseTo(600, 4);
    expect(await k.net(b, '5900')).toBe(-400);
    expect(await k.net(b, '5230')).toBe(-200);
    expect(await k.net(b, '5220')).toBe(0); // the clearing account nets to nothing
    expect(await k.net(b, '5300')).toBe(0);
    expect(await recon(b)).toMatchObject({ reconciled: true });
    expect((await call(server, 'GET', `/v1/purchasing/landed-costs/${r.id}`, { tenant: b.tenant })).json.lines).toHaveLength(2);
    expect((await call(server, 'GET', `/v1/purchasing/landed-costs?companyId=${b.companyId}`, { tenant: b.tenant })).json.items).toHaveLength(1);
  });

  it('can share by quantity instead', async () => {
    const b = await k.buyer('Lc Qty Co');
    const a = await k.ordered(b, b.sup.intra);
    const c = await cheapOrdered(b);
    const r = ok(await voucher(b, [a.grnLine, c.grnLine], { basis: 'quantity' })); // 10 : 20 units
    expect(r.lines.map((l: { allocated: string }) => l.allocated)).toEqual(['200.0000', '400.0000']);
    expect(await recon(b)).toMatchObject({ reconciled: true });
  });

  it('raises the weighted average, so later issues carry the cost', async () => {
    const b = await k.buyer('Lc Wac Co');
    const a = await k.ordered(b, b.sup.intra, { quantity: '10', price: '500' }); // 100 opening at 400, then 10 at 500
    ok(await voucher(b, [a.grnLine], { charges: [{ kind: 'freight', amount: '110', accountId: b.acc['5900'] }] }));
    const out = ok(await issue(b, b.item.widget, '10'));
    // 110 units worth 40,000 + 5,000 + 110 = 45,110: average 410.0909..., so 10 units leave at 4,100.9091
    expect(JSON.stringify(out)).toContain('4100.9091');
    expect(await recon(b)).toMatchObject({ reconciled: true });
  });

  it('takes the cost onto the receipt\'s own FIFO layer', async () => {
    const b = await k.buyer('Lc Fifo Co');
    const nos = ((await call(server, 'GET', '/v1/units?limit=200', { tenant: b.tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === 'NOS')?.id as string;
    const fifo = ok(await call(server, 'POST', '/v1/items', { tenant: b.tenant, body: { code: `LCF-${++seq}`, name: 'Fifo', baseUomId: nos, itemType: 'finished_good', costingMethod: 'fifo', taxCodeId: b.tax.gst18, hsnSacCode: '8479' } })).id as string;
    const first = await k.ordered(b, b.sup.intra, { itemId: fifo, quantity: '10', price: '100' });
    await k.ordered(b, b.sup.intra, { itemId: fifo, quantity: '10', price: '120' });
    ok(await voucher(b, [first.grnLine], { charges: [{ kind: 'insurance', amount: '100', accountId: b.acc['5900'] }] })); // 10 a unit on the first layer only
    const out = ok(await issue(b, fifo, '10'));
    expect(JSON.stringify(out)).toContain('1100.0000'); // the first layer: 10 x 110
    expect(await recon(b)).toMatchObject({ reconciled: true });
  });

  it('puts the share for units already used into cost variance, not into stock', async () => {
    const b = await k.buyer('Lc Used Co');
    const a = await k.ordered(b, b.sup.intra); // 10 received on top of 100
    ok(await issue(b, b.item.widget, '105')); // only 5 left
    const r = ok(await voucher(b, [a.grnLine], { charges: [{ kind: 'freight', amount: '100', accountId: b.acc['5900'] }] }));
    expect(r.lines[0]).toMatchObject({ allocated: '100.0000', capitalised: '50.0000', expensed: '50.0000' });
    expect(await k.net(b, '5300')).toBe(50);
    expect(await k.net(b, '5900')).toBe(-100);
    expect(await recon(b)).toMatchObject({ reconciled: true });
  });

  it('survives simultaneous vouchers on the same receipt without deadlock or loss', async () => {
    const b = await k.buyer('Lc Race Co');
    const a = await k.ordered(b, b.sup.intra);
    const c = await cheapOrdered(b);
    const stock = await k.net(b, '1240');
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => voucher(b, n % 2 ? [a.grnLine, c.grnLine] : [c.grnLine, a.grnLine], { charges: [{ kind: 'handling', amount: '70', accountId: b.acc['5900'] }] })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await k.net(b, '1240') - stock).toBeCloseTo(350, 4);
    expect(await recon(b)).toMatchObject({ reconciled: true });
    expect(new Set(results.map((r) => r.json.voucherNo)).size).toBe(5);
  });
});

describe('cancellation', () => {
  it('takes the cost back out and puts the charges back, as of the date', async () => {
    const b = await k.buyer('Lc Cancel Co');
    const a = await k.ordered(b, b.sup.intra);
    const stock = await k.net(b, '1240');
    const r = ok(await voucher(b, [a.grnLine]));
    const c = ok(await call(server, 'POST', `/v1/purchasing/landed-costs/${r.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-25', reason: 'Wrong container' } }), 200);
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong container', cancelJournalEntryId: expect.any(String) });
    expect(await k.net(b, '1240') - stock).toBeCloseTo(0, 4);
    expect(await k.net(b, '5900')).toBe(0);
    expect(await k.net(b, '5230')).toBe(0);
    expect(await k.net(b, '5220')).toBe(0);
    expect(await recon(b)).toMatchObject({ reconciled: true });
    expect((await call(server, 'POST', `/v1/purchasing/landed-costs/${r.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-26', reason: 'again' } })).json.code).toBe('already_cancelled');
    expect((await call(server, 'POST', `/v1/purchasing/landed-costs/${r.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-01', reason: 'x' } })).status).toBeGreaterThanOrEqual(409);
    // the receipt line can take a fresh voucher
    ok(await voucher(b, [a.grnLine]));
    expect(await recon(b)).toMatchObject({ reconciled: true });
  });
});

describe('validation and posting controls', () => {
  it('refuses what cannot be capitalised, leaving no trace', async () => {
    const b = await k.buyer('Lc Bad Co');
    const a = await k.ordered(b, b.sup.intra);
    const other = await k.buyer('Lc Bad Other');
    const stranger = await k.ordered(other, other.sup.intra);
    expect((await voucher(b, [a.grnLine], { charges: [{ kind: 'freight', amount: '10', accountId: b.acc['1210'] }] })).status).toBe(422); // a control (inventory) account
    expect((await voucher(b, [a.grnLine], { charges: [{ kind: 'freight', amount: '10', accountId: b.acc['4100'] }] })).status).toBe(422); // income
    expect((await voucher(b, [a.grnLine], { charges: [{ kind: 'freight', amount: '10', accountId: b.acc['5220'] }] })).status).toBe(422); // the clearing account itself
    expect((await voucher(b, [a.grnLine, a.grnLine])).status).toBe(422);
    expect((await voucher(b, [stranger.grnLine])).status).toBe(422); // another tenant's line is invisible
    expect((await voucher(b, [a.grnLine], { charges: [] })).status).toBe(422);
    expect((await voucher(b, [a.grnLine], { charges: [{ kind: 'freight', amount: '0', accountId: b.acc['5900'] }] })).status).toBe(422);
    expect((await voucher(b, [a.grnLine], { voucherDate: '2027-01-01' })).json.code).toBe('no_accounting_period');
    // a fully returned line has nothing to add cost to
    const returned = await k.ordered(b, b.sup.intra);
    ok(await call(server, 'POST', `/v1/purchasing/receipts/${returned.receipt.id}/return`, { tenant: b.tenant, body: { returnDate: '2025-04-14', reason: 'All wrong', lines: [{ receiptLineId: returned.grnLine, quantity: '10' }] } }));
    expect((await voucher(b, [returned.grnLine])).json.code).toBe('nothing_received');
    expect(await recon(b)).toMatchObject({ reconciled: true });
    expect(ok(await voucher(b, [a.grnLine])).voucherNo).toBe('LC/2526/000001'); // failures burnt no number
  });

  it('says exactly which accounts are missing', async () => {
    const b = await k.buyer('Lc Cfg Co', { freightAccountId: null });
    const a = await k.ordered(b, b.sup.intra);
    const r = await voucher(b, [a.grnLine]);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'purchasing_accounts_not_configured', missing: ['freightAccountId'] });
  });

  it('keeps vouchers out of closed periods', async () => {
    const b = await k.buyer('Lc Locked Co');
    const a = await k.ordered(b, b.sup.intra);
    for (const n of ['Apr 2025', 'May 2025']) ok(await call(server, 'POST', `/v1/accounting-periods/${b.periods.find((p) => p.name === n)?.id}/close`, { tenant: b.tenant }), 200);
    expect((await voucher(b, [a.grnLine], { voucherDate: '2025-05-20' })).json.code).toBe('period_closed');
    expect(await recon(b)).toMatchObject({ reconciled: true });
  });
});

describe('guards and access', () => {
  it('keeps vouchers immutable and checks that the charges add up at commit', async () => {
    const b = await k.buyer('Lc Guard Co');
    const a = await k.ordered(b, b.sup.intra);
    const r = ok(await voucher(b, [a.grnLine]));
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad('UPDATE erp.landed_cost_vouchers SET total_amount = 1 WHERE id = $1', [r.id]);
    await bad('DELETE FROM erp.landed_cost_vouchers WHERE id = $1', [r.id]);
    await bad('UPDATE erp.landed_cost_charges SET amount = 1 WHERE voucher_id = $1', [r.id]);
    await bad('UPDATE erp.landed_cost_lines SET allocated = 1 WHERE voucher_id = $1', [r.id]);
    const client = await supers.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO erp.landed_cost_vouchers (tenant_id, id, company_id, voucher_no, voucher_date, description, basis, total_amount, journal_entry_id) SELECT tenant_id, gen_random_uuid(), company_id, 'RAW/1', voucher_date, 'raw', 'value', 100, journal_entry_id FROM erp.landed_cost_vouchers WHERE id = $1", [r.id]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' }); // no charges or lines
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
  });

  it('separates posting from cancelling, and keeps tenants apart', async () => {
    const b = await k.buyer('Lc Access Co');
    const a = await k.ordered(b, b.sup.intra);
    const r = ok(await voucher(b, [a.grnLine]));
    const reader = await k.key(b, ['purchasing:read']);
    expect((await call(server, 'GET', `/v1/purchasing/landed-costs/${r.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/purchasing/landed-costs', { token: reader, body: {} })).status).toBe(403);
    const poster = await k.key(b, ['purchasing:post']);
    expect((await call(server, 'POST', `/v1/purchasing/landed-costs/${r.id}/cancel`, { token: poster, body: { cancelDate: '2025-04-25', reason: 'x' } })).status).toBe(403);
    const other = await k.buyer('Lc Access Other');
    expect((await call(server, 'GET', `/v1/purchasing/landed-costs/${r.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'POST', `/v1/purchasing/landed-costs/${r.id}/cancel`, { tenant: other.tenant, body: { cancelDate: '2025-04-25', reason: 'x' } })).status).toBe(404);
  });
});

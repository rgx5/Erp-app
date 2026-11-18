import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const tb = async (s: { tenant: string; companyId: string }) => (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant })).json;
const bal = (t: { rows: { accountId: string; debit: string; credit: string }[] }, id: string) => { const r = t.rows.find((x) => x.accountId === id); return r ? Number(r.debit) - Number(r.credit) : 0; };

describe('expense vouchers', () => {
  it('books Dr expense / Cr cash, numbers the voucher, and reverses it on cancel', async () => {
    const s = await kit.shop('Exp Co');
    const cat = ok(await call(server, 'POST', '/v1/expenses/categories', { tenant: s.tenant, body: { companyId: s.companyId, code: 'tea', name: 'Tea and snacks', expenseAccountId: s.acc['5900'] } }));
    const v = ok(await call(server, 'POST', '/v1/expenses/vouchers', { tenant: s.tenant, body: { companyId: s.companyId, voucherDate: '2025-06-10', categoryId: cat.id, amount: '250.50', paidFromAccountId: s.acc['1110'], payee: 'Raju tea stall', note: 'Morning tea' } }));
    expect(v).toMatchObject({ voucherNo: 'EXP/2526/000001', status: 'posted', amount: '250.5000' });
    const t = await tb(s);
    expect(bal(t, s.acc['5900'] as string)).toBeCloseTo(250.5);
    expect(bal(t, s.acc['1110'] as string)).toBeCloseTo(-250.5);
    const second = ok(await call(server, 'POST', '/v1/expenses/vouchers', { tenant: s.tenant, body: { companyId: s.companyId, voucherDate: '2025-06-11', categoryId: cat.id, amount: '100', paidFromAccountId: s.acc['1110'] } }));
    expect(second.voucherNo).toBe('EXP/2526/000002');

    const list = ok(await call(server, 'GET', `/v1/expenses/vouchers?companyId=${s.companyId}`, { tenant: s.tenant }), 200);
    expect(list.items.map((x: { voucherNo: string }) => x.voucherNo)).toEqual(['EXP/2526/000002', 'EXP/2526/000001']); // newest first

    const cancelled = ok(await call(server, 'POST', `/v1/expenses/vouchers/${v.id}/cancel`, { tenant: s.tenant, body: { date: '2025-06-12', reason: 'Entered twice' } }), 200);
    expect(cancelled.status).toBe('cancelled');
    expect(bal(await tb(s), s.acc['5900'] as string)).toBeCloseTo(100); // only the second remains
    expect((await call(server, 'POST', `/v1/expenses/vouchers/${v.id}/cancel`, { tenant: s.tenant, body: { date: '2025-06-12', reason: 'again' } })).json.code).toBe('already_cancelled');
  });

  it('only accepts an expense account for a category and a cash or bank account to pay from', async () => {
    const s = await kit.shop('Exp Guard Co');
    const bad = await call(server, 'POST', '/v1/expenses/categories', { tenant: s.tenant, body: { companyId: s.companyId, code: 'x', name: 'x', expenseAccountId: s.acc['1110'] } });
    expect(bad.status).toBe(422);
    const cat = ok(await call(server, 'POST', '/v1/expenses/categories', { tenant: s.tenant, body: { companyId: s.companyId, code: 'x', name: 'Misc', expenseAccountId: s.acc['5900'] } }));
    expect((await call(server, 'POST', '/v1/expenses/categories', { tenant: s.tenant, body: { companyId: s.companyId, code: 'X', name: 'dup', expenseAccountId: s.acc['5900'] } })).json.code).toBe('category_exists');
    const notCash = await call(server, 'POST', '/v1/expenses/vouchers', { tenant: s.tenant, body: { companyId: s.companyId, voucherDate: '2025-06-10', categoryId: cat.id, amount: '10', paidFromAccountId: s.acc['5900'] } });
    expect(notCash.status).toBe(422);
    const zero = await call(server, 'POST', '/v1/expenses/vouchers', { tenant: s.tenant, body: { companyId: s.companyId, voucherDate: '2025-06-10', categoryId: cat.id, amount: '0', paidFromAccountId: s.acc['1110'] } });
    expect(zero.status).toBe(422);
    // an inactive category takes no new vouchers
    ok(await call(server, 'PATCH', `/v1/expenses/categories/${cat.id}`, { tenant: s.tenant, headers: { 'if-match': String(cat.version) }, body: { status: 'inactive' } }), 200);
    expect((await call(server, 'POST', '/v1/expenses/vouchers', { tenant: s.tenant, body: { companyId: s.companyId, voucherDate: '2025-06-10', categoryId: cat.id, amount: '10', paidFromAccountId: s.acc['1110'] } })).status).toBe(422);
  });

  it('is closed to people without the right, and to other businesses', async () => {
    const a = await kit.shop('Exp A');
    const b = await kit.shop('Exp B');
    const cat = ok(await call(server, 'POST', '/v1/expenses/categories', { tenant: a.tenant, body: { companyId: a.companyId, code: 'c', name: 'C', expenseAccountId: a.acc['5900'] } }));
    expect((await call(server, 'GET', `/v1/expenses/categories?companyId=${a.companyId}`, { tenant: b.tenant })).json.items ?? []).toEqual([]);
    const cross = await call(server, 'POST', '/v1/expenses/vouchers', { tenant: b.tenant, body: { companyId: b.companyId, voucherDate: '2025-06-10', categoryId: cat.id, amount: '10', paidFromAccountId: b.acc['1110'] } });
    expect(cross.status).toBe(404);
  });
});

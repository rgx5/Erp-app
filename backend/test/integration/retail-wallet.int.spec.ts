import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Counter extends Shop { terminal: string; shift: string }
const put = (s: Shop, path: string, body: object, base = '/v1/pos/') => call(server, 'PUT', `${base}${path}?companyId=${s.companyId}`, { tenant: s.tenant, body });
async function counter(name: string): Promise<Counter> {
  const s = await kit.shop(name);
  ok(await put(s, 'settings', { walkInCustomerId: s.cust.consumer, cashVarianceAccountId: s.acc['5900'] }), 200);
  for (const [method, code] of [['cash', '1110'], ['card', '1120'], ['upi', '1120']] as const) ok(await put(s, 'payment-accounts', { method, accountId: s.acc[code] }), 200);
  const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
  const terminal = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T1', name: 'Till 1', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } })).id as string;
  const shift = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: terminal, openingCash: '500', date: '2025-04-10' } })).id as string;
  return { ...s, terminal, shift };
}
const sale = (c: Counter, lines: object[], payments: object[], o: object = {}) => call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-10', lines, payments, ...o } });
const widget = (c: Counter, o: object = {}) => ({ itemId: c.item.widget, quantity: '1', unitPrice: '118', ...o });
const wallet = async (c: Counter, customerId: string) => (await call(server, 'GET', `/v1/retail/customers/${customerId}/wallet?companyId=${c.companyId}`, { tenant: c.tenant })).json;

describe('store credit', () => {
  it('keeps a refund as the customer\'s credit, then lets a later sale use it', async () => {
    const c = await counter('Wallet Credit Co');
    const cust = c.cust.local;
    const first = ok(await sale(c, [widget(c, { quantity: '2' })], [{ method: 'cash', amount: '236' }], { customerId: cust }));
    const back = ok(await call(server, 'POST', '/v1/pos/returns', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-11', originalSaleId: first.id, reason: 'Wrong size', lines: [{ originalLineId: first.invoice.lines[0].id, quantity: '1' }], refunds: [{ method: 'store_credit', amount: '118' }] } }));
    expect(back.payments).toEqual([]); // no money paid out
    expect(back.wallet).toEqual([expect.objectContaining({ kind: 'store_credit_issued', amount: '118.0000' })]);
    expect((await wallet(c, cust)).storeCredit).toBe('118.0000');

    // using it: 118 of store credit + 118 cash settles a 236 bill
    const second = ok(await sale(c, [widget(c, { quantity: '2' })], [{ method: 'cash', amount: '118' }], { customerId: cust, storeCredit: '118', date: '2025-04-12' }));
    expect(second.wallet).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'store_credit_used', amount: '118.0000' })]));
    expect((await wallet(c, cust)).storeCredit).toBe('0.0000');
    const position = (await call(server, 'GET', `/v1/receivables/customers/${cust}/position?companyId=${c.companyId}&asOf=2025-04-30`, { tenant: c.tenant })).json;
    expect(position.openInvoices).toEqual([]); // the new invoice is settled in full
    const recon = (await call(server, 'GET', `/v1/receivables/reconciliation?companyId=${c.companyId}&asOf=2026-03-31`, { tenant: c.tenant })).json;
    expect(recon.reconciled).toBe(true);

    // more than is held, and the walk-in customer, are refused
    expect((await sale(c, [widget(c)], [], { customerId: cust, storeCredit: '118', date: '2025-04-12' })).json.code).toBe('insufficient_store_credit');
    expect((await sale(c, [widget(c)], [{ method: 'cash', amount: '58' }], { storeCredit: '60' })).status).toBe(422);
  });
});

describe('loyalty points', () => {
  it('earns on a named customer\'s sales, redeems up to the balance, and never goes negative', async () => {
    const c = await counter('Wallet Points Co');
    const cust = c.cust.local;
    expect((await put(c, 'settings', { loyaltyPointsPerHundred: '1', loyaltyRupeesPerPoint: '0.5' }, '/v1/retail/')).status).toBe(200);
    const r = ok(await sale(c, [widget(c, { quantity: '5' })], [{ method: 'cash', amount: '590' }], { customerId: cust }));
    expect(r.wallet).toEqual([expect.objectContaining({ kind: 'points_earned', points: '5.90' })]);
    expect((await wallet(c, cust)).loyalty).toMatchObject({ points: '5.90', value: '2.9500' });
    // a walk-in sale earns nothing
    const walkIn = ok(await sale(c, [widget(c)], [{ method: 'cash', amount: '118' }]));
    expect(walkIn.wallet).toEqual([]);
    // redeem 4 points (worth 2.00): the till takes 2.00 off, the server records the redemption
    const red = ok(await sale(c, [widget(c, { unitPrice: '116' })], [{ method: 'cash', amount: '116' }], { customerId: cust, loyaltyPoints: '4' }));
    expect(red.wallet).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'points_redeemed', amount: '2.0000', points: '4.00' })]));
    expect((await wallet(c, cust)).loyalty.points).toBe('3.06'); // 5.90 - 4.00 + 1.16 earned
    expect((await sale(c, [widget(c)], [{ method: 'cash', amount: '118' }], { customerId: cust, loyaltyPoints: '50' })).json.code).toBe('insufficient_points');
    expect((await call(server, 'POST', '/v1/retail/loyalty/adjust', { tenant: c.tenant, body: { companyId: c.companyId, customerId: cust, points: '-100', note: 'x' } })).json.code).toBe('negative_points');
    ok(await call(server, 'POST', '/v1/retail/loyalty/adjust', { tenant: c.tenant, body: { companyId: c.companyId, customerId: cust, points: '10', note: 'Birthday bonus' } }), 200);
    expect((await wallet(c, cust)).loyalty.points).toBe('13.06');
  });

  it('refuses redemption until a point has a value', async () => {
    const c = await counter('Wallet NoRate Co');
    ok(await sale(c, [widget(c)], [{ method: 'cash', amount: '118' }], { customerId: c.cust.local }));
    expect((await call(server, 'POST', '/v1/retail/loyalty/adjust', { tenant: c.tenant, body: { companyId: c.companyId, customerId: c.cust.local, points: '10', note: 'x' } })).status).toBe(200);
    expect((await sale(c, [widget(c)], [{ method: 'cash', amount: '118' }], { customerId: c.cust.local, loyaltyPoints: '5' })).json.code).toBe('loyalty_not_configured');
  });
});

describe('coupons', () => {
  it('checks dates, minimum bill and use limits, and counts each use', async () => {
    const c = await counter('Wallet Coupon Co');
    const mk = (b: object) => call(server, 'POST', '/v1/retail/coupons', { tenant: c.tenant, body: { companyId: c.companyId, ...b } });
    const festive = ok(await mk({ code: 'FESTIVE10', kind: 'percent', value: '10', minBill: '200', maxDiscount: '50', validFrom: '2025-04-01', validTo: '2025-04-30', maxUses: 2, description: 'Festival offer' }));
    expect((await mk({ code: 'festive10', kind: 'fixed', value: '5' })).json.code).toBe('coupon_exists');
    const check = (code: string, total: string, date = '2025-04-10') => call(server, 'POST', '/v1/retail/coupons/validate', { tenant: c.tenant, body: { companyId: c.companyId, code, billTotal: total, date } });
    expect(ok(await check('festive10', '1000'), 200)).toMatchObject({ valid: true, discount: '50.0000' }); // 10% = 100, capped at 50
    expect(ok(await check('FESTIVE10', '300'), 200).discount).toBe('30.0000');
    expect((await check('FESTIVE10', '100')).json.code).toBe('coupon_min_bill');
    expect((await check('FESTIVE10', '300', '2025-05-02')).json.code).toBe('coupon_expired');
    expect((await check('FESTIVE10', '300', '2025-03-30')).json.code).toBe('coupon_not_started');
    expect((await check('NOPE', '300')).json.code).toBe('coupon_not_found');

    // the till applied the discount; the server records the use against the sale
    for (let i = 0; i < 2; i++) ok(await sale(c, [widget(c, { quantity: '3', discountPercent: '10' })], [{ method: 'cash', amount: '319' }], { couponCode: 'FESTIVE10' }));
    const list = ok(await call(server, 'GET', `/v1/retail/coupons?companyId=${c.companyId}`, { tenant: c.tenant }), 200);
    expect(list.items[0]).toMatchObject({ code: 'FESTIVE10', usedCount: 2 });
    expect((await sale(c, [widget(c, { quantity: '3' })], [{ method: 'cash', amount: '354' }], { couponCode: 'FESTIVE10' })).json.code).toBe('coupon_used_up');
    expect((await check('FESTIVE10', '300')).json.code).toBe('coupon_used_up');
    // a refused coupon leaves no sale behind
    const sales = (await call(server, 'GET', `/v1/pos/sales?companyId=${c.companyId}&shiftId=${c.shift}`, { tenant: c.tenant })).json.items;
    expect(sales).toHaveLength(2);
    // switching it off
    ok(await call(server, 'PATCH', `/v1/retail/coupons/${festive.id}`, { tenant: c.tenant, headers: { 'if-match': String(list.items[0].version) }, body: { status: 'inactive', maxUses: null } }), 200);
    expect((await check('FESTIVE10', '300')).json.code).toBe('coupon_inactive');
  });
});

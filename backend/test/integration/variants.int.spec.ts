import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('item variants', () => {
  it('stores style, size and colour on ordinary items and finds all variants by style', async () => {
    const s = await kit.shop('Variant Co');
    const base = ok(await call(server, 'GET', `/v1/items/${s.item.widget}`, { tenant: s.tenant }), 200);
    const make = (code: string, size: string, colour: string) => call(server, 'POST', '/v1/items', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { code, name: `Polo shirt - ${size} / ${colour}`, baseUomId: base.baseUomId, itemType: 'finished_good', taxCodeId: base.taxCodeId, hsnSacCode: '6105', styleCode: 'POLO', size, colour } });
    const a = ok(await make('POLO-M-RED', 'M', 'Red')); ok(await make('POLO-L-RED', 'L', 'Red'));
    expect(a).toMatchObject({ styleCode: 'POLO', size: 'M', colour: 'Red' });
    const found = (await call(server, 'GET', '/v1/items?q=POLO', { tenant: s.tenant })).json.items as { code: string }[];
    expect(found.map((i) => i.code).sort()).toEqual(['POLO-L-RED', 'POLO-M-RED']);
    expect((await make('POLO-X', ' ', 'Red')).status).toBe(422); // blank size
    const up = await call(server, 'PATCH', `/v1/items/${a.id}`, { tenant: s.tenant, headers: { 'if-match': '1' }, body: { colour: null } });
    expect(ok(up, 200).colour).toBeNull();
    const other = await kit.shop('Variant Other');
    expect((await call(server, 'GET', '/v1/items?q=POLO', { tenant: other.tenant })).json.items).toHaveLength(0);
  });
});

describe('UPI address', () => {
  it('is saved on the retail settings and refuses a malformed one', async () => {
    const s = await kit.shop('Upi Co');
    const put = (body: object) => call(server, 'PUT', `/v1/retail/settings?companyId=${s.companyId}`, { tenant: s.tenant, body });
    expect((await put({ upiId: 'not a upi id' })).status).toBe(422);
    expect(ok(await put({ upiId: 'sunrise.store@okaxis' }), 200).upiId).toBe('sunrise.store@okaxis');
    expect((await call(server, 'GET', `/v1/retail/settings?companyId=${s.companyId}`, { tenant: s.tenant })).json.upiId).toBe('sunrise.store@okaxis');
    expect(ok(await put({ upiId: null }), 200).upiId).toBeNull();
  });
});

describe('gift cards', () => {
  const put = (s: { tenant: string; companyId: string }, path: string, body: object) => call(server, 'PUT', `/v1/pos/${path}?companyId=${s.companyId}`, { tenant: s.tenant, body });
  async function till(name: string) {
    const s = await kit.shop(name);
    ok(await put(s, 'settings', { walkInCustomerId: s.cust.consumer, cashVarianceAccountId: s.acc['5900'] }), 200);
    for (const [method, code] of [['cash', '1110'], ['card', '1120'], ['upi', '1120']] as const) ok(await put(s, 'payment-accounts', { method, accountId: s.acc[code] }), 200);
    const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
    const terminal = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T1', name: 'Till 1', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } })).id as string;
    const shift = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: terminal, openingCash: '500', date: '2025-04-10' } })).id as string;
    return { ...s, shift };
  }
  const sell = (c: Awaited<ReturnType<typeof till>>, payments: object[]) => call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-10', lines: [{ itemId: c.item.widget, quantity: '1', unitPrice: '118' }], payments } });

  it('sells a card as a liability, spends it at the counter, and never lets the balance go negative', async () => {
    const c = await till('Gift Co');
    expect((await call(server, 'POST', '/v1/pos/gift-cards', { tenant: c.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { shiftId: c.shift, amount: '500', method: 'cash', date: '2025-04-10' } })).json.code).toBe('pos_not_configured');
    ok(await put(c, 'payment-accounts', { method: 'gift_card', accountId: c.acc['4100'] }), 422); // income is not a liability
    ok(await put(c, 'payment-accounts', { method: 'gift_card', accountId: c.acc['2145'] }), 200);
    const card = ok(await call(server, 'POST', '/v1/pos/gift-cards', { tenant: c.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { shiftId: c.shift, amount: '500', method: 'cash', date: '2025-04-10', holderName: 'Asha' } }));
    expect(card).toMatchObject({ balance: '500.0000', initialAmount: '500.0000', holderName: 'Asha' });
    expect(card.code).toMatch(/^GC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const tb = async () => (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${c.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: c.tenant })).json.rows.find((r: { code: string }) => r.code === '2145');
    expect(await tb()).toMatchObject({ closingCredit: '500.0000' }); // owed to the holder, not income
    expect((await call(server, 'GET', `/v1/pos/shifts/${c.shift}`, { tenant: c.tenant })).json.summary.expectedCash).toBe('1000.0000'); // 500 opening + 500 cash for the card

    const ok1 = ok(await sell(c, [{ method: 'gift_card', amount: '100', reference: card.code.toLowerCase() }, { method: 'cash', amount: '18' }]));
    expect(ok1.payments).toHaveLength(2);
    expect((await call(server, 'GET', `/v1/pos/gift-cards/${card.code}?companyId=${c.companyId}`, { tenant: c.tenant })).json.balance).toBe('400.0000');
    expect(await tb()).toMatchObject({ closingCredit: '400.0000' }); // released as the card was spent
    const over = await sell(c, [{ method: 'gift_card', amount: '118', reference: card.code }]);
    ok(over); // 118 <= 400
    expect((await call(server, 'GET', `/v1/pos/gift-cards/${card.code}?companyId=${c.companyId}`, { tenant: c.tenant })).json.balance).toBe('282.0000');
    const spendRest = await Promise.all([sell(c, [{ method: 'gift_card', amount: '118', reference: card.code }]), sell(c, [{ method: 'gift_card', amount: '118', reference: card.code }]), sell(c, [{ method: 'gift_card', amount: '118', reference: card.code }])]);
    expect(spendRest.filter((r) => r.status === 200 || r.status === 201)).toHaveLength(2); // 282 covers two, the third is refused
    expect(spendRest.find((r) => r.status === 409)?.json.code).toBe('gift_card_insufficient');
    expect((await call(server, 'GET', `/v1/pos/gift-cards/${card.code}?companyId=${c.companyId}`, { tenant: c.tenant })).json.balance).toBe('46.0000');
    expect((await sell(c, [{ method: 'gift_card', amount: '118', reference: 'GC-NOPE-NOPE-NOPE' }])).json.code).toBe('gift_card_not_found');
    expect((await sell(c, [{ method: 'gift_card', amount: '118' }])).status).toBe(422);
    const list = (await call(server, 'GET', `/v1/pos/gift-cards?companyId=${c.companyId}`, { tenant: c.tenant })).json;
    expect(list).toMatchObject({ outstanding: '46.0000' });
    const other = await till('Gift Other');
    expect((await call(server, 'GET', `/v1/pos/gift-cards/${card.code}?companyId=${other.companyId}`, { tenant: other.tenant })).status).toBe(404);
  });
  it('refunds a return onto a new gift card that can then be spent', async () => {
    const c = await till('Gift Refund Co');
    ok(await put(c, 'payment-accounts', { method: 'gift_card', accountId: c.acc['2145'] }), 200);
    const sale = ok(await sell(c, [{ method: 'cash', amount: '118', tendered: '118' }]));
    const ret = ok(await call(server, 'POST', '/v1/pos/returns', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-11', originalSaleId: sale.id, reason: 'Changed mind', lines: [{ originalLineId: sale.invoice.lines[0].id, quantity: '1' }], refunds: [{ method: 'gift_card', amount: '118' }] } }));
    const code = ret.payments[0].reference as string;
    expect(ret.payments[0]).toMatchObject({ method: 'gift_card', amount: '118.0000' });
    expect(code).toMatch(/^GC-/);
    expect((await call(server, 'GET', `/v1/pos/gift-cards/${code}?companyId=${c.companyId}`, { tenant: c.tenant })).json.balance).toBe('118.0000');
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${c.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: c.tenant })).json.rows.find((r: { code: string }) => r.code === '2145');
    expect(tb).toMatchObject({ closingCredit: '118.0000' }); // owed to the holder
    ok(await sell(c, [{ method: 'gift_card', amount: '118', reference: code }]));
    expect((await call(server, 'GET', `/v1/pos/gift-cards/${code}?companyId=${c.companyId}`, { tenant: c.tenant })).json.balance).toBe('0.0000');
    // cash in the drawer is untouched by a refund to a card: 500 opening + 118 cash sale, nothing paid out
    expect((await call(server, 'GET', `/v1/pos/shifts/${c.shift}`, { tenant: c.tenant })).json.summary.expectedCash).toBe('618.0000');
  });
});

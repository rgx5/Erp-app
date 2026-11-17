import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createRegistration, createTenant, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.close(); await supers.end(); });

const status = async (tenant: string, companyId: string) => (await call(server, 'GET', `/v1/companies/${companyId}/setup/status`, { tenant })).json as { ready: boolean; canApplyDefaults: boolean; checks: { key: string; done: boolean; detail: string }[] };
const done = (s: Awaited<ReturnType<typeof status>>) => Object.fromEntries(s.checks.map((c) => [c.key, c.done]));

describe('company setup', () => {
  it('reports what is missing, completes the standard Indian defaults, and is safe to repeat', async () => {
    const tenant = await createTenant(server, 'Setup Co');
    const { companyId, registrationId } = await createRegistration(server, tenant, '27', 'ABCDE1234F');

    let s = await status(tenant, companyId);
    expect(s.ready).toBe(false);
    expect(done(s)).toMatchObject({ company: true, gstRegistration: true, businessLocation: false, warehouse: false, fiscalYear: false, chartOfAccounts: false, taxCodes: false, numberSeries: false });

    // chart/settings can be applied now; series and tax slabs wait for a financial year
    let applied = (await call(server, 'POST', `/v1/companies/${companyId}/setup/apply-defaults`, { tenant, body: {} })).json;
    expect(applied.steps.find((x: { key: string }) => x.key === 'chartOfAccounts')).toMatchObject({ action: 'created' });
    expect(applied.steps.find((x: { key: string }) => x.key === 'numberSeries')).toMatchObject({ action: 'blocked' });
    expect(applied.steps.find((x: { key: string }) => x.key === 'taxCodes')).toMatchObject({ action: 'blocked' });
    expect(done(applied.status)).toMatchObject({ chartOfAccounts: true, statementMapping: true, inventoryAccounts: true, stockSettings: true, salesSettings: true, purchasingSettings: true, numberSeries: false, taxCodes: false });

    ok(await call(server, 'POST', '/v1/fiscal-years', { tenant, body: { companyId, startDate: '2025-04-01' } }));
    const loc = ok(await call(server, 'POST', '/v1/business-locations', { tenant, body: { companyId, gstRegistrationId: registrationId, code: 'MUM', name: 'Mumbai', addressLine1: '1 Main Rd', city: 'Mumbai', stateCode: '27', pincode: '400001' } }));
    ok(await call(server, 'POST', '/v1/warehouses', { tenant, body: { businessLocationId: loc.id, code: 'MAIN', name: 'Main', kind: 'finished_goods' } }));

    applied = (await call(server, 'POST', `/v1/companies/${companyId}/setup/apply-defaults`, { tenant, body: {} })).json;
    expect(applied.steps.find((x: { key: string }) => x.key === 'chartOfAccounts')).toMatchObject({ action: 'skipped' });
    expect(applied.steps.find((x: { key: string }) => x.key === 'numberSeries')).toMatchObject({ action: 'created', detail: '4 number series created' });
    expect(applied.steps.find((x: { key: string }) => x.key === 'taxCodes')).toMatchObject({ action: 'created', detail: '7 GST tax codes added' });
    s = applied.status;
    expect(s.ready).toBe(true);
    expect(s.canApplyDefaults).toBe(false);

    // running it again changes nothing
    const again = (await call(server, 'POST', `/v1/companies/${companyId}/setup/apply-defaults`, { tenant, body: {} })).json;
    expect(again.steps.every((x: { action: string }) => x.action === 'skipped')).toBe(true);

    // and the result is genuinely usable: an item, a customer and an invoice go through with the defaults only
    const codes = (await call(server, 'GET', '/v1/tax-codes?limit=50', { tenant })).json.items as { id: string; code: string }[];
    const gst18 = codes.find((c) => c.code === 'GST18')!.id;
    const nos = ((await call(server, 'GET', '/v1/units?limit=200', { tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === 'NOS')!.id;
    const item = ok(await call(server, 'POST', '/v1/items', { tenant, body: { code: 'W1', name: 'Widget', baseUomId: nos, itemType: 'finished_good', taxCodeId: gst18, hsnSacCode: '8479' } }));
    const wh = ((await call(server, 'GET', '/v1/warehouses', { tenant })).json.items as { id: string }[])[0]!.id;
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant, body: { companyId, movementType: 'opening', postingDate: '2025-04-01', description: 'Opening', lines: [{ warehouseId: wh, itemId: item.id, quantity: '10', unitCost: '400' }] } }));
    const cust = ok(await call(server, 'POST', '/v1/parties', { tenant, body: { code: 'C1', legalName: 'Walk-in', gstTreatment: 'consumer', isCustomer: true } }));
    const invoice = await call(server, 'POST', '/v1/sales/invoices', { tenant, body: { companyId, gstRegistrationId: registrationId, customerId: cust.id, invoiceDate: '2025-04-10', placeOfSupplyState: '27', lines: [{ itemId: item.id, warehouseId: wh, quantity: '2', unitPrice: '500' }] } });
    expect(invoice.status, JSON.stringify(invoice.json)).toBe(201);
    expect(invoice.json.invoiceNo ?? invoice.json.document?.documentNo).toMatch(/INV\/2526\/00001/);
  });

  it('never overwrites what is already set, and keeps the registration choice explicit', async () => {
    const tenant = await createTenant(server, 'Setup Keep Co');
    const { companyId } = await createRegistration(server, tenant, '27', 'ABCDE1234F');
    ok(await call(server, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant, body: { template: 'manufacturing_india' } }));
    const accounts = (await call(server, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant })).json.items as { id: string; code: string }[];
    const mine = accounts.find((a) => a.code === '4110')!.id; // someone chose traded-goods income as the sales account
    ok(await call(server, 'PUT', `/v1/companies/${companyId}/sales-settings`, { tenant, body: { salesAccountId: mine } }), 200);
    await call(server, 'POST', `/v1/companies/${companyId}/setup/apply-defaults`, { tenant, body: {} });
    const sales = (await call(server, 'GET', `/v1/companies/${companyId}/sales-settings`, { tenant })).json;
    expect(sales.salesAccountId).toBe(mine);
    expect(sales.receivableAccountId).toBe(accounts.find((a) => a.code === '1130')!.id);
  });

  it('is permissioned and isolated', async () => {
    const a = await createTenant(server, 'Setup A');
    const b = await createTenant(server, 'Setup B');
    const { companyId } = await createRegistration(server, a, '27', 'ABCDE1234F');
    expect((await call(server, 'GET', `/v1/companies/${companyId}/setup/status`, { tenant: b })).status).toBe(404);
    expect((await call(server, 'POST', `/v1/companies/${companyId}/setup/apply-defaults`, { tenant: b, body: {} })).status).toBe(404);
  });
});

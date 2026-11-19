import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
const extra: TestServer[] = [];
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { for (const s of extra) await s.close(); await server.close(); await supers.end(); });

const site = (s: Shop, body: object) => call(server, 'POST', '/v1/sites', { tenant: s.tenant, body });
const quoteBody = (s: Shop) => ({ companyId: s.companyId, gstRegistrationId: s.regId, customerId: s.cust.local, quoteDate: '2025-04-10', validUntil: '2025-04-30', lines: [{ itemId: s.item.widget, quantity: '1', unitPrice: '100', warehouseId: s.wh }] });
const invoiceBody = (s: Shop) => ({ companyId: s.companyId, gstRegistrationId: s.regId, customerId: s.cust.local, invoiceDate: '2025-04-10', lines: [{ itemId: s.item.widget, quantity: '1', unitPrice: '100', warehouseId: s.wh }] });

describe('sites', () => {
  it('keeps a client\'s places, with one primary and unique codes and number-series codes', async () => {
    const s = await kit.shop('Sites Co');
    expect((await call(server, 'GET', '/v1/sites', { tenant: s.tenant })).json.items).toEqual([]);
    const primary = ok(await site(s, { code: 'HO', name: 'Head office', isPrimary: true }));
    expect(primary).toMatchObject({ code: 'HO', seriesCode: '', isPrimary: true });
    const branch = ok(await site(s, { code: 'PUNE', name: 'Pune branch', seriesCode: 'p' }));
    expect(branch.seriesCode).toBe('P');
    expect((await site(s, { code: 'pune', name: 'Dup', seriesCode: 'Q' })).json.code).toBe('site_exists');
    expect((await site(s, { code: 'NASIK', name: 'Dup series', seriesCode: 'P' })).json.code).toBe('site_exists');
    expect((await site(s, { code: 'HO2', name: 'Second primary', isPrimary: true })).json.code).toBe('site_exists');
    expect((await site(s, { code: 'GOA', name: 'No series' })).status).toBe(422);
    expect((await site(s, { code: 'GOA', name: 'Bad series', seriesCode: 'ABC' })).status).toBe(422);
    const renamed = ok(await call(server, 'PATCH', `/v1/sites/${branch.id}`, { tenant: s.tenant, headers: { 'if-match': String(branch.version) }, body: { name: 'Pune (new)' } }), 200);
    expect(renamed.name).toBe('Pune (new)');
    expect((await call(server, 'PATCH', `/v1/sites/${branch.id}`, { tenant: s.tenant, headers: { 'if-match': '1' }, body: { name: 'Stale' } })).status).toBe(412);
    expect((await call(server, 'PATCH', `/v1/sites/${primary.id}`, { tenant: s.tenant, headers: { 'if-match': String(primary.version) }, body: { status: 'closed' } })).json.code).toBe('primary_site');
    // another business cannot see them
    const other = await kit.shop('Other Sites Co');
    expect((await call(server, 'GET', '/v1/sites', { tenant: other.tenant })).json.items).toEqual([]);
  });

  it('respects a licence limit on the number of sites (the primary counts as one)', async () => {
    const s = await kit.shop('Site Limit Co');
    const platform = (body: object) => call(server, 'PUT', `/v1/platform/tenants/${s.tenant}/entitlements`, { token: process.env['TEST_PLATFORM_TOKEN'] ?? 'test-platform-admin-token-0123456789abcdef', body });
    expect((await platform({ modules: ['sales', 'inventory'], limits: { sites: 2 } })).status).toBe(200);
    ok(await site(s, { code: 'A', name: 'A', seriesCode: 'A' }));
    expect((await site(s, { code: 'B', name: 'B', seriesCode: 'B' })).json.code).toBe('limit_reached');
  });

  it('numbers documents per site: a site server adds its code, the primary stays unchanged, and records remember their site', async () => {
    const s = await kit.shop('Site Numbers Co');
    const branch = ok(await site(s, { code: 'BR', name: 'Branch', seriesCode: 'B' }));
    const atPrimary = ok(await call(server, 'POST', '/v1/sales/quotes', { tenant: s.tenant, body: quoteBody(s) }));
    expect(atPrimary.quoteNo).toBe('QT/2526/000001');
    const branchServer = await startServer({ SITE_ID: branch.id });
    extra.push(branchServer);
    const atBranch = ok(await call(branchServer, 'POST', '/v1/sales/quotes', { tenant: s.tenant, body: quoteBody(s) }));
    expect(atBranch.quoteNo).toBe('QTB/2526/000001'); // its own run of numbers
    expect(ok(await call(branchServer, 'POST', '/v1/sales/quotes', { tenant: s.tenant, body: quoteBody(s) })).quoteNo).toBe('QTB/2526/000002');
    expect(ok(await call(server, 'POST', '/v1/sales/quotes', { tenant: s.tenant, body: quoteBody(s) })).quoteNo).toBe('QT/2526/000002'); // the primary carries on
    const rows = await supers.query<{ quote_no: string; site_id: string | null }>('SELECT quote_no, site_id FROM erp.sales_quotes WHERE tenant_id = $1 ORDER BY quote_no', [s.tenant]);
    expect(rows.rows.map((r) => [r.quote_no, r.site_id])).toEqual([['QT/2526/000001', null], ['QT/2526/000002', null], ['QTB/2526/000001', branch.id], ['QTB/2526/000002', branch.id]]);
    // events and audit entries carry the site too
    const audit = await supers.query<{ n: string }>("SELECT count(*)::text AS n FROM erp.audit_log WHERE tenant_id = $1 AND action = 'sales_quote.created' AND site_id = $2", [s.tenant, branch.id]);
    expect(audit.rows[0]?.n).toBe('2');
    const events = await supers.query<{ n: string }>("SELECT count(*)::text AS n FROM erp.outbox_events WHERE tenant_id = $1 AND event_type = 'sales_quote.created' AND site_id = $2", [s.tenant, branch.id]);
    expect(events.rows[0]?.n).toBe('2');
  });

  it('gives each site its own statutory invoice series', async () => {
    const s = await kit.shop('Site Invoice Co');
    const branch = ok(await site(s, { code: 'BR', name: 'Branch', seriesCode: 'B' }));
    const branchServer = await startServer({ SITE_ID: branch.id });
    extra.push(branchServer);
    const post = (srv: TestServer) => call(srv, 'POST', '/v1/sales/invoices', { tenant: s.tenant, body: invoiceBody(s) });
    expect(ok(await post(server)).invoiceNo).toBe('INV/2526/00001');
    const missing = await post(branchServer);
    expect(missing.status).toBe(409); expect(missing.json.code).toBe('number_series_missing'); // the branch has no series yet
    ok(await call(server, 'POST', '/v1/number-series', { tenant: s.tenant, body: { gstRegistrationId: s.regId, documentType: 'tax_invoice', financialYear: '2025-26', prefix: 'INVB', siteId: branch.id } }));
    expect((await call(server, 'POST', '/v1/number-series', { tenant: s.tenant, body: { gstRegistrationId: s.regId, documentType: 'tax_invoice', financialYear: '2025-26', prefix: 'INVB', siteId: branch.id } })).status).toBe(409); // one per site, year and type
    expect(ok(await post(branchServer)).invoiceNo).toBe('INVB/2526/00001');
    expect(ok(await post(server)).invoiceNo).toBe('INV/2526/00002');
  });

  it('refuses to number anything when the server is set up for a site the business does not have', async () => {
    const s = await kit.shop('Wrong Site Co');
    const ghost = await startServer({ SITE_ID: '019a0000-0000-7000-8000-0000000000aa' });
    extra.push(ghost);
    const r = await call(ghost, 'POST', '/v1/sales/quotes', { tenant: s.tenant, body: quoteBody(s) });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

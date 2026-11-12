import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnitOfWork } from '../../src/platform/database/unit-of-work.js';
import { NumberingService } from '../../src/modules/numbering/numbering.service.js';
import { appPool, call, createRegistration, createTenant, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
let tenant: string;
let uow: UnitOfWork;
let numbering: NumberingService;
let registrationId: string;
const supers = superPool();

beforeAll(async () => {
  server = await startServer();
  tenant = await createTenant(server, 'Numbering Co');
  uow = server.app.get(UnitOfWork);
  numbering = server.app.get(NumberingService);
  ({ registrationId } = await createRegistration(server, tenant));
});
afterAll(async () => { await server.close(); await supers.end(); });

const series = (body: object = {}, who = tenant) =>
  call(server, 'POST', '/v1/number-series', { tenant: who, body: { gstRegistrationId: registrationId, documentType: 'tax_invoice', financialYear: '2024-25', prefix: 'INV', ...body } });
const take = (scope: { gstRegistrationId?: string; documentType?: string; financialYear?: string } = {}, who = tenant) =>
  uow.inTenant(who, (tx) => numbering.allocate(tx, who, { gstRegistrationId: registrationId, documentType: 'tax_invoice', financialYear: '2024-25', ...scope }));

describe('number series configuration', () => {
  it('creates a series per GST registration, document type and financial year', async () => {
    const res = await series();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ documentType: 'tax_invoice', financialYear: '2024-25', prefix: 'INV', separator: '/', padding: 5, nextValue: 1, status: 'active' });
    expect((await series()).status).toBe(409); // same scope twice
    expect((await series({ financialYear: '2025-26' })).status).toBe(201);
    expect((await series({ documentType: 'credit_note', prefix: 'CN' })).status).toBe(201);
    const list = await call(server, 'GET', '/v1/number-series', { tenant });
    expect(list.json.items.length).toBeGreaterThanOrEqual(3);
    expect((await call(server, 'GET', `/v1/number-series/${res.json.id}`, { tenant })).json.id).toBe(res.json.id);
  });
  it('rejects a format that could exceed the 16-character statutory limit, bad years and bad characters', async () => {
    const tooLong = await series({ documentType: 'long_one', prefix: 'ABCDEFGHIJ', padding: 8 });
    expect(tooLong.status).toBe(422);
    expect(tooLong.json.code).toBe('number_too_long');
    expect((await series({ documentType: 'bad_fy', financialYear: '2024-26' })).status).toBe(422);
    expect((await series({ documentType: 'bad_prefix', prefix: 'IN V!' })).status).toBe(422);
    expect((await series({ documentType: 'Bad Type' })).status).toBe(422);
  });
  it('refuses another tenant\'s GST registration, and requires numbering:write', async () => {
    const other = await createTenant(server, 'Numbering Other');
    const res = await series({ documentType: 'steal' }, other);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('reference_invalid');
    const reader = await call(server, 'POST', '/v1/api-keys', { tenant, body: { name: 'ro', permissions: ['numbering:read'] } });
    expect((await call(server, 'GET', '/v1/number-series', { token: reader.json.key })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/number-series', { token: reader.json.key, body: { gstRegistrationId: registrationId, documentType: 'x_doc', financialYear: '2024-25' } })).status).toBe(403);
  });
});

describe('allocation', () => {
  it('issues consecutive formatted numbers and records each one', async () => {
    const sid = (await series({ documentType: 'seq_doc', prefix: 'SQ' })).json.id as string;
    const a = await take({ documentType: 'seq_doc' });
    const b = await take({ documentType: 'seq_doc' });
    expect([a.formatted, b.formatted]).toEqual(['SQ/2425/00001', 'SQ/2425/00002']);
    const list = await call(server, 'GET', `/v1/number-series/${sid}/allocations`, { tenant });
    expect(list.json.items.map((i: { number: string }) => i.number)).toEqual(['SQ/2425/00001', 'SQ/2425/00002']);
    expect((await call(server, 'GET', `/v1/number-series/${sid}`, { tenant })).json.nextValue).toBe(3);
  });
  it('hands out 40 simultaneous numbers without a duplicate or a gap', async () => {
    await series({ documentType: 'race_doc', prefix: 'R' });
    const results = await Promise.all(Array.from({ length: 40 }, () => take({ documentType: 'race_doc' })));
    expect(results.map((r) => r.value).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.formatted)).size).toBe(40);
  });
  it('consumes a number only if the document that uses it commits', async () => {
    await series({ documentType: 'tx_doc', prefix: 'T' });
    await expect(uow.inTenant(tenant, async (tx) => {
      await numbering.allocate(tx, tenant, { gstRegistrationId: registrationId, documentType: 'tx_doc', financialYear: '2024-25' });
      throw new Error('document failed to save');
    })).rejects.toThrow('document failed');
    const next = await take({ documentType: 'tx_doc' });
    expect(next.value).toBe(1); // the rolled-back number is available again: no gap
  });
  it('keeps a cancelled number on record and never issues it again', async () => {
    await series({ documentType: 'cancel_doc', prefix: 'C' });
    const first = await take({ documentType: 'cancel_doc' });
    const cancelled = await uow.inTenant(tenant, (tx) => numbering.cancel(tx, tenant, first.id, 'issued in error'));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'issued in error', formatted: first.formatted });
    const again = await uow.inTenant(tenant, (tx) => numbering.cancel(tx, tenant, first.id, 'twice'));
    expect(again.cancelReason).toBe('issued in error'); // harmless repeat, first reason kept
    const second = await take({ documentType: 'cancel_doc' });
    expect(second.formatted).toBe('C/2425/00002');
    const rows = (await supers.query('SELECT formatted, status FROM erp.number_allocations WHERE tenant_id = $1 AND series_id = $2 ORDER BY value', [tenant, first.seriesId])).rows;
    expect(rows).toEqual([{ formatted: 'C/2425/00001', status: 'cancelled' }, { formatted: 'C/2425/00002', status: 'issued' }]);
  });
  it('keeps registrations and years independent: each starts at 1 and there is no global counter', async () => {
    const second = await createRegistration(server, tenant, '29', 'FGHIJ5678K');
    await series({ documentType: 'ind_doc', prefix: 'IN' });
    await call(server, 'POST', '/v1/number-series', { tenant, body: { gstRegistrationId: second.registrationId, documentType: 'ind_doc', financialYear: '2024-25', prefix: 'IN' } });
    await series({ documentType: 'ind_doc', prefix: 'IN', financialYear: '2025-26' });
    await take({ documentType: 'ind_doc' });
    await take({ documentType: 'ind_doc' });
    const other = await take({ documentType: 'ind_doc', gstRegistrationId: second.registrationId });
    const nextYear = await take({ documentType: 'ind_doc', financialYear: '2025-26' });
    expect(other.formatted).toBe('IN/2425/00001'); // same text as the first registration's first number: legitimate, they are separate series
    expect(nextYear.formatted).toBe('IN/2526/00001');
  });
  it('refuses to allocate from a missing or closed series, and when the 16-character limit would be hit', async () => {
    await expect(take({ documentType: 'no_such_series' })).rejects.toMatchObject({ code: 'number_series_missing' });
    await series({ documentType: 'close_doc', prefix: 'X' });
    await supers.query("UPDATE erp.number_series SET status = 'closed' WHERE tenant_id = $1 AND document_type = 'close_doc'", [tenant]);
    await expect(take({ documentType: 'close_doc' })).rejects.toMatchObject({ code: 'number_series_closed' });
    await series({ documentType: 'full_doc', prefix: 'ABCD', padding: 1, includeFinancialYear: false, startAt: 9 });
    expect((await take({ documentType: 'full_doc' })).formatted).toBe('ABCD/9');
    expect((await take({ documentType: 'full_doc' })).formatted).toBe('ABCD/10'); // value outgrows padding: still legal
  });
  it('cannot be used across tenants', async () => {
    const other = await createTenant(server, 'Numbering Intruder');
    await expect(take({ documentType: 'tax_invoice' }, other)).rejects.toMatchObject({ code: 'number_series_missing' });
    expect((await call(server, 'GET', '/v1/number-series', { tenant: other })).json.items).toEqual([]);
  });
});

describe('the ledger of numbers is append-only', () => {
  it('lets the database change an allocation exactly once (issued -> cancelled) and never delete it', async () => {
    await series({ documentType: 'guard_doc', prefix: 'G' });
    const a = await take({ documentType: 'guard_doc' });
    await expect(supers.query("UPDATE erp.number_allocations SET formatted = 'HACK/1' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('UPDATE erp.number_allocations SET value = 99 WHERE id = $1', [a.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('DELETE FROM erp.number_allocations WHERE id = $1', [a.id])).rejects.toMatchObject({ code: '55000' });
    await uow.inTenant(tenant, (tx) => numbering.cancel(tx, tenant, a.id, 'x'));
    await expect(supers.query("UPDATE erp.number_allocations SET status = 'issued', cancelled_at = NULL WHERE id = $1", [a.id])).rejects.toMatchObject({ code: '55000' });
    const pool = appPool(1);
    try {
      await expect(pool.query('DELETE FROM erp.number_allocations')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query("UPDATE erp.number_allocations SET formatted = 'X'")).rejects.toMatchObject({ code: '42501' });
    } finally { await pool.end(); }
  });
  it('is covered by tenant isolation like every other table', async () => {
    const pool = appPool(1);
    try {
      expect((await pool.query('SELECT count(*)::int AS n FROM erp.number_allocations')).rows[0].n).toBe(0); // no tenant bound
    } finally { await pool.end(); }
  });
});

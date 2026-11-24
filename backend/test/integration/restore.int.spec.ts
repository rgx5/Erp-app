import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreExport, verifyExportFile } from '../../src/maintenance/restore-export.js';
import { call, createTenantWithOwner, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const count = async (table: string, tenantId: string): Promise<number> => Number((await supers.query(`SELECT count(*)::int AS n FROM erp.${table} WHERE tenant_id = $1`, [tenantId])).rows[0].n);

describe('export checksum and restore', () => {
  it('restores a business into a new empty one, record for record, and refuses damaged files and busy targets', async () => {
    const a = await kit.shop('Restore Source Co');
    const inv = ok(await call(server, 'POST', '/v1/sales/invoices', { tenant: a.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: a.companyId, gstRegistrationId: a.regId, invoiceDate: '2025-06-01', customerId: a.cust.local, lines: [{ itemId: a.item.widget, quantity: '3', unitPrice: '1000', warehouseId: a.wh }] } }));
    ok(await call(server, 'POST', '/v1/receivables/receipts', { tenant: a.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: a.companyId, customerId: a.cust.local, receiptDate: '2025-06-05', amount: '1000', method: 'cash', depositAccountId: a.acc['1110'], allocations: [{ invoiceId: inv.id, amount: '1000' }] } }));
    const exported = (await call(server, 'GET', '/v1/reports/export', { tenant: a.tenant })).json;
    expect(exported.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyExportFile(exported).tenantId).toBe(a.tenant);

    // a changed or cut-down file is refused before anything is touched
    const tampered = JSON.parse(JSON.stringify(exported));
    tampered.tables.sales_invoices[0].grand_total = '1.0000';
    expect(() => verifyExportFile(tampered)).toThrow(/changed or damaged/);
    expect(() => verifyExportFile({ format: 'something else' })).toThrow(/not a OneSyncERP export/);

    const target = await createTenantWithOwner(server, 'Restore Target Co');
    // a business that already has data is never overwritten
    await expect(restoreExport(supers, exported, a.tenant)).rejects.toThrow(/already has data/);
    // a dry run changes nothing
    const dry = await restoreExport(supers, exported, target.id, { dryRun: true });
    expect(dry.dryRun).toBe(true); expect(await count('sales_invoices', target.id)).toBe(0);

    const done = await restoreExport(supers, exported, target.id);
    expect(done.rows).toBeGreaterThan(100); expect(done.skipped).toContain('tenant_directory');
    for (const t of ['sales_invoices', 'sales_invoice_lines', 'customer_receipts', 'journal_entries', 'journal_lines', 'accounts', 'items', 'parties', 'stock_ledger', 'companies']) {
      expect(await count(t, target.id), t).toBe(await count(t, a.tenant));
    }
    // the restored books balance and carry the same totals as the source
    const sums = async (tenantId: string) => (await supers.query('SELECT COALESCE(SUM(debit), 0)::text AS d, COALESCE(SUM(credit), 0)::text AS c FROM erp.journal_lines WHERE tenant_id = $1', [tenantId])).rows[0];
    const restored = await sums(target.id);
    expect(restored).toEqual(await sums(a.tenant)); expect(restored.d).toBe(restored.c);
    // sign-in is locked on restored users, and the source is untouched
    expect((await supers.query('SELECT DISTINCT password_hash FROM erp.users WHERE tenant_id = $1', [target.id])).rows).toEqual([{ password_hash: '!restored-sign-in-locked' }]);
    expect(await count('sales_invoices', a.tenant)).toBe(1);
    // restoring twice into the same target is refused: it is no longer empty
    await expect(restoreExport(supers, exported, target.id)).rejects.toThrow(/already has data/);
  });
});

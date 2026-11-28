import { sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { DEFAULT_TCS_SECTIONS } from './tcs.logic.js';

/** Gives a business the usual 206C sections the first time TCS is used. Once it has any section of its own, nothing is added. */
export async function seedTcsSections(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`INSERT INTO erp.tcs_sections (tenant_id, id, code, description, rate)
    SELECT ${tenantId}::uuid, gen_random_uuid(), d.code, d.description, d.rate::numeric FROM jsonb_to_recordset(${JSON.stringify(DEFAULT_TCS_SECTIONS)}::jsonb) AS d(code text, description text, rate text)
    WHERE NOT EXISTS (SELECT 1 FROM erp.tcs_sections WHERE tenant_id = ${tenantId}::uuid) ON CONFLICT DO NOTHING`);
}

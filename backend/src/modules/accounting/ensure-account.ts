import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';

/**
 * An account the standard chart has (for example loans given, or TCS payable) is added to a company that started before it existed, the first time it is
 * needed. It goes under the named parent (when the company has it) and is an ordinary, postable account that can be renamed or deactivated like any other.
 */
export async function ensureAccount(tx: Tx, tenantId: string, companyId: string, a: { code: string; name: string; type: 'asset' | 'liability' | 'income' | 'expense'; parentCode?: string }): Promise<string> {
  const have = (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.accounts WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND code = ${a.code}`)).rows[0];
  if (have) return have.id;
  const parent = a.parentCode ? (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.accounts WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND code = ${a.parentCode}`)).rows[0] : undefined;
  const id = uuidv7();
  await tx.execute(sql`INSERT INTO erp.accounts (tenant_id, id, company_id, code, name, type, parent_id, is_group) VALUES (${tenantId}::uuid, ${id}::uuid, ${companyId}::uuid, ${a.code}, ${a.name}, ${a.type}, ${parent?.id ?? null}::uuid, false)`);
  return id;
}

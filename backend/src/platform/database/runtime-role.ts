import type pg from 'pg';

export interface RuntimeRoleReport {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
  canActAsObjectOwner: boolean;
  canCreateInSchema: boolean;
  problems: string[];
}

/**
 * Proves, from inside the database, that the connected role cannot defeat row-level security: it is not a superuser,
 * neither it nor any role it inherits has BYPASSRLS, it is not (and cannot act as) the owner of any table in the
 * schema, and it cannot create objects there. The application refuses to start if any of this is false.
 */
export async function inspectRuntimeRole(pool: pg.Pool): Promise<RuntimeRoleReport> {
  const { rows } = await pool.query<{
    role: string;
    superuser: boolean;
    bypass_rls: boolean;
    owner_access: boolean;
    can_create: boolean;
  }>(`
    SELECT current_user::text AS role,
           r.rolsuper AS superuser,
           EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolbypassrls AND pg_has_role(current_user, g.oid, 'USAGE')) AS bypass_rls,
           EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'erp' AND pg_has_role(current_user, c.relowner, 'USAGE')) AS owner_access,
           has_schema_privilege(current_user, 'erp', 'CREATE') AS can_create
      FROM pg_roles r WHERE r.rolname = current_user`);
  const row = rows[0];
  if (!row) throw new Error('Could not inspect the database role');
  const problems: string[] = [];
  if (row.superuser) problems.push('is a superuser');
  if (row.bypass_rls) problems.push('has (or inherits) BYPASSRLS');
  if (row.owner_access) problems.push('owns, or can act as the owner of, tables in schema erp');
  if (row.can_create) problems.push('can create objects in schema erp');
  return {
    role: row.role,
    superuser: row.superuser,
    bypassRls: row.bypass_rls,
    canActAsObjectOwner: row.owner_access,
    canCreateInSchema: row.can_create,
    problems,
  };
}

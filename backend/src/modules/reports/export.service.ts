import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { Recorder } from '../masterdata/helpers.js';

/** Tables that hold credentials, sessions or plumbing rather than the business's own records. They are never exported. */
const SKIP = /(^|_)(sessions?|refresh|tokens?|api_keys?|idempotency|outbox|audit_chain|password|mfa|secrets?|webhooks?|rate_limits?)(_|$)/;
/** Columns removed from the tables that are exported. */
const HIDE_COLUMNS = new Set(['password_hash', 'mfa_secret_enc', 'pin_hash', 'key_hash', 'secret_hash']);
const MAX_BYTES = 200 * 1024 * 1024;

/** Everything the business has recorded, as one JSON file the owner can keep: a copy of their own data that any tool can read. */
@Injectable()
export class ExportService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  async everything(tenantId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cols = (await tx.execute<{ t: string; c: string }>(sql`
        SELECT c.table_name AS t, c.column_name AS c FROM information_schema.columns c JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
         WHERE c.table_schema = 'erp' AND c.table_name <> 'schema_migrations' AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'erp' AND column_name = 'tenant_id')
         ORDER BY c.table_name, c.ordinal_position`)).rows;
      const byTable = new Map<string, string[]>();
      for (const { t, c } of cols) { if (SKIP.test(t) || HIDE_COLUMNS.has(c) || (t === 'attachments' && c === 'data')) continue; // attachment bytes are not in the file: only their names and checksums byTable.set(t, [...(byTable.get(t) ?? []), c]); }
      const tables: Record<string, unknown[]> = {}; let bytes = 0; let rowsTotal = 0;
      for (const [t, list] of byTable) {
        if (t === 'tenants') continue;
        const ident = sql.raw(`erp."${t.replaceAll('"', '')}"`);
        const select = sql.raw(list.map((c) => `x."${c.replaceAll('"', '')}"`).join(', '));
        const rows = (await tx.execute<Record<string, unknown>>(sql`SELECT ${select} FROM ${ident} x WHERE x.tenant_id = ${tenantId}::uuid`)).rows;
        if (rows.length === 0) continue;
        bytes += JSON.stringify(rows).length; rowsTotal += rows.length;
        if (bytes > MAX_BYTES) throw new AppError(413, 'export_too_large', 'This business has more data than one file can hold. Ask your administrator for a database backup instead.');
        tables[t] = rows;
      }
      await this.recorder.record(tx, tenantId, 'tenant', 'exported', { id: tenantId }, { tables: Object.keys(tables).length, rows: rowsTotal });
      return { format: 'onesync-export-v1', exportedAt: new Date().toISOString(), tenantId, tables };
    });
  }
}

/**
 * Rules every NEW migration must follow so that it can run against a database holding years of a client's data without locking its tables
 * for minutes or breaking the previous release while a rolling deploy is half done. Migrations up to GRANDFATHERED were written before this
 * rule existed and ran on small databases. A rule may be waived for one statement with a comment on the line before it:
 *   -- allow: <rule> <reason>      (for example: -- allow: blocking-index the table has under 10,000 rows)
 */
export const GRANDFATHERED = 49;

export interface Violation { rule: string; line: number; text: string; why: string }

const strip = (sql: string): string[] => sql.split('\n').map((l) => l.replace(/--(?!\s*allow:).*$/, ''));

export function checkMigration(sql: string): Violation[] {
  const lines = sql.split('\n'); const code = strip(sql); const out: Violation[] = [];
  const created = new Set<string>();
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:erp\.)?"?([a-z0-9_]+)"?/gi)) created.add((m[1] as string).toLowerCase());
  const waived = (i: number, rule: string): boolean => { for (let k = i - 1; k >= 0; k--) { const l = (lines[k] as string).trim(); if (l === '') continue; if (!l.startsWith('--')) return false; const m = /^--\s*allow:\s*([a-z-]+)/i.exec(l); if (m && m[1]?.toLowerCase() === rule) return true; } return false; };
  const flag = (i: number, rule: string, why: string): void => { if (!waived(i, rule)) out.push({ rule, line: i + 1, text: (lines[i] as string).trim().slice(0, 140), why }); };
  // join a statement over its lines so a clause on the next line is still seen
  let buf = ''; let start = 0;
  const statements: { text: string; line: number }[] = [];
  code.forEach((l, i) => { if (buf === '') start = i; buf += ' ' + l; if (l.includes(';')) { statements.push({ text: buf.trim(), line: start }); buf = ''; } });
  for (const { text, line } of statements) {
    const t = text.replace(/\s+/g, ' ');
    const alter = /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:erp\.)?"?([a-z0-9_]+)"?\s+(.*)$/i.exec(t);
    const table = alter?.[1]?.toLowerCase();
    const isNew = table !== undefined && created.has(table);
    if (alter && !isNew) {
      const body = alter[2] as string;
      for (const clause of body.split(/,\s*(?=add\s|drop\s|alter\s|rename\s)/i)) {
        if (/^add\s+column/i.test(clause)) {
          if (/not\s+null/i.test(clause) && !/default/i.test(clause)) flag(line, 'not-null-column', 'Adding a NOT NULL column without a default fails on a table that has rows. Add it nullable, fill it in batches, then add the constraint.');
          if (/default\s+[^,]*\b(now|random|gen_random_uuid|clock_timestamp|nextval|uuid_generate)/i.test(clause)) flag(line, 'volatile-default', 'A default that is evaluated per row rewrites the whole table. Use a constant default, then backfill in batches.');
        }
        if (/^alter\s+column\s+\S+\s+(set\s+data\s+)?type/i.test(clause)) flag(line, 'column-type', 'Changing a column type rewrites the table and blocks it. Add a new column and migrate the data.');
        if (/^alter\s+column\s+\S+\s+set\s+not\s+null/i.test(clause)) flag(line, 'set-not-null', 'SET NOT NULL scans the whole table under a lock. Use a CHECK ... NOT VALID, validate it, then set NOT NULL.');
        if (/^add\s+(constraint\s+\S+\s+)?(check|foreign\s+key)/i.test(clause) && !/not\s+valid/i.test(clause)) flag(line, 'validating-constraint', 'A new CHECK or FOREIGN KEY on a table with rows is validated under a lock. Add it NOT VALID, then VALIDATE CONSTRAINT.');
        if (/^drop\s+column/i.test(clause)) flag(line, 'destructive', 'Dropping a column breaks the previous release while a deploy is rolling out and cannot be undone. Stop using it for one release first.');
        if (/^rename\s+/i.test(clause)) flag(line, 'rename', 'Renaming breaks the previous release during a rolling deploy. Add the new name, copy, switch the code, and remove the old one later.');
      }
    }
    const idx = /^create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?\S+\s+on\s+(?:only\s+)?(?:erp\.)?"?([a-z0-9_]+)"?/i.exec(t);
    if (idx && !created.has((idx[2] as string).toLowerCase()) && !/concurrently/i.test(t)) flag(line, 'blocking-index', 'CREATE INDEX on an existing table blocks writes while it builds. Build it CONCURRENTLY (outside a transaction) or waive with the table size.');
    if (/^drop\s+table/i.test(t)) flag(line, 'destructive', 'Dropping a table cannot be undone and breaks the previous release.');
    if (/^truncate\s/i.test(t) || /^lock\s+table/i.test(t)) flag(line, 'table-lock', 'Locks or empties a table.');
    if (/^(update|delete\s+from)\s/i.test(t) && !/^(update|delete\s+from)\s+erp\.(lead_stages)/i.test(t) && !isNewTableBackfill(t, created)) flag(line, 'bulk-write', 'A bulk UPDATE or DELETE in a migration runs in one transaction and holds locks. Do it in batches from a maintenance job.');
  }
  return out;
}
const isNewTableBackfill = (t: string, created: Set<string>): boolean => { const m = /^(?:update|delete\s+from)\s+(?:erp\.)?"?([a-z0-9_]+)"?/i.exec(t); return Boolean(m && created.has((m[1] as string).toLowerCase())); };

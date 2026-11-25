import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkMigration, GRANDFATHERED } from './migration-policy.js';

const rules = (sql: string): string[] => checkMigration(sql).map((v) => v.rule);
describe('migration safety rules', () => {
  it('lets a new table and its indexes and constraints through', () => {
    expect(rules('CREATE TABLE erp.t (a int NOT NULL, b text);\nCREATE INDEX t_a ON erp.t (a);\nALTER TABLE erp.t ADD CONSTRAINT c CHECK (a > 0);')).toEqual([]);
  });
  it('lets a harmless change to an existing table through', () => {
    expect(rules("ALTER TABLE erp.leads ADD COLUMN note text;\nALTER TABLE erp.leads ADD COLUMN n integer NOT NULL DEFAULT 0;\nALTER TABLE erp.leads ADD CONSTRAINT c CHECK (n >= 0) NOT VALID;")).toEqual([]);
  });
  it('catches what locks or rewrites a large table, or breaks the previous release', () => {
    expect(rules('ALTER TABLE erp.leads ADD COLUMN a text NOT NULL;')).toEqual(['not-null-column']);
    expect(rules('ALTER TABLE erp.leads ADD COLUMN a timestamptz DEFAULT now();')).toEqual(['volatile-default']);
    expect(rules('ALTER TABLE erp.leads ALTER COLUMN a TYPE bigint;')).toEqual(['column-type']);
    expect(rules('ALTER TABLE erp.leads ALTER COLUMN a SET NOT NULL;')).toEqual(['set-not-null']);
    expect(rules('ALTER TABLE erp.leads ADD CONSTRAINT c CHECK (a > 0);')).toEqual(['validating-constraint']);
    expect(rules('ALTER TABLE erp.leads ADD FOREIGN KEY (a) REFERENCES erp.x (id);')).toEqual(['validating-constraint']);
    expect(rules('ALTER TABLE erp.leads DROP COLUMN a;')).toEqual(['destructive']);
    expect(rules('ALTER TABLE erp.leads RENAME COLUMN a TO b;')).toEqual(['rename']);
    expect(rules('CREATE INDEX i ON erp.leads (a);')).toEqual(['blocking-index']);
    expect(rules('DROP TABLE erp.leads;')).toEqual(['destructive']);
    expect(rules('UPDATE erp.leads SET a = 1;')).toEqual(['bulk-write']);
    expect(rules('ALTER TABLE erp.leads\n  ADD COLUMN a text NOT NULL,\n  ADD COLUMN b text;')).toEqual(['not-null-column']);
  });
  it('accepts a stated reason in place of the rule, for that statement only', () => {
    expect(rules('-- allow: blocking-index the table has under 10,000 rows\nCREATE INDEX i ON erp.leads (a);')).toEqual([]);
    expect(rules('-- allow: blocking-index fine\nCREATE INDEX i ON erp.leads (a);\nCREATE INDEX j ON erp.leads (b);')).toEqual(['blocking-index']);
  });
  it(`every migration after ${GRANDFATHERED} follows the rules`, () => {
    const dir = join(import.meta.dirname, '..', '..', 'db', 'migrations');
    const bad = readdirSync(dir).filter((f) => f.endsWith('.sql') && Number(f.slice(0, 4)) > GRANDFATHERED).flatMap((f) => checkMigration(readFileSync(join(dir, f), 'utf8')).map((v) => `${f}:${v.line} ${v.rule}: ${v.why}`));
    expect(bad).toEqual([]);
  });
});

// Builds docs/platform/OneSyncERP-Platform-Guide.html from guide.src.html plus appendices generated from the code, so the lists can never drift:
//   node docs/platform/build-guide.mjs            (then render the PDF with docs/platform/render-pdf.cjs)
// Appendices read: backend/db/migrations, backend/docs/openapi.json, backend/src/modules/identity/permissions.ts, backend/src/config/env.ts,
// control-plane/src/{modules,plans}.ts, docs/platform/capacity-results.json (when present).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const table = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

// ---- migrations and tables
const migDir = join(root, 'backend/db/migrations');
const migrations = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const tablesByMig = [];
let tableCount = 0;
for (const f of migrations) {
  const sql = readFileSync(join(migDir, f), 'utf8');
  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?erp\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  tableCount += tables.length;
  const first = (sql.split('\n').find((l) => l.startsWith('--')) ?? '').replace(/^--\s*/, '').slice(0, 150);
  tablesByMig.push({ file: f, tables, first });
}
const appendixTables = table(['Migration', 'What it adds', 'Tables'], tablesByMig.map((m) => [`<code>${esc(m.file.replace('.sql', ''))}</code>`, esc(m.first), m.tables.length ? m.tables.map((t) => `<code>${t}</code>`).join(' ') : '<span class="n">changes only</span>']), 'small');

// ---- API
const api = JSON.parse(read('backend/docs/openapi.json'));
const ops = [];
for (const [path, item] of Object.entries(api.paths ?? {})) for (const [method, op] of Object.entries(item)) if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) ops.push({ path, method: method.toUpperCase(), tag: (op.tags ?? ['other'])[0], summary: op.summary ?? '' });
const tags = [...new Set(ops.map((o) => o.tag))].sort();
const appendixApi = tags.map((t) => `<h4>${esc(t)} <span class="n">(${ops.filter((o) => o.tag === t).length})</span></h4>` + table(['Method', 'Path', 'Note'], ops.filter((o) => o.tag === t).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)).map((o) => [`<b>${o.method}</b>`, `<code>${esc(o.path)}</code>`, esc(o.summary)]), 'small')).join('\n');

// ---- permissions
const permSrc = read('backend/src/modules/identity/permissions.ts');
const perms = [...(permSrc.match(/export const PERMISSIONS = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);
const permGroups = {};
for (const p of perms) (permGroups[p.split(':')[0]] ??= []).push(p.split(':')[1]);
const appendixPerms = table(['Area', 'Permissions'], Object.entries(permGroups).map(([a, v]) => [`<code>${a}</code>`, v.map((x) => `<code>${x}</code>`).join(' ')]), 'small');

// ---- environment
const envSrc = read('backend/src/config/env.ts');
const envRows = [];
for (const m of envSrc.matchAll(/(?:\/\*\*([\s\S]*?)\*\/\s*)?\n\s+([A-Z][A-Z0-9_]+):\s*z\./g)) envRows.push([`<code>${m[2]}</code>`, esc((m[1] ?? '').replace(/\s+/g, ' ').trim())]);
const appendixEnv = table(['Variable', 'Meaning'], envRows, 'small');

// ---- editions
const planSrc = read('control-plane/src/plans.ts');
const modSrc = read('control-plane/src/modules.ts');
const MODULES = [...(modSrc.match(/MODULES = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
const editions = [...planSrc.matchAll(/\{ id: '(\w+)', plan: '([^']+)', audience: '([^']+)',\s*modules: \[([^\]]*)\], limits: \{([^}]*)\}/g)].map((m) => ({ id: m[1], plan: m[2], audience: m[3], modules: [...m[4].matchAll(/'([a-z]+)'/g)].map((x) => x[1]), limits: m[5].trim() }));
const appendixEditions = table(['Module', ...editions.map((e) => e.plan)], MODULES.map((mod) => [`<code>${mod}</code>`, ...editions.map((e) => (e.modules.includes(mod) ? '<span class="y">●</span>' : '<span class="n">–</span>'))]), 'small')
  + table(['Limit', ...editions.map((e) => e.plan)], ['users', 'companies', 'locations', 'terminals', 'sites'].map((k) => [k, ...editions.map((e) => (e.limits.match(new RegExp(`${k}: (\\d+)`)) ?? [])[1] ?? '')]), 'small');

// ---- capacity
let capacity = '<p class="note">The capacity run has not been recorded in this build of the document.</p>';
const capFile = join(root, 'docs/platform/capacity-results.json');
if (existsSync(capFile)) {
  const c = JSON.parse(readFileSync(capFile, 'utf8'));
  const ms = (r) => `${r.p50} ms`;
  const mp = (r) => `${r.p95} ms`;
  const gb = (b) => (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  capacity = `<p>Measured on ${esc(c.at.slice(0, 10))} (Node ${esc(c.node)}), one machine, PostgreSQL 16, the real API as the real application role with row-level security on.</p>`
    + table(['Setup', 'Value'], [['Clients on the one database', c.setup.clients], ['Journal entries per client', c.setup.entriesPerClient.toLocaleString('en-IN')], ['Entries for the one big client', c.setup.bigClientEntries.toLocaleString('en-IN')], ['Journal lines in total', c.setup.journalLinesTotal.toLocaleString('en-IN')], ['Ledger table size (with indexes)', gb(c.setup.journalLinesBytes)], ['Database size', gb(c.setup.databaseBytes)]])
    + '<h4>The biggest client\'s reports</h4>' + table(['Screen', 'Typical (p50)', 'Slow case (p95)'], Object.entries(c.biggestClient).map(([k, r]) => [esc(k), ms(r), mp(r)]))
    + '<h4>A small client while the big one runs reports back to back</h4>' + table(['Case', 'Typical (p50)', 'Slow case (p95)'], [['Small client alone', ms(c.noisyNeighbour.smallClientAlone), mp(c.noisyNeighbour.smallClientAlone)], [`Small client while the big client runs ${c.noisyNeighbour.concurrentReportLoops} report loops`, ms(c.noisyNeighbour.smallClientWhileBigRunsReports), mp(c.noisyNeighbour.smallClientWhileBigRunsReports)]])
    + `<p>Whole-business export of the biggest client: HTTP ${c.exportBiggestClient.status} in ${c.exportBiggestClient.seconds} s.</p>`;
}

const facts = { tables: tableCount, migrations: migrations.length, routes: ops.length, permissions: perms.length, modules: MODULES.length, env: envRows.length };
let html = readFileSync(join(root, 'docs/platform/guide.src.html'), 'utf8');
const slots = { '{{APPENDIX_EDITIONS}}': appendixEditions, '{{APPENDIX_TABLES}}': appendixTables, '{{APPENDIX_API}}': appendixApi, '{{APPENDIX_PERMS}}': appendixPerms, '{{APPENDIX_ENV}}': appendixEnv, '{{CAPACITY}}': capacity };
for (const [k, v] of Object.entries(slots)) html = html.replace(k, () => v);
for (const [k, v] of Object.entries(facts)) html = html.replaceAll(`{{${k}}}`, String(v));
html = html.replaceAll('{{DATE}}', new Date().toISOString().slice(0, 10));
writeFileSync(join(root, 'docs/platform/OneSyncERP-Platform-Guide.html'), html);
console.log('built', facts);

#!/usr/bin/env node
/**
 * Fills a demo control panel with a believable fleet so every page of the super admin dashboard has something to show.
 *
 * Creates 8 clients across all four editions with their cells (on-premises, dedicated and one shared cloud cell hosting three small shops),
 * remote addresses and rules, licences, reported tenants with usage, validation results, two releases rolling out, and a few things that need
 * attention: a cell with almost no disk, one that has never reported, a business at its user limit, a licence about to expire, a failed check,
 * and a suspended business. It talks to the control plane the way the real agents do, through its normal API.
 *
 * Run it inside the control-plane container's terminal (Dokploy -> service -> Terminal -> control-plane):
 *
 *     CP_EMAIL=you@example.com CP_PASSWORD='your password' node scripts/seed-demo.mjs
 *
 * or from any machine that can reach the dashboard:
 *
 *     CP_URL=https://demo-control.example.com CP_EMAIL=... CP_PASSWORD=... node scripts/seed-demo.mjs
 *
 * Needs an admin account (create one with: CP_PASSWORD=... node --import tsx src/cli.ts create-staff <email> <name> admin).
 * If two-step sign-in is on, add CP_CODE=<6-digit code>. Run it again any time: nothing is duplicated, and it refreshes every cell's "last seen"
 * time, which is how a cell stops looking silent (a real cell reports every minute; the demo cells only report when this runs).
 * Add KEEP_ALIVE=1 to keep it running and report every minute instead.
 */
import { createHash } from 'node:crypto';

const BASE = (process.env.CP_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8090}`).replace(/\/$/, '');
const EMAIL = process.env.CP_EMAIL ?? '';
const PASSWORD = process.env.CP_PASSWORD ?? '';
if (!EMAIL || !PASSWORD) { console.error('Set CP_EMAIL and CP_PASSWORD (an admin account).'); process.exit(2); }

let staffToken = '';
async function call(method, path, body, token = staffToken) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? (method === 'GET' ? {} : { body: '{}' }) : { body: JSON.stringify(body) }) });
  const text = await res.text(); const json = text ? JSON.parse(text) : {};
  if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${json.message ?? text.slice(0, 160)}${json.issues ? ' ' + JSON.stringify(json.issues) : ''}`); e.status = res.status; e.code = json.code; throw e; }
  return json;
}
/** A stable id for a name, so running again finds the same business. */
const idOf = (seed) => { const h = createHash('sha1').update(`onesync-demo:${seed}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

// ---- sign in ----
const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD, ...(process.env.CP_CODE ? { code: process.env.CP_CODE } : {}) }, '');
staffToken = login.token;
if (login.mfaSetupRequired) { console.error('This account must set up two-step sign-in first (open the dashboard and finish that), then run this again.'); process.exit(1); }
console.log(`Signed in as ${login.staff.displayName}`);
const EDITIONS = Object.fromEntries(((await call('GET', '/plans')).items ?? []).map((e) => [e.id, e]));
for (const k of ['starter', 'growth', 'enterprise', 'manufacturing']) if (!EDITIONS[k]) { console.error('This control plane does not know the editions yet (update it first).'); process.exit(1); }

// ---- what to create ----
const HB = { good: { disk: 64, baseMin: 180, walMin: 1, tunnel: true }, lowDisk: { disk: 6, baseMin: 200, walMin: 2, tunnel: true }, staleBackup: { disk: 55, baseMin: 4300, walMin: 90, tunnel: false } };
/** tenant: [slug, name, edition, usage, extra licence tweaks, validation, status] */
const FLEET = [
  { client: 'Sharma General Store', tier: 'hybrid', cell: { code: 'SHARMA-01', name: 'Sharma store server', kind: 'onprem', host: 'sharma', rules: { mode: 'full', allowedNetworks: [], hours: null }, version: '1.3.0', hb: HB.good },
    tenants: [['sharma-store', 'Sharma General Store', 'starter', { users: 2, companies: 1, documents30d: 612, events30d: 2100 }, {}, 'ok']] },
  { client: 'Gupta Kirana', tier: 'local', cell: { code: 'GUPTA-01', name: 'Gupta counter PC', kind: 'onprem', version: '1.2.0', hb: HB.lowDisk },
    tenants: [['gupta-kirana', 'Gupta Kirana', 'starter', { users: 2, companies: 1, documents30d: 340, events30d: 900 }, {}, 'ok']] },
  { client: 'Patel Electronics', tier: 'hybrid', cell: { code: 'PATEL-01', name: 'Patel Electronics server', kind: 'onprem', host: 'patel', rules: { mode: 'readonly', allowedNetworks: ['203.0.113.0/24'], hours: { days: [1, 2, 3, 4, 5, 6], from: '08:00', to: '21:00', timezone: 'Asia/Kolkata' } }, version: '1.3.0', hb: HB.good },
    tenants: [['patel-electronics', 'Patel Electronics', 'growth', { users: 9, companies: 1, documents30d: 1480, events30d: 5200 }, { expiresInDays: 9 }, 'ok']] },
  { client: 'Joshi Hardware', tier: 'local', cell: { code: 'JOSHI-01', name: 'Joshi Hardware server', kind: 'onprem', neverReports: true },
    tenants: [] },
  { client: 'Cloud shops (shared)', tier: 'cloud', cell: { code: 'POOL-MUM', name: 'Pooled cloud, Mumbai', kind: 'pooled', version: '1.3.0', hb: HB.good },
    tenants: [
      ['shree-stores', 'Shree Stores', 'starter', { users: 3, companies: 1, documents30d: 420, events30d: 1300 }, {}, 'ok'],
      ['metro-mobiles', 'Metro Mobiles', 'growth', { users: 6, companies: 1, documents30d: 760, events30d: 2600 }, {}, 'badSeries'],
      ['fresh-mart', 'Fresh Mart', 'starter', { users: 2, companies: 1, documents30d: 280, events30d: 800 }, { suspended: true }, 'ok'],
    ] },
  { client: 'Kulkarni Distributors', tier: 'hybrid_plus', cell: { code: 'KULKARNI-D', name: 'Kulkarni dedicated cloud', kind: 'dedicated', host: 'kulkarni', rules: { mode: 'full', allowedNetworks: [], hours: null }, version: '1.3.0', hb: HB.good },
    tenants: [['kulkarni-distributors', 'Kulkarni Distributors', 'enterprise', { users: 41, companies: 3, documents30d: 5200, events30d: 21000 }, {}, 'ok']] },
  { client: 'Rao Industries', tier: 'hybrid_plus', cell: { code: 'RAO-01', name: 'Rao plant server', kind: 'onprem', host: 'rao', rules: { mode: 'owner_only', allowedNetworks: [], hours: null }, version: '1.2.0', hb: HB.staleBackup },
    tenants: [['rao-industries', 'Rao Industries', 'manufacturing', { users: 58, companies: 2, documents30d: 3900, events30d: 17500 }, {}, 'ok']] },
  { client: 'Bharat Auto Components', tier: 'hybrid_plus', cell: { code: 'BHARAT-D', name: 'Bharat dedicated cloud', kind: 'dedicated', host: 'bharat', rules: { mode: 'full', allowedNetworks: [], hours: null }, version: '1.3.0', hb: HB.good },
    tenants: [['bharat-auto', 'Bharat Auto Components', 'manufacturing', { users: 112, companies: 4, documents30d: 9800, events30d: 40500 }, {}, 'ok']] },
];
const DOMAIN = process.env.REMOTE_DOMAIN ?? 'remote.example.in';

// ---- clients and cells ----
let created = 0; let touched = 0;
const tokens = new Map();
async function pass() {
touched = 0;
const existingClients = (await call('GET', '/clients')).items ?? [];
const fleetNow = (await call('GET', '/fleet')).items ?? [];
for (const f of FLEET) {
  let client = existingClients.find((c) => c.name === f.client);
  if (!client) { client = await call('POST', '/clients', { name: f.client, tier: f.tier }); created++; }
  const c = f.cell;
  let site = fleetNow.find((s) => s.code === c.code);
  const firstTenant = f.tenants.length === 1 ? idOf(f.tenants[0][0]) : undefined;
  if (!site) { site = await call('POST', '/sites', { clientId: client.id, code: c.code, name: c.name, kind: c.kind, ...(firstTenant ? { tenantId: firstTenant } : {}) }); created++; await call('PATCH', `/sites/${site.id}`, { status: 'active' }).catch(() => undefined); }
  if (c.host) await call('PATCH', `/sites/${site.id}`, { hostname: `${c.host}.${DOMAIN}`, remoteAccess: true, remoteRules: { ...c.rules } }).catch((e) => { if (e.code !== 'hostname_taken') throw e; });
  if (c.neverReports) { touched++; continue; }

  // what the agent would send: a heartbeat, then its businesses and their checks
  if (!tokens.has(c.code)) tokens.set(c.code, (await call('POST', `/sites/${site.id}/agent-token`)).token);
  const token = tokens.get(c.code);
  await call('POST', '/agent/heartbeat', { version: c.version, agentVersion: '1.0.0', db: { ok: true }, backup: { lastBaseBackupAt: ago(c.hb.baseMin), lastWalShippedAt: ago(c.hb.walMin), walQueueBytes: 0 }, disk: { freePercent: c.hb.disk }, ...(c.host ? { tunnel: { up: c.hb.tunnel } } : {}), lastUserActivityAt: ago(7) }, token);
  const items = f.tenants.map(([slug, name, ed, usage, tweak]) => {
    const e = EDITIONS[ed];
    return { id: idOf(slug), slug, name, status: tweak.suspended ? 'suspended' : 'active', createdAt: ago(60 * 24 * 90), usage: { ...usage, lastActivityAt: ago(11) },
      licence: { restricted: true, plan: e.plan, modules: e.modules, limits: e.limits, readOnly: tweak.suspended === true, expiresAt: tweak.expiresInDays ? inDays(tweak.expiresInDays) : inDays(300) } };
  });
  await call('POST', '/agent/tenants', { items }, token);
  for (const [slug, , , , , check] of f.tenants) {
    const bad = check === 'badSeries';
    await call('POST', '/agent/validations', { tenantId: idOf(slug), at: ago(40), ok: !bad, checks: [
      { key: 'tenant_active', label: 'Business is active', status: 'pass', detail: 'ok' }, { key: 'owner_exists', label: 'Has an active owner', status: 'pass', detail: 'ok' },
      { key: 'ledger_balanced', label: 'Ledger balances', status: 'pass', detail: 'ok' }, { key: 'entries_match_lines', label: 'Every entry matches its lines', status: 'pass', detail: 'ok' },
      { key: 'fiscal_year_current', label: 'Financial year covers today', status: 'pass', detail: 'ok' },
      bad ? { key: 'invoice_series', label: "Every GST registration has this year's tax-invoice series", status: 'fail', detail: '1 of 1 missing a series: invoicing will fail' } : { key: 'invoice_series', label: "Every GST registration has this year's tax-invoice series", status: 'pass', detail: 'ok' },
    ] }, token);
    // a licence on record at the control plane, from the edition (skipped when the business already has one)
    const ed = f.tenants.find((t) => t[0] === slug)[2]; const e = EDITIONS[ed];
    const have = (await call('GET', `/tenants/${idOf(slug)}`)).licences ?? [];
    if (have.length === 0) await call('POST', `/tenants/${idOf(slug)}/licences`, { plan: e.plan, modules: e.modules, limits: e.limits, graceDays: 14 }).catch(() => undefined);
  }
  touched++;
}
}
await pass();
console.log(`Fleet: ${FLEET.length} clients, ${created} new records, ${touched} cells refreshed`);

// ---- releases rolling out ----
const digest = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const have = (await call('GET', '/releases')).items ?? [];
for (const [version, notes, rings] of [['1.2.0', 'Stable: fixes for the counter and GST returns', 3], ['1.3.0', 'Edition support, faster invoices, owner dashboard', 3], ['1.4.0', 'Candidate: manufacturing costing improvements', 1]]) {
  if (have.some((r) => r.version === version)) continue;
  const r = await call('POST', '/releases', { version, notes, images: [{ name: 'api', digest: digest(`api-${version}`) }, { name: 'agent', digest: digest(`agent-${version}`) }], migrationDigest: digest(`mig-${version}`) });
  for (let i = 0; i < rings; i++) await call('POST', `/releases/${r.id}/promote`).catch(() => undefined);
  created++;
}
console.log(`Releases: ${((await call('GET', '/releases')).items ?? []).map((r) => `${r.version} (${r.status})`).join(', ')}`);

const o = await call('GET', '/overview');
console.log(`\nDone. The dashboard now shows ${o.cells.total} cells and ${o.tenants.total} businesses; ${o.alerts.critical} critical and ${o.alerts.attention} needing attention.`);
console.log(`Open ${BASE}/ui${process.env.KEEP_ALIVE ? '' : '. Cells show "last seen" as of now: run this again later to refresh, or use KEEP_ALIVE=1.'}`);
if (process.env.KEEP_ALIVE) { console.log('Keeping the demo cells alive (reporting every minute). Ctrl+C to stop.'); for (;;) { await new Promise((r) => setTimeout(r, 60_000)); try { await pass(); } catch (e) { console.error(e.message); } } }

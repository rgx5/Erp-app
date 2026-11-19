import { randomUUID, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { Config } from './config.js';
import { publicKeyOf, randomToken, sha256, signDocument } from './crypto.js';
import type { Db } from './db.js';
import { compareVersions, judge, type Heartbeat } from './fleet.js';
import { LIMIT_KEYS, MODULES, moduleProblem } from './modules.js';
import { SecretBox } from './secret-box.js';
import { generateTotpSecret, verifyTotp } from './totp.js';
import { mfaRequired } from './config.js';
import { sealToEscrow } from './escrow.js';

class HttpError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) { super(message); } }
type Role = 'admin' | 'support' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, support: 2, admin: 3 };
interface Staff { id: string; email: string; displayName: string; role: Role }
declare module 'fastify' { interface FastifyRequest { staff?: Staff & { mfaEnabled: boolean }; agentSite?: { id: string; tenantId: string | null; ring: number; updatesPaused: boolean; maintenanceWindow: unknown; tier: string } } }

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const iso = z.iso.datetime({ offset: true });
const uuid = z.uuid();
const parse = <T>(schema: z.ZodType<T>, data: unknown): T => schema.parse(data);

const schemas = {
  login: z.strictObject({ email: z.string().email(), password: z.string().min(1), code: z.string().min(6).max(20).optional() }),
  code: z.strictObject({ code: z.string().min(6).max(20) }),
  staff: z.strictObject({ email: z.string().email(), displayName: z.string().trim().min(1).max(100), password: z.string().min(12).max(200), role: z.enum(['admin', 'support', 'viewer']) }),
  client: z.strictObject({ name: z.string().trim().min(1).max(150), tier: z.enum(['local', 'hybrid', 'hybrid_plus', 'cloud']), contact: z.record(z.string(), z.string()).default({}), notes: z.string().max(2000).optional() }),
  site: z.strictObject({ clientId: uuid, code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/), name: z.string().trim().min(1).max(150), kind: z.enum(['onprem', 'dedicated', 'pooled']).default('onprem'), tenantId: uuid.optional(), ring: z.number().int().min(0).max(2).default(2) }),
  siteUpdate: z.strictObject({ name: z.string().trim().min(1).max(150).optional(), status: z.enum(['planned', 'installed', 'active', 'suspended', 'retired']).optional(), tenantId: uuid.nullable().optional(), ring: z.number().int().min(0).max(2).optional(), updatesPaused: z.boolean().optional(),
    hostname: z.string().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/, 'A host name such as pune.remote.example.in').nullable().optional(), remoteAccess: z.boolean().optional(),
    maintenanceWindow: z.strictObject({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), startHour: z.number().int().min(0).max(23), durationHours: z.number().int().min(1).max(12), timezone: z.string().min(1).max(60) }).optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field'),
  licence: z.strictObject({ plan: z.string().trim().min(1).max(60), modules: z.array(z.enum(MODULES)).max(20), limits: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int().min(0).max(1_000_000)).default({}), readOnly: z.boolean().default(false), expiresAt: iso.nullable().optional(), graceDays: z.number().int().min(0).max(365).default(14) }),
  support: z.strictObject({ reason: z.string().trim().min(5).max(300), minutes: z.number().int().min(5).max(120), publicKey: z.string().regex(/^(ssh-ed25519|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{20,600}( [^\s]{1,80})?$/, 'An ssh-ed25519 or ecdsa-sha2-nistp256 public key') }),
  supportCode: z.strictObject({ code: z.string().regex(/^\d{6}$/, 'The six digits the customer reads out') }),
  supportState: z.strictObject({ state: z.enum(['awaiting_code', 'open', 'closed', 'refused']), expiresAt: iso.optional(), codeRejected: z.boolean().optional() }),
  revoke: z.strictObject({ reason: z.string().trim().min(3).max(300) }),
  release: z.strictObject({ version: z.string().regex(/^\d+\.\d+\.\d+$/), images: z.array(z.strictObject({ name: z.string().min(1).max(100), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) })).min(1).max(20), migrationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/), minClientVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(), maxClientVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(), notes: z.string().max(4000).default('') }),
  heartbeat: z.looseObject({ version: z.string().max(40).optional(), agentVersion: z.string().max(40).optional(),
    db: z.looseObject({ ok: z.boolean().optional(), replicationLagSeconds: z.number().nullable().optional() }).optional(),
    backup: z.looseObject({ lastBaseBackupAt: iso.nullable().optional(), lastWalShippedAt: iso.nullable().optional(), walQueueBytes: z.number().int().min(0).optional() }).optional(),
    disk: z.looseObject({ freePercent: z.number().min(0).max(100).optional() }).optional(), tunnel: z.looseObject({ up: z.boolean().optional() }).optional(), lastUserActivityAt: iso.nullable().optional() }),
};

export interface AppDeps { pool: Db; config: Config }
export function buildApp({ pool, config }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: config.NODE_ENV === 'test' ? false : { level: 'info' }, bodyLimit: 256 * 1024 });
  const box = new SecretBox(config.DATA_ENCRYPTION_KEY ? Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64') : Buffer.alloc(32, 7)); // a fixed key only outside production, where the config requires a real one
  const mustHaveMfa = mfaRequired(config);
  const licencePublic = publicKeyOf(config.LICENCE_PRIVATE_KEY);
  const releasePublic = publicKeyOf(config.RELEASE_PRIVATE_KEY);

  app.setErrorHandler((e: unknown, _req, reply) => {
    if (e instanceof HttpError) return reply.status(e.status).send({ code: e.code, message: e.message, ...e.extra });
    if (e instanceof ZodError) return reply.status(422).send({ code: 'validation_failed', message: 'The request is not valid', issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const status = (e as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ code: 'bad_request', message: (e as Error).message });
    app.log.error(e);
    return reply.status(500).send({ code: 'internal_error', message: 'Something went wrong' });
  });

  const audit = async (req: FastifyRequest, action: string, entity: string | null, entityId: string | null, details: Record<string, unknown> = {}) => {
    await pool.query('INSERT INTO staff_audit (staff_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)', [req.staff?.id ?? null, action, entity, entityId, details]);
  };

  /** Staff routes: a bearer session token, and at least the given role. */
  const asStaff = (min: Role, o: { allowSetup?: boolean } = {}) => async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ') || h.length < 20) throw new HttpError(401, 'unauthorized', 'Sign in first');
    const r = await pool.query<{ id: string; email: string; display_name: string; role: Role; mfa_enabled: boolean }>(
      `SELECT u.id, u.email, u.display_name, u.role, u.mfa_enabled FROM staff_sessions s JOIN staff_users u ON u.id = s.staff_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [sha256(h.slice(7).trim())]);
    const row = r.rows[0];
    if (!row) throw new HttpError(401, 'unauthorized', 'The session has ended: sign in again');
    if (RANK[row.role] < RANK[min]) throw new HttpError(403, 'forbidden', 'Your role does not allow this');
    if (mustHaveMfa && !row.mfa_enabled && !o.allowSetup) throw new HttpError(403, 'mfa_setup_required', 'Set up two-step sign-in before doing anything else');
    req.staff = { id: row.id, email: row.email, displayName: row.display_name, role: row.role, mfaEnabled: row.mfa_enabled };
  };

  /** Agent routes: the site's own token, `cpa_<siteId>_<secret>`. */
  const asAgent = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const m = /^cpa_([0-9a-fA-F-]{36})_(.{20,})$/.exec(token); // the secret may itself contain underscores
    const fail = new HttpError(401, 'unauthorized', 'The agent token is not valid');
    const siteId = m?.[1]; const secret = m?.[2];
    if (!siteId || !secret || !uuid.safeParse(siteId).success) throw fail;
    const r = await pool.query<{ id: string; tenant_id: string | null; ring: number; updates_paused: boolean; maintenance_window: unknown; agent_token_hash: Buffer | null; status: string; tier: string }>(
      'SELECT s.id, s.tenant_id, s.ring, s.updates_paused, s.maintenance_window, s.agent_token_hash, s.status, c.tier FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.id = $1', [siteId]);
    const row = r.rows[0];
    const presented = sha256(secret);
    const matches = timingSafeEqual(presented, row?.agent_token_hash ?? Buffer.alloc(32)); // compared even when unknown, so timing does not reveal which sites exist
    if (!row || !matches || row.status === 'retired') throw fail;
    req.agentSite = { id: row.id, tenantId: row.tenant_id, ring: row.ring, updatesPaused: row.updates_paused, maintenanceWindow: row.maintenance_window, tier: row.tier };
  };

  // ---- public ---------------------------------------------------------------------------------------------------
  app.get('/health', async () => ({ ok: true }));
  /** The public keys that servers and agents trust. Safe to publish. */
  app.get('/keys', async () => ({ licencePublicKey: licencePublic, releasePublicKey: releasePublic }));

  // ---- staff sign-in --------------------------------------------------------------------------------------------
  app.post('/auth/login', async (req, reply) => {
    const body = parse(schemas.login, req.body);
    const r = await pool.query<{ id: string; password_hash: string; status: string; failed_logins: number; locked_until: Date | null; role: Role; display_name: string; email: string; mfa_enabled: boolean; mfa_secret_enc: string | null; mfa_last_step: string | null }>('SELECT * FROM staff_users WHERE lower(email) = lower($1)', [body.email]);
    const u = r.rows[0];
    if (u?.locked_until && u.locked_until > new Date()) throw new HttpError(429, 'locked', `Too many wrong passwords or codes: try again in ${LOCK_MINUTES} minutes`);
    const good = u ? await verify(u.password_hash, body.password).catch(() => false) : (await verify('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Yrn+mCUKFJFd3YbJdcUQ9dbaSdEDT4nVBXOoThgTJnY', body.password).catch(() => false), false);
    const fail = async () => {
      if (u) await pool.query('UPDATE staff_users SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END, locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END WHERE id = $1', [u.id, MAX_FAILS, LOCK_MINUTES]);
    };
    if (!u || !good || u.status !== 'active') { await fail(); throw new HttpError(401, 'invalid_credentials', 'The email or password is wrong'); }
    if (u.mfa_enabled) {
      if (!body.code) throw new HttpError(401, 'mfa_required', 'Enter the code from your authenticator app');
      if (!(await acceptSecondFactor(u.id, u.mfa_secret_enc as string, u.mfa_last_step, body.code))) { await fail(); throw new HttpError(401, 'invalid_code', 'That code is not valid'); }
    }
    await pool.query('UPDATE staff_users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
    const token = randomToken();
    await pool.query('INSERT INTO staff_sessions (token_hash, staff_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))', [sha256(token), u.id, config.SESSION_HOURS]);
    req.staff = { id: u.id, email: u.email, displayName: u.display_name, role: u.role, mfaEnabled: u.mfa_enabled };
    await audit(req, 'staff.login', 'staff', u.id);
    return reply.send({ token, expiresInHours: config.SESSION_HOURS, mfaSetupRequired: mustHaveMfa && !u.mfa_enabled, staff: { id: u.id, email: u.email, displayName: u.display_name, role: u.role } });
  });

  /** A TOTP code (each step usable once) or a recovery code (each usable once). */
  const acceptSecondFactor = async (staffId: string, sealed: string, lastStep: string | null, code: string): Promise<boolean> => {
    const secret = box.open(sealed, `staff:${staffId}`);
    const step = verifyTotp(secret, code);
    if (step !== undefined) {
      if (lastStep !== null && step <= Number(lastStep)) return false; // already used: a replayed code
      await pool.query('UPDATE staff_users SET mfa_last_step = $2 WHERE id = $1', [staffId, step]);
      return true;
    }
    const used = await pool.query('UPDATE staff_recovery_codes SET used_at = now() WHERE staff_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id', [staffId, sha256(code.replaceAll('-', '').toLowerCase())]);
    return used.rowCount === 1;
  };
  app.post('/auth/mfa/enrol', { preHandler: asStaff('viewer', { allowSetup: true }) }, async (req) => {
    const staff = req.staff as NonNullable<FastifyRequest['staff']>;
    if (staff.mfaEnabled) throw new HttpError(409, 'mfa_enabled', 'Two-step sign-in is already on');
    const secret = generateTotpSecret();
    await pool.query('UPDATE staff_users SET mfa_secret_enc = $2 WHERE id = $1', [staff.id, box.seal(secret, `staff:${staff.id}`)]);
    return { secret, otpauthUri: `otpauth://totp/OneSyncERP%20Control%20Plane:${encodeURIComponent(staff.email)}?secret=${secret}&issuer=OneSyncERP%20Control%20Plane` };
  });
  app.post('/auth/mfa/activate', { preHandler: asStaff('viewer', { allowSetup: true }) }, async (req) => {
    const staff = req.staff as NonNullable<FastifyRequest['staff']>;
    const { code } = parse(schemas.code, req.body);
    const row = (await pool.query<{ mfa_secret_enc: string | null }>('SELECT mfa_secret_enc FROM staff_users WHERE id = $1', [staff.id])).rows[0];
    if (!row?.mfa_secret_enc) throw new HttpError(409, 'no_enrolment', 'Start the set-up first');
    const step = verifyTotp(box.open(row.mfa_secret_enc, `staff:${staff.id}`), code);
    if (step === undefined) throw new HttpError(422, 'invalid_code', 'That code is not valid');
    const codes = Array.from({ length: 8 }, () => randomToken(6).replace(/[^a-z0-9]/gi, 'x').slice(0, 8).toLowerCase());
    await pool.query('UPDATE staff_users SET mfa_enabled = true, mfa_last_step = $2 WHERE id = $1', [staff.id, step]);
    await pool.query('DELETE FROM staff_recovery_codes WHERE staff_id = $1', [staff.id]);
    for (const c of codes) await pool.query('INSERT INTO staff_recovery_codes (staff_id, code_hash) VALUES ($1, $2)', [staff.id, sha256(c)]);
    await audit(req, 'staff.mfa_enabled', 'staff', staff.id);
    return { enabled: true, recoveryCodes: codes };
  });
  /** An admin can turn off another person's two-step sign-in (for a lost phone), which they must then set up again. */
  app.post<{ Params: { id: string } }>('/staff/:id/mfa/reset', { preHandler: asStaff('admin') }, async (req) => {
    const id = parse(uuid, req.params.id);
    const r = await pool.query('UPDATE staff_users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_last_step = NULL WHERE id = $1 RETURNING id', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'No such staff member');
    await pool.query('UPDATE staff_sessions SET revoked_at = now() WHERE staff_id = $1 AND revoked_at IS NULL', [id]);
    await audit(req, 'staff.mfa_reset', 'staff', id);
    return { reset: true };
  });
  app.post('/auth/logout', { preHandler: asStaff('viewer', { allowSetup: true }) }, async (req, reply) => {
    await pool.query('UPDATE staff_sessions SET revoked_at = now() WHERE token_hash = $1', [sha256((req.headers.authorization as string).slice(7).trim())]);
    return reply.status(204).send();
  });
  app.get('/me', { preHandler: asStaff('viewer', { allowSetup: true }) }, async (req) => req.staff);
  app.post('/staff', { preHandler: asStaff('admin') }, async (req, reply) => {
    const b = parse(schemas.staff, req.body);
    const id = randomUUID();
    try { await pool.query('INSERT INTO staff_users (id, email, display_name, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [id, b.email, b.displayName, await hash(b.password), b.role]); }
    catch (e) { if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'staff_exists', 'A staff member with that email already exists'); throw e; }
    await audit(req, 'staff.created', 'staff', id, { email: b.email, role: b.role });
    return reply.status(201).send({ id, email: b.email, displayName: b.displayName, role: b.role });
  });

  // ---- clients and sites ----------------------------------------------------------------------------------------
  app.get('/clients', { preHandler: asStaff('viewer') }, async () => ({ items: (await pool.query('SELECT id, name, tier, status, contact, notes, created_at FROM clients ORDER BY created_at')).rows }));
  app.post('/clients', { preHandler: asStaff('support') }, async (req, reply) => {
    const b = parse(schemas.client, req.body);
    const id = randomUUID();
    await pool.query('INSERT INTO clients (id, name, tier, contact, notes) VALUES ($1, $2, $3, $4, $5)', [id, b.name, b.tier, b.contact, b.notes ?? null]);
    await audit(req, 'client.created', 'client', id, { name: b.name, tier: b.tier });
    return reply.status(201).send({ id, name: b.name, tier: b.tier, status: 'active' });
  });
  app.post('/sites', { preHandler: asStaff('support') }, async (req, reply) => {
    const b = parse(schemas.site, req.body);
    const id = randomUUID();
    try { await pool.query('INSERT INTO sites (id, client_id, code, name, kind, tenant_id, ring) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, b.clientId, b.code, b.name, b.kind, b.tenantId ?? null, b.ring]); }
    catch (e) { const c = (e as { code?: string }).code; if (c === '23505') throw new HttpError(409, 'site_exists', 'A site with that code already exists'); if (c === '23503') throw new HttpError(404, 'client_not_found', 'No such client'); throw e; }
    await audit(req, 'site.created', 'site', id, { code: b.code, clientId: b.clientId });
    return reply.status(201).send({ id, code: b.code, name: b.name, status: 'planned' });
  });
  app.patch<{ Params: { id: string } }>('/sites/:id', { preHandler: asStaff('support') }, async (req) => {
    const id = parse(uuid, req.params.id); const b = parse(schemas.siteUpdate, req.body);
    const cols: [string, unknown][] = [];
    if (b.name !== undefined) cols.push(['name', b.name]); if (b.status !== undefined) cols.push(['status', b.status]); if (b.tenantId !== undefined) cols.push(['tenant_id', b.tenantId]);
    if (b.ring !== undefined) cols.push(['ring', b.ring]); if (b.updatesPaused !== undefined) cols.push(['updates_paused', b.updatesPaused]); if (b.maintenanceWindow !== undefined) cols.push(['maintenance_window', b.maintenanceWindow]);
    if (b.hostname !== undefined) cols.push(['hostname', b.hostname]); if (b.remoteAccess !== undefined) cols.push(['remote_access', b.remoteAccess]);
    const r = await pool.query(`UPDATE sites SET ${cols.map(([c], i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id, code, name, status, tenant_id, ring, updates_paused, maintenance_window, hostname, remote_access`, [id, ...cols.map(([, v]) => v)]).catch((e: { code?: string }) => { if (e.code === '23505') throw new HttpError(409, 'hostname_taken', 'Another site already uses that address'); throw e; });
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'No such site');
    await audit(req, 'site.updated', 'site', id, { fields: cols.map(([c]) => c) });
    return r.rows[0];
  });
  /** Issues (or replaces) the site's agent token. Shown once; only its hash is kept. */
  app.post<{ Params: { id: string } }>('/sites/:id/agent-token', { preHandler: asStaff('admin') }, async (req) => {
    const id = parse(uuid, req.params.id);
    const secret = randomToken();
    const r = await pool.query('UPDATE sites SET agent_token_hash = $2 WHERE id = $1 RETURNING id', [id, sha256(secret)]);
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'No such site');
    await audit(req, 'site.agent_token_issued', 'site', id);
    return { token: `cpa_${id}_${secret}` };
  });

  // ---- the fleet ------------------------------------------------------------------------------------------------
  const fleet = async () => {
    const r = await pool.query<{ id: string; code: string; name: string; status: string; kind: string; ring: number; updates_paused: boolean; tenant_id: string | null; client_id: string; client_name: string; tier: string; last_seen_at: Date | null; version: string | null; payload: Heartbeat | null; licence: { plan?: string; modules?: string[]; expiresAt?: string | null; readOnly?: boolean } | null; licence_id: string | null }>(
      `SELECT s.id, s.code, s.name, s.status, s.kind, s.ring, s.updates_paused, s.tenant_id, c.id AS client_id, c.name AS client_name, c.tier, st.last_seen_at, st.version, st.payload,
              (SELECT l.licence FROM licences l WHERE l.site_id = s.id AND l.revoked_at IS NULL ORDER BY l.issued_at DESC LIMIT 1) AS licence,
              (SELECT l.licence_id FROM licences l WHERE l.site_id = s.id AND l.revoked_at IS NULL ORDER BY l.issued_at DESC LIMIT 1) AS licence_id
         FROM sites s JOIN clients c ON c.id = s.client_id LEFT JOIN site_status st ON st.site_id = s.id WHERE s.status <> 'retired' ORDER BY c.name, s.code`);
    return r.rows.map((s) => ({
      id: s.id, code: s.code, name: s.name, status: s.status, kind: s.kind, ring: s.ring, updatesPaused: s.updates_paused, tenantId: s.tenant_id, client: { id: s.client_id, name: s.client_name, tier: s.tier },
      lastSeenAt: s.last_seen_at?.toISOString() ?? null, version: s.version,
      health: judge({ lastSeenAt: s.last_seen_at, heartbeat: s.payload, tier: s.tier, silentAfterMinutes: config.SILENT_AFTER_MINUTES }),
      licence: s.licence ? { licenceId: s.licence_id, plan: s.licence.plan ?? null, modules: s.licence.modules ?? [], expiresAt: s.licence.expiresAt ?? null, readOnly: s.licence.readOnly === true } : null,
    }));
  };
  app.get('/fleet', { preHandler: asStaff('viewer') }, async (req) => {
    const q = z.object({ state: z.enum(['healthy', 'degraded', 'silent', 'never']).optional(), tier: z.string().optional() }).parse(req.query);
    const items = (await fleet()).filter((s) => (!q.state || s.health.state === q.state) && (!q.tier || s.client.tier === q.tier));
    const summary = { healthy: 0, degraded: 0, silent: 0, never: 0 };
    for (const s of items) summary[s.health.state]++;
    return { summary, items };
  });
  app.get<{ Params: { id: string } }>('/sites/:id', { preHandler: asStaff('viewer') }, async (req) => {
    const id = parse(uuid, req.params.id);
    const site = (await fleet()).find((s) => s.id === id);
    if (!site) throw new HttpError(404, 'not_found', 'No such site');
    const recent = (await pool.query('SELECT received_at, payload FROM heartbeats WHERE site_id = $1 ORDER BY received_at DESC LIMIT 20', [id])).rows;
    return { ...site, recentHeartbeats: recent };
  });

  // ---- licences -------------------------------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/sites/:id/licences', { preHandler: asStaff('admin') }, async (req, reply) => {
    const id = parse(uuid, req.params.id); const b = parse(schemas.licence, req.body);
    const problem = moduleProblem(b.modules);
    if (problem) throw new HttpError(422, 'module_dependency', problem);
    const site = (await pool.query<{ code: string; tenant_id: string | null }>('SELECT code, tenant_id FROM sites WHERE id = $1', [id])).rows[0];
    if (!site) throw new HttpError(404, 'not_found', 'No such site');
    if (!site.tenant_id) throw new HttpError(409, 'no_tenant', 'Set the site\'s tenant id before issuing a licence: a licence is bound to one tenant');
    const n = Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM licences WHERE site_id = $1', [id])).rows[0]?.n) + 1;
    const licence = { licenceId: `LIC-${site.code.toUpperCase()}-${String(n).padStart(3, '0')}`, tenantId: site.tenant_id, plan: b.plan, modules: [...b.modules].sort(), limits: b.limits, readOnly: b.readOnly, expiresAt: b.expiresAt ?? null, graceDays: b.graceDays, issuedAt: new Date().toISOString() };
    const signature = signDocument(licence, config.LICENCE_PRIVATE_KEY);
    await pool.query('INSERT INTO licences (id, site_id, licence_id, licence, signature, issued_by) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), id, licence.licenceId, licence, signature, req.staff?.id]);
    await audit(req, 'licence.issued', 'site', id, { licenceId: licence.licenceId, plan: b.plan, modules: licence.modules });
    return reply.status(201).send({ licence, signature });
  });
  app.get<{ Params: { id: string } }>('/sites/:id/licences', { preHandler: asStaff('viewer') }, async (req) => ({ items: (await pool.query('SELECT licence_id, licence, signature, issued_at, revoked_at, revoked_reason FROM licences WHERE site_id = $1 ORDER BY issued_at DESC', [parse(uuid, req.params.id)])).rows }));
  app.post<{ Params: { licenceId: string } }>('/licences/:licenceId/revoke', { preHandler: asStaff('admin') }, async (req) => {
    const b = parse(schemas.revoke, req.body);
    const r = await pool.query('UPDATE licences SET revoked_at = now(), revoked_reason = $2 WHERE licence_id = $1 AND revoked_at IS NULL RETURNING site_id', [req.params.licenceId, b.reason]);
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'No such active licence');
    await audit(req, 'licence.revoked', 'licence', req.params.licenceId, { reason: b.reason });
    return { revoked: true };
  });

  // ---- releases -------------------------------------------------------------------------------------------------
  app.post('/releases', { preHandler: asStaff('admin') }, async (req, reply) => {
    const b = parse(schemas.release, req.body);
    const manifest = { version: b.version, images: b.images, migrationDigest: b.migrationDigest, minClientVersion: b.minClientVersion ?? null, maxClientVersion: b.maxClientVersion ?? null, notes: b.notes, createdAt: new Date().toISOString() };
    const id = randomUUID();
    try { await pool.query('INSERT INTO releases (id, version, manifest, signature, created_by) VALUES ($1, $2, $3, $4, $5)', [id, b.version, manifest, signDocument(manifest, config.RELEASE_PRIVATE_KEY), req.staff?.id]); }
    catch (e) { if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'release_exists', 'That version already exists'); throw e; }
    await audit(req, 'release.created', 'release', id, { version: b.version });
    return reply.status(201).send({ id, version: b.version, status: 'draft' });
  });
  app.get('/releases', { preHandler: asStaff('viewer') }, async () => ({ items: (await pool.query('SELECT id, version, status, open_ring, manifest, created_at FROM releases ORDER BY created_at DESC')).rows }));
  /** Opens a release to the next ring: ring 0 (your own site) first, then 1 (friendly sites), then 2 (everyone). */
  app.post<{ Params: { id: string } }>('/releases/:id/promote', { preHandler: asStaff('admin') }, async (req) => {
    const id = parse(uuid, req.params.id);
    const r = await pool.query<{ status: string; open_ring: number | null; version: string }>('SELECT status, open_ring, version FROM releases WHERE id = $1', [id]);
    const rel = r.rows[0];
    if (!rel) throw new HttpError(404, 'not_found', 'No such release');
    if (rel.status === 'withdrawn') throw new HttpError(409, 'withdrawn', 'A withdrawn release cannot be promoted');
    const next = rel.open_ring === null ? 0 : rel.open_ring + 1;
    if (next > 2) throw new HttpError(409, 'fully_released', 'This release is already open to every ring');
    await pool.query("UPDATE releases SET status = 'rolling', open_ring = $2 WHERE id = $1", [id, next]);
    await audit(req, 'release.promoted', 'release', id, { version: rel.version, ring: next });
    return { version: rel.version, openRing: next };
  });
  app.post<{ Params: { id: string } }>('/releases/:id/withdraw', { preHandler: asStaff('admin') }, async (req) => {
    const b = parse(schemas.revoke, req.body);
    const r = await pool.query("UPDATE releases SET status = 'withdrawn' WHERE id = $1 RETURNING version", [parse(uuid, req.params.id)]);
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'No such release');
    await audit(req, 'release.withdrawn', 'release', req.params.id, { reason: b.reason });
    return { withdrawn: true };
  });

  // ---- what a site's agent calls --------------------------------------------------------------------------------
  app.post('/agent/heartbeat', { preHandler: asAgent }, async (req, reply) => {
    const body = parse(schemas.heartbeat, req.body) as Heartbeat;
    const site = req.agentSite as NonNullable<FastifyRequest['agentSite']>;
    await pool.query('INSERT INTO heartbeats (site_id, payload) VALUES ($1, $2)', [site.id, body]);
    await pool.query('INSERT INTO site_status (site_id, last_seen_at, version, payload) VALUES ($1, now(), $2, $3) ON CONFLICT (site_id) DO UPDATE SET last_seen_at = now(), version = EXCLUDED.version, payload = EXCLUDED.payload', [site.id, body.version ?? null, body]);
    await pool.query("UPDATE sites SET status = 'active' WHERE id = $1 AND status IN ('planned', 'installed')", [site.id]);
    return reply.send({ ok: true, serverTime: new Date().toISOString() });
  });
  /** The newest signed licence for this site (or 404). The agent hands it to the site's server to import. */
  app.get('/agent/licence', { preHandler: asAgent }, async (req) => {
    const site = req.agentSite as NonNullable<FastifyRequest['agentSite']>;
    const l = (await pool.query<{ licence: unknown; signature: string }>('SELECT licence, signature FROM licences WHERE site_id = $1 AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1', [site.id])).rows[0];
    if (!l) throw new HttpError(404, 'no_licence', 'No licence has been issued for this site');
    return { licence: l.licence, signature: l.signature, tenantId: site.tenantId };
  });
  /** The release this site should move to: the newest one open to its ring and newer than what it runs. Nothing while updates are paused. */
  app.get('/agent/release', { preHandler: asAgent }, async (req) => {
    const site = req.agentSite as NonNullable<FastifyRequest['agentSite']>;
    const current = z.object({ current: z.string().regex(/^\d+\.\d+\.\d+$/).optional() }).parse(req.query).current;
    if (site.updatesPaused) return { release: null, reason: 'updates_paused', maintenanceWindow: site.maintenanceWindow };
    const rows = (await pool.query<{ manifest: { version: string }; signature: string }>("SELECT manifest, signature FROM releases WHERE status = 'rolling' AND open_ring >= $1", [site.ring])).rows;
    const best = rows.filter((r) => !current || compareVersions(r.manifest.version, current) > 0).sort((a, b) => compareVersions(b.manifest.version, a.manifest.version))[0];
    return best ? { release: { manifest: best.manifest, signature: best.signature }, maintenanceWindow: site.maintenanceWindow } : { release: null, reason: 'up_to_date', maintenanceWindow: site.maintenanceWindow };
  });

  // ---- the gateway ----------------------------------------------------------------------------------------------
  /** The gateway asks, for each tunnel that connects and every minute after: may this site's tunnel stay up, and under what address? */
  app.post('/gateway/verify', async (req) => {
    const h = req.headers.authorization;
    const given = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!config.GATEWAY_TOKEN || !timingSafeEqual(sha256(given), sha256(config.GATEWAY_TOKEN))) throw new HttpError(401, 'unauthorized', 'The gateway token is not valid');
    const { token } = z.object({ token: z.string().min(20).max(300) }).parse(req.body);
    const m = /^cpa_([0-9a-fA-F-]{36})_(.{20,})$/.exec(token);
    const siteId = m?.[1]; const secret = m?.[2];
    const refuse = (code: string, message: string) => new HttpError(403, code, message);
    if (!siteId || !secret || !uuid.safeParse(siteId).success) throw refuse('denied', 'The site token is not valid');
    const r = (await pool.query<{ id: string; hostname: string | null; remote_access: boolean; status: string; agent_token_hash: Buffer | null; tier: string; client_status: string }>(
      'SELECT s.id, s.hostname, s.remote_access, s.status, s.agent_token_hash, c.tier, c.status AS client_status FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.id = $1', [siteId])).rows[0];
    const matches = timingSafeEqual(sha256(secret), r?.agent_token_hash ?? Buffer.alloc(32));
    if (!r || !matches || r.status === 'retired') throw refuse('denied', 'The site token is not valid');
    if (!r.hostname) throw refuse('no_address', 'This site has no remote address');
    if (!r.remote_access || !['hybrid', 'hybrid_plus'].includes(r.tier) || r.client_status !== 'active') throw refuse('remote_access_off', 'Remote access is not available for this site');
    return { siteId: r.id, hostname: r.hostname, tier: r.tier };
  });

  // ---- backup keys ----------------------------------------------------------------------------------------------
  /** Makes a site's backup key. It is returned ONCE (for the installer to put on the site) and stored only sealed to the escrow key, which needs two custodians to open. */
  app.post<{ Params: { id: string } }>('/sites/:id/backup-key', { preHandler: asStaff('admin') }, async (req, reply) => {
    const id = parse(uuid, req.params.id);
    const { rotate } = z.object({ rotate: z.boolean().optional() }).parse(req.body ?? {});
    if (!config.ESCROW_PUBLIC_KEY) throw new HttpError(409, 'escrow_not_configured', 'No escrow public key is configured, so backup keys cannot be made');
    const site = (await pool.query('SELECT 1 FROM sites WHERE id = $1', [id])).rows[0];
    if (!site) throw new HttpError(404, 'not_found', 'No such site');
    const last = Number((await pool.query<{ v: number | null }>('SELECT max(version) AS v FROM backup_keys WHERE site_id = $1', [id])).rows[0]?.v ?? 0);
    if (last > 0 && !rotate) throw new HttpError(409, 'key_exists', 'This site already has a backup key. A new key starts a new backup set: send {"rotate": true} to make one');
    const passphrase = randomToken(32);
    await pool.query('INSERT INTO backup_keys (id, site_id, version, sealed, created_by) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), id, last + 1, sealToEscrow(passphrase, config.ESCROW_PUBLIC_KEY), req.staff?.id]);
    await audit(req, 'backup_key.created', 'site', id, { version: last + 1, rotated: last > 0 });
    return reply.status(201).send({ version: last + 1, passphrase, note: 'Shown once. Put it on the site; it cannot be shown again.' });
  });
  /** The sealed copies, for a recovery ceremony (two custodians open them offline with `cli escrow-open`). */
  app.get<{ Params: { id: string } }>('/sites/:id/backup-key/escrow', { preHandler: asStaff('admin') }, async (req) => {
    const rows = (await pool.query('SELECT version, sealed, created_at FROM backup_keys WHERE site_id = $1 ORDER BY version', [parse(uuid, req.params.id)])).rows;
    await audit(req, 'backup_key.escrow_read', 'site', req.params.id);
    return { items: rows };
  });

  // ---- approved remote support ----------------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/sites/:id/support-sessions', { preHandler: asStaff('support') }, async (req, reply) => {
    const id = parse(uuid, req.params.id); const b = parse(schemas.support, req.body);
    const sid = randomUUID();
    try { await pool.query('INSERT INTO support_sessions (id, site_id, requested_by, reason, minutes, public_key) VALUES ($1, $2, $3, $4, $5, $6)', [sid, id, req.staff?.id, b.reason, b.minutes, b.publicKey]); }
    catch (e) { const c = (e as { code?: string }).code; if (c === '23505') throw new HttpError(409, 'session_active', 'This site already has a support session in progress'); if (c === '23503') throw new HttpError(404, 'not_found', 'No such site'); throw e; }
    await audit(req, 'support.requested', 'site', id, { sessionId: sid, reason: b.reason, minutes: b.minutes });
    return reply.status(201).send({ id: sid, status: 'requested' });
  });
  app.get<{ Params: { id: string } }>('/sites/:id/support-sessions', { preHandler: asStaff('viewer') }, async (req) => ({ items: (await pool.query('SELECT s.id, s.status, s.reason, s.minutes, s.opened_at, s.expires_at, s.closed_at, s.created_at, u.email AS requested_by FROM support_sessions s JOIN staff_users u ON u.id = s.requested_by WHERE s.site_id = $1 ORDER BY s.created_at DESC LIMIT 50', [parse(uuid, req.params.id)])).rows }));
  /** Staff enter the six digits the customer read out. Only the site's agent can say whether they are right. */
  app.post<{ Params: { id: string } }>('/support-sessions/:id/code', { preHandler: asStaff('support') }, async (req) => {
    const id = parse(uuid, req.params.id); const b = parse(schemas.supportCode, req.body);
    const r = await pool.query("UPDATE support_sessions SET entered_code = $2 WHERE id = $1 AND status = 'awaiting_code' RETURNING id", [id, b.code]);
    if (!r.rows[0]) throw new HttpError(409, 'not_awaiting_code', 'This session is not waiting for a code');
    return { sent: true };
  });
  app.post<{ Params: { id: string } }>('/support-sessions/:id/close', { preHandler: asStaff('support') }, async (req) => {
    const id = parse(uuid, req.params.id);
    const r = await pool.query<{ site_id: string }>("UPDATE support_sessions SET status = CASE WHEN status = 'open' THEN 'closed' ELSE 'cancelled' END, closed_at = now(), entered_code = NULL WHERE id = $1 AND status IN ('requested', 'awaiting_code', 'open') RETURNING site_id", [id]);
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'No active session with that id');
    await audit(req, 'support.closed', 'site', r.rows[0].site_id, { sessionId: id });
    return { closed: true };
  });
  /** The site's current support session, if any. The agent acts on it; the code the customer reads out never leaves the site. */
  app.get('/agent/support', { preHandler: asAgent }, async (req) => {
    const site = req.agentSite as NonNullable<FastifyRequest['agentSite']>;
    const r = (await pool.query("SELECT id, status, reason, minutes, public_key, entered_code, expires_at FROM support_sessions WHERE site_id = $1 AND status IN ('requested', 'awaiting_code', 'open') ORDER BY created_at DESC LIMIT 1", [site.id])).rows[0];
    // sessions that ended since the agent last looked, so it can close access it opened
    const ended = (await pool.query("SELECT id FROM support_sessions WHERE site_id = $1 AND status IN ('closed', 'cancelled', 'refused') AND closed_at > now() - interval '1 day' ORDER BY closed_at DESC LIMIT 5", [site.id])).rows.map((x) => x.id as string);
    return { session: r ? { id: r.id, status: r.status, reason: r.reason, minutes: r.minutes, publicKey: r.public_key, enteredCode: r.entered_code, expiresAt: r.expires_at?.toISOString() ?? null } : null, endedSessionIds: ended };
  });
  app.post<{ Params: { id: string } }>('/agent/support/:id/state', { preHandler: asAgent }, async (req) => {
    const site = req.agentSite as NonNullable<FastifyRequest['agentSite']>;
    const id = parse(uuid, req.params.id); const b = parse(schemas.supportState, req.body);
    if (b.state === 'awaiting_code') {
      await pool.query("UPDATE support_sessions SET status = 'awaiting_code', entered_code = NULL WHERE id = $1 AND site_id = $2 AND status IN ('requested', 'awaiting_code')", [id, site.id]);
    } else if (b.state === 'open') {
      const r = await pool.query("UPDATE support_sessions SET status = 'open', opened_at = now(), expires_at = $3, entered_code = NULL WHERE id = $1 AND site_id = $2 AND status = 'awaiting_code' RETURNING id", [id, site.id, b.expiresAt ?? null]);
      if (!r.rows[0]) throw new HttpError(409, 'bad_state', 'This session is not waiting for approval');
    } else {
      await pool.query("UPDATE support_sessions SET status = $3, closed_at = now(), entered_code = NULL WHERE id = $1 AND site_id = $2 AND status IN ('requested', 'awaiting_code', 'open')", [id, site.id, b.state]);
    }
    await pool.query("INSERT INTO staff_audit (staff_id, action, entity, entity_id, details) VALUES (NULL, $1, 'site', $2, $3)", [`support.${b.state}`, site.id, { sessionId: id }]);
    return { ok: true };
  });

  // ---- audit and the fleet screen -------------------------------------------------------------------------------
  app.get('/audit', { preHandler: asStaff('admin') }, async () => ({ items: (await pool.query('SELECT a.at, u.email AS staff, a.action, a.entity, a.entity_id, a.details FROM staff_audit a LEFT JOIN staff_users u ON u.id = a.staff_id ORDER BY a.id DESC LIMIT 200')).rows }));
  app.get('/', async (_req, reply: FastifyReply) => reply.redirect('/ui'));
  app.get('/ui', async (_req, reply) => { const { readFileSync } = await import('node:fs'); const { resolve } = await import('node:path'); return reply.type('text/html').send(readFileSync(resolve(import.meta.dirname, '../ui/index.html'), 'utf8')); });
  return app;
}

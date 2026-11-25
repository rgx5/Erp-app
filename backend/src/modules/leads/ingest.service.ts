import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { ENV, type Env } from '../../config/env.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { SECRET_BOX } from '../identity/crypto.providers.js';
import type { SecretBox } from '../identity/secret-box.js';
import { ConnectorsService, type ConnectorConfig } from './connectors.service.js';
import { type Incoming, fromGoogle, fromMeta, fromWebsite, normalizeEmail, normalizePhone, type Source } from './leads.logic.js';
import { fromIncoming, LeadsService } from './leads.service.js';

interface Resolved { tenantId: string; id: string; kind: 'website' | 'meta' | 'google' | 'webhook'; name: string; status: string; config: ConnectorConfig & { appSecretSealed?: string }; sealed: string | null }
const HONEYPOTS = ['_hp', '_honeypot', 'hp_field', 'website_url', 'url_field'];
const FIELDS = 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data';

/** Everything that arrives from outside without a signed-in person: a website form, a Google form, a Meta webhook. It checks who it is for, tidies the enquiry, and files it. */
@Injectable()
export class IngestService {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(LeadsService) private readonly leads: LeadsService, @Inject(ConnectorsService) private readonly connectors: ConnectorsService,
    @Inject(ENV) private readonly env: Env, @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  /** A flood from one address (a bot, a mistake) is slowed down per connector: 300 enquiries a minute is far more than any business gets. */
  private throttle(publicId: string): void {
    const now = Date.now(); let w = this.windows.get(publicId);
    if (!w || now - w.start > 60_000) { if (this.windows.size > 10_000) this.windows.clear(); w = { start: now, count: 0 }; this.windows.set(publicId, w); }
    if (++w.count > 300) throw new AppError(429, 'rate_limited', 'Too many enquiries: try again in a minute');
  }

  private async resolve(publicId: string, kinds: Resolved['kind'][]): Promise<Resolved> {
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(publicId)) throw new AppError(404, 'not_found', 'Not found');
    this.throttle(publicId);
    const key = (await this.uow.outsideTenant((tx) => tx.execute<{ tenant_id: string; connector_id: string }>(sql`SELECT tenant_id, connector_id FROM erp.lead_ingest_keys WHERE public_id = ${publicId}`))).rows[0];
    if (!key) throw new AppError(404, 'not_found', 'Not found');
    const c = await this.uow.inTenant(key.tenant_id, async (tx) => (await tx.execute<{ id: string; kind: Resolved['kind']; name: string; status: string; config: Resolved['config']; secret_sealed: string | null }>(sql`SELECT id, kind, name, status, config, secret_sealed FROM erp.lead_connectors WHERE tenant_id = ${key.tenant_id}::uuid AND id = ${key.connector_id}::uuid`)).rows[0], { readOnly: true });
    if (!c || !kinds.includes(c.kind)) throw new AppError(404, 'not_found', 'Not found');
    if (c.status !== 'active') throw new AppError(403, 'connector_paused', 'This lead source is switched off');
    return { tenantId: key.tenant_id, id: c.id, kind: c.kind, name: c.name, status: c.status, config: c.config, sealed: c.secret_sealed };
  }

  private async note(tenantId: string, connectorId: string, outcome: 'created' | 'duplicate' | 'rejected' | 'error' | 'test', detail: string | null, externalId: string | null): Promise<void> {
    await this.uow.inTenant(tenantId, async (tx) => {
      await tx.execute(sql`INSERT INTO erp.lead_deliveries (tenant_id, id, connector_id, outcome, detail, external_id) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${connectorId}::uuid, ${outcome}, ${detail?.slice(0, 500) ?? null}, ${externalId})`);
      await tx.execute(sql`DELETE FROM erp.lead_deliveries WHERE tenant_id = ${tenantId}::uuid AND connector_id = ${connectorId}::uuid AND id NOT IN (SELECT id FROM erp.lead_deliveries WHERE tenant_id = ${tenantId}::uuid AND connector_id = ${connectorId}::uuid ORDER BY created_at DESC LIMIT 200)`);
      if (outcome === 'created' || outcome === 'duplicate' || outcome === 'test') await tx.execute(sql`UPDATE erp.lead_connectors SET last_error = NULL, last_lead_at = now(), lead_count = lead_count + ${outcome === 'duplicate' ? 0 : 1} WHERE tenant_id = ${tenantId}::uuid AND id = ${connectorId}::uuid`);
      else if (outcome === 'error') await tx.execute(sql`UPDATE erp.lead_connectors SET last_error = ${detail?.slice(0, 300) ?? 'Failed'} WHERE tenant_id = ${tenantId}::uuid AND id = ${connectorId}::uuid`);
    });
  }

  /** Files one enquiry: checks it can be followed up, creates the lead or notes that the person asked again, and writes the delivery log. */
  private async accept(c: Resolved, incoming: Incoming, source: Source, raw: unknown, test = false): Promise<{ created: boolean }> {
    const phone = normalizePhone(incoming.phone); const email = normalizeEmail(incoming.email);
    if (!phone && !email) { await this.note(c.tenantId, c.id, 'rejected', 'No phone number or email in the enquiry', incoming.externalId); throw new AppError(422, 'invalid_lead', 'An enquiry needs a phone number or an email'); }
    const input = fromIncoming({ ...incoming, name: incoming.name || (phone ? `Enquiry ${phone}` : (email as string)), campaign: incoming.campaign ?? c.config.defaultCampaign ?? null }, source, raw);
    try {
      const r = await this.uow.inTenant(c.tenantId, (tx) => this.leads.create(tx, c.tenantId, input, { actorId: null, connectorId: c.id, allowDuplicate: false }));
      await this.note(c.tenantId, c.id, test ? 'test' : r.duplicate ? 'duplicate' : 'created', r.duplicate ? `Same person as ${r.lead.leadNo}` : r.lead.leadNo, incoming.externalId);
      return { created: !r.duplicate };
    } catch (e) {
      await this.note(c.tenantId, c.id, 'error', e instanceof Error ? e.message : 'Failed', incoming.externalId).catch(() => undefined);
      throw e;
    }
  }

  // ---- website and generic webhook ----------------------------------------------------------------------------------------
  async website(publicId: string, body: unknown, origin: { origin?: string | undefined; referer?: string | undefined }): Promise<{ ok: true }> {
    const c = await this.resolve(publicId, ['website', 'webhook']);
    const domains = c.config.allowedDomains ?? [];
    if (domains.length > 0) {
      const host = (() => { try { return new URL(origin.origin || origin.referer || '').hostname.toLowerCase(); } catch { return ''; } })();
      if (!host || !domains.some((d) => host === d || host.endsWith('.' + d))) { await this.note(c.tenantId, c.id, 'rejected', `Sent from ${host || 'an unknown page'}, which is not in the allowed websites`, null); throw new AppError(403, 'origin_not_allowed', 'This website is not allowed to send enquiries here'); }
    }
    let data: unknown = body;
    if (typeof data === 'string') { const text: string = data; try { data = JSON.parse(text); } catch { data = Object.fromEntries(new URLSearchParams(text)); } }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new AppError(422, 'invalid_lead', 'Send the enquiry as a JSON object or a form');
    const rec = data as Record<string, unknown>;
    if (HONEYPOTS.some((k) => typeof rec[k] === 'string' && (rec[k] as string).trim() !== '')) return { ok: true }; // a bot filled the hidden field: accept quietly and drop it
    await this.accept(c, fromWebsite(rec), c.kind === 'webhook' ? 'webhook' : 'website', rec);
    return { ok: true };
  }

  // ---- Google Ads lead forms -----------------------------------------------------------------------------------------------
  async google(publicId: string, body: unknown): Promise<Record<string, never>> {
    const c = await this.resolve(publicId, ['google']);
    const p = (typeof body === 'string' ? (() => { try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; } })() : (body ?? {})) as Record<string, unknown>;
    const given = typeof p['google_key'] === 'string' ? (p['google_key'] as string) : '';
    const want = c.config.googleKey ?? '';
    if (!want || given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) { await this.note(c.tenantId, c.id, 'rejected', 'The google_key did not match', null); throw new AppError(403, 'bad_key', 'The key is not right'); }
    if (p['is_test'] === true) { await this.note(c.tenantId, c.id, 'test', 'Google test lead received', typeof p['lead_id'] === 'string' ? (p['lead_id'] as string) : null); return {}; }
    await this.accept(c, fromGoogle(p as Parameters<typeof fromGoogle>[0]), 'google', p);
    return {};
  }

  // ---- Meta (Facebook / Instagram) lead ads --------------------------------------------------------------------------------
  async metaVerify(publicId: string, q: { mode?: string; token?: string; challenge?: string }): Promise<string> {
    const c = await this.resolve(publicId, ['meta']);
    const want = c.config.verifyToken ?? '';
    if (q.mode !== 'subscribe' || !want || q.token !== want || !q.challenge) throw new AppError(403, 'bad_token', 'The verify token is not right');
    return q.challenge;
  }

  private appSecret(c: Resolved): string | null {
    const sealed = c.config.appSecretSealed;
    if (sealed) { try { return this.box.open(sealed, this.connectors.aad(c.tenantId, c.id, 'app')); } catch { return null; } }
    return this.env.META_APP_SECRET ?? null;
  }

  async meta(publicId: string, raw: string, signature: string | undefined, body: unknown): Promise<{ ok: true }> {
    const c = await this.resolve(publicId, ['meta']);
    const secret = this.appSecret(c);
    const expect = secret ? 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') : null;
    if (!expect || !signature || signature.length !== expect.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expect))) { await this.note(c.tenantId, c.id, 'rejected', secret ? 'The signature did not match' : 'No app secret is set for this connector', null); throw new AppError(403, 'bad_signature', 'The signature is not right'); }
    const payload = (body ?? {}) as { entry?: { id?: string; changes?: { field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string } }[] }[] };
    let pageToken: string | null = null;
    for (const entry of payload.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        if (ch.field !== 'leadgen' || !ch.value?.leadgen_id) continue;
        const pageId = ch.value.page_id ?? entry.id;
        if (c.config.pageId && pageId && c.config.pageId !== pageId) continue;
        if (c.config.formIds?.length && ch.value.form_id && !c.config.formIds.includes(ch.value.form_id)) continue;
        if (pageToken === null) {
          if (!c.sealed) { await this.note(c.tenantId, c.id, 'error', 'No page access token is set', ch.value.leadgen_id); throw new AppError(500, 'no_token', 'Not configured'); }
          pageToken = this.box.open(c.sealed, this.connectors.aad(c.tenantId, c.id, 'token'));
        }
        let lead: Parameters<typeof fromMeta>[0];
        try {
          const res = await fetch(`${this.env.META_GRAPH_BASE}/${encodeURIComponent(ch.value.leadgen_id)}?fields=${FIELDS}&access_token=${encodeURIComponent(pageToken)}`, { signal: AbortSignal.timeout(8000) });
          const json = (await res.json()) as Parameters<typeof fromMeta>[0] & { error?: { message?: string } };
          if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta answered ${res.status}`);
          lead = json;
        } catch (e) {
          // an error answer makes Meta try again later; the lead is not lost
          await this.note(c.tenantId, c.id, 'error', `Could not fetch the lead from Meta: ${e instanceof Error ? e.message : 'failed'}`, ch.value.leadgen_id);
          throw new AppError(502, 'meta_fetch_failed', 'Could not read the lead from Meta');
        }
        const incoming = fromMeta({ ...lead, id: lead.id ?? ch.value.leadgen_id, form_id: lead.form_id ?? ch.value.form_id });
        await this.accept(c, incoming, 'meta', lead).catch((e: unknown) => { if (!(e instanceof AppError && e.code === 'invalid_lead')) throw e; });
      }
    }
    return { ok: true };
  }

  /** A sample enquiry through the real path, so a person setting a connector up can see it work. */
  async test(tenantId: string, connectorId: string): Promise<{ ok: true }> {
    const row = await this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ id: string; kind: Resolved['kind']; name: string; status: string; config: Resolved['config']; secret_sealed: string | null }>(sql`SELECT id, kind, name, status, config, secret_sealed FROM erp.lead_connectors WHERE tenant_id = ${tenantId}::uuid AND id = ${connectorId}::uuid`)).rows[0], { readOnly: true });
    if (!row) throw new AppError(404, 'not_found', 'Connector not found');
    const c: Resolved = { tenantId, id: row.id, kind: row.kind, name: row.name, status: row.status, config: row.config, sealed: row.secret_sealed };
    const stamp = Date.now().toString().slice(-6);
    await this.accept(c, { ...fromWebsite({ name: `Test lead ${stamp}`, phone: `90000${stamp}`, city: 'Test city', message: 'Sent from the Test button', test: 'yes' }), externalId: null }, row.kind === 'meta' ? 'meta' : row.kind === 'google' ? 'google' : row.kind === 'webhook' ? 'webhook' : 'website', { test: true }, true);
    return { ok: true };
  }
}

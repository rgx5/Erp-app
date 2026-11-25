import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { Recorder } from '../masterdata/helpers.js';
import { type AssignRule, DEFAULT_STAGES, type Incoming, normalizeEmail, normalizePhone, pickOwner, type Source } from './leads.logic.js';

type Tx = Parameters<Parameters<UnitOfWork['inTenant']>[1]>[0];
/** A list as a Postgres array (drizzle would otherwise spread it into separate values). */
const uuids = (list: string[]): SQL => (list.length === 0 ? sql`'{}'::uuid[]` : sql`ARRAY[${sql.join(list.map((x) => sql`${x}::uuid`), sql`, `)}]::uuid[]`);
const texts = (list: string[]): SQL => (list.length === 0 ? sql`'{}'::text[]` : sql`ARRAY[${sql.join(list.map((x) => sql`${x}`), sql`, `)}]::text[]`);
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export interface Territory { users: string[]; cities?: string[]; pincodePrefix?: string[] }
/** Who is looking: everyone's leads (undefined), or only a person's own and their territory's. */
export interface CustomField { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'yes_no'; options?: string[]; required?: boolean; showOnCard?: boolean }
export type Scope = { userId: string } | undefined
export type Stage = { id: string; name: string; position: number; kind: 'open' | 'won' | 'lost'; status: string };
export interface LeadSettings { assignmentMode: 'manual' | 'round_robin'; members: string[]; rules: AssignRule[]; territories: Territory[]; customFields: CustomField[]; slaMinutes: number; lostReasons: string[] }

type LeadRow = { id: string; lead_no: string; name: string; phone: string | null; email: string | null; city: string | null; pincode: string | null; state: string | null; source: string; connector_id: string | null; campaign: string | null; adset: string | null; ad: string | null; form_name: string | null; utm: Record<string, string>; click_id: string | null; stage_id: string; status: string; lost_reason: string | null; owner_id: string | null; owner_name?: string | null; assigned_at: string | null; first_response_at: string | null; sla_due_at: string | null; next_follow_up_at: string | null; interest: string | null; value_estimate: string | null; fields: Record<string, string>; consent: boolean; enquiry_count: number; party_id: string | null; converted_at: string | null; duplicate_of: string | null; created_at: string; updated_at: string };
const COL_LIST = 'l.id, l.lead_no, l.name, l.phone, l.email, l.city, l.pincode, l.state, l.source, l.connector_id, l.campaign, l.adset, l.ad, l.form_name, l.utm, l.click_id, l.stage_id, l.status, l.lost_reason, l.owner_id, l.assigned_at, l.first_response_at, l.sla_due_at, l.next_follow_up_at, l.interest, l.value_estimate, l.fields, l.consent, l.enquiry_count, l.party_id, l.converted_at, l.duplicate_of, l.created_at, l.updated_at';
const COLS = sql.raw(COL_LIST);
const COLS_BARE = sql.raw(COL_LIST.replaceAll('l.', ''));

export const presentLead = (r: LeadRow) => ({
  id: r.id, leadNo: r.lead_no, name: r.name, phone: r.phone, email: r.email, city: r.city, pincode: r.pincode, state: r.state, source: r.source, connectorId: r.connector_id, campaign: r.campaign, adset: r.adset, ad: r.ad, formName: r.form_name,
  utm: r.utm, clickId: r.click_id, stageId: r.stage_id, status: r.status, lostReason: r.lost_reason, ownerId: r.owner_id, ownerName: r.owner_name ?? null, assignedAt: iso(r.assigned_at), firstResponseAt: iso(r.first_response_at), slaDueAt: iso(r.sla_due_at),
  nextFollowUpAt: iso(r.next_follow_up_at), interest: r.interest, valueEstimate: r.value_estimate, fields: r.fields, consent: r.consent, enquiryCount: r.enquiry_count, partyId: r.party_id, convertedAt: iso(r.converted_at), duplicateOf: r.duplicate_of,
  createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string,
  overdue: r.status === 'open' && r.first_response_at === null && r.sla_due_at !== null && new Date(r.sla_due_at).getTime() < Date.now(),
});
export type LeadDto = ReturnType<typeof presentLead>;

export interface LeadInput {
  name: string; phone?: string | null | undefined; email?: string | null | undefined; city?: string | null | undefined; pincode?: string | null | undefined; state?: string | null | undefined; source?: Source | undefined;
  campaign?: string | null | undefined; adset?: string | null | undefined; ad?: string | null | undefined; formName?: string | null | undefined; utm?: Record<string, string> | undefined; clickId?: string | null | undefined;
  interest?: string | null | undefined; valueEstimate?: string | null | undefined; fields?: Record<string, string> | undefined; consent?: boolean | undefined; externalId?: string | null | undefined; ownerId?: string | null | undefined; raw?: unknown;
}
export const fromIncoming = (i: Incoming, source: Source, raw?: unknown): LeadInput => ({ name: i.name, phone: i.phone, email: i.email, city: i.city, pincode: i.pincode, state: i.state, source, campaign: i.campaign, adset: i.adset, ad: i.ad, formName: i.formName, utm: i.utm, clickId: i.clickId, interest: i.interest, fields: i.fields, consent: i.consent, externalId: i.externalId, raw });

export interface ListQuery { status?: string | undefined; stageId?: string | undefined; ownerId?: string | undefined; unassigned?: boolean | undefined; source?: string | undefined; campaign?: string | undefined; q?: string | undefined; overdue?: boolean | undefined; followUpDue?: boolean | undefined; from?: string | undefined; to?: string | undefined; limit: number; cursor?: string | undefined }

@Injectable()
export class LeadsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}


  /** The leads a restricted person may see: those they own or created, and those in a territory they are named in. */
  private async scopeSql(tx: Tx, tenantId: string, scope: Scope, alias = 'l'): Promise<SQL> {
    if (!scope) return sql`TRUE`;
    const t = (await tx.execute<{ territories: Territory[] }>(sql`SELECT territories FROM erp.lead_settings WHERE tenant_id = ${tenantId}::uuid`)).rows[0]?.territories ?? [];
    const mine = t.filter((x) => x.users.includes(scope.userId));
    const cities = [...new Set(mine.flatMap((x) => (x.cities ?? []).map((c) => c.toLowerCase().trim())))];
    const prefixes = [...new Set(mine.flatMap((x) => (x.pincodePrefix ?? []).map((p) => p.trim()).filter(Boolean)))];
    const col = (n: string): SQL => sql.raw(`${alias}.${n}`);
    const parts: SQL[] = [sql`${col('owner_id')} = ${scope.userId}::uuid`, sql`${col('created_by')} = ${scope.userId}::uuid`];
    if (cities.length) parts.push(sql`lower(${col('city')}) = ANY(${texts(cities)})`);
    if (prefixes.length) parts.push(sql`(${sql.join(prefixes.map((p) => sql`${col('pincode')} LIKE ${p.replace(/[%_\\]/g, '') + '%'}`), sql` OR `)})`);
    return sql`(${sql.join(parts, sql` OR `)})`;
  }
  private async assertVisible(tx: Tx, tenantId: string, id: string, scope: Scope): Promise<void> {
    if (!scope) return;
    const w = await this.scopeSql(tx, tenantId, scope);
    const ok = (await tx.execute(sql`SELECT 1 FROM erp.leads l WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ${id}::uuid AND ${w}`)).rows.length > 0;
    if (!ok) throw new AppError(404, 'not_found', 'Lead not found'); // a lead outside your territory looks like one that does not exist
  }

  // ---- settings and stages ------------------------------------------------------------------------------------------------
  /** A business's first use creates its settings and the standard pipeline; nothing has to be set up before leads can arrive. */
  async ensureSetup(tx: Tx, tenantId: string): Promise<{ settings: LeadSettings & { cursor: number }; stages: Stage[] }> {
    await tx.execute(sql`INSERT INTO erp.lead_settings (tenant_id) VALUES (${tenantId}::uuid) ON CONFLICT (tenant_id) DO NOTHING`);
    const have = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM erp.lead_stages WHERE tenant_id = ${tenantId}::uuid`)).rows[0]?.n ?? 0;
    if (have === 0) for (const [i, s] of DEFAULT_STAGES.entries()) await tx.execute(sql`INSERT INTO erp.lead_stages (tenant_id, id, name, position, kind) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${s.name}, ${i + 1}, ${s.kind}) ON CONFLICT DO NOTHING`);
    const s = (await tx.execute<{ assignment_mode: 'manual' | 'round_robin'; members: string[]; rules: AssignRule[]; territories: Territory[]; custom_fields: CustomField[]; sla_minutes: number; lost_reasons: string[]; rr_cursor: number }>(sql`SELECT assignment_mode, members, rules, territories, custom_fields, sla_minutes, lost_reasons, rr_cursor FROM erp.lead_settings WHERE tenant_id = ${tenantId}::uuid`)).rows[0];
    const stages = (await tx.execute<Stage>(sql`SELECT id, name, position, kind, status FROM erp.lead_stages WHERE tenant_id = ${tenantId}::uuid AND status = 'active' ORDER BY position`)).rows;
    return { settings: { assignmentMode: s?.assignment_mode ?? 'manual', members: s?.members ?? [], rules: s?.rules ?? [], territories: s?.territories ?? [], customFields: s?.custom_fields ?? [], slaMinutes: s?.sla_minutes ?? 30, lostReasons: s?.lost_reasons ?? [], cursor: s?.rr_cursor ?? 0 }, stages };
  }

  getSettings(tenantId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const { settings, stages } = await this.ensureSetup(tx, tenantId);
      const users = (await tx.execute<{ id: string; display_name: string; email: string }>(sql`SELECT id, display_name, email FROM erp.users WHERE tenant_id = ${tenantId}::uuid AND status = 'active' ORDER BY display_name`)).rows;
      const { cursor: _c, ...rest } = settings;
      return { ...rest, stages, users: users.map((u) => ({ id: u.id, name: u.display_name, email: u.email })) };
    });
  }

  putSettings(tenantId: string, input: LeadSettings) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.ensureSetup(tx, tenantId);
      if (input.members.length > 0) {
        const ok = (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.users WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${uuids(input.members)})`)).rows.length;
        if (ok !== new Set(input.members).size) throw validationFailed([{ path: 'members', message: 'Every person must be a user of this business' }]);
      }
      await tx.execute(sql`UPDATE erp.lead_settings SET assignment_mode = ${input.assignmentMode}, members = ${uuids(input.members)}, rules = ${JSON.stringify(input.rules)}::jsonb, territories = ${JSON.stringify(input.territories)}::jsonb, custom_fields = ${JSON.stringify(input.customFields)}::jsonb, sla_minutes = ${input.slaMinutes}, lost_reasons = ${texts(input.lostReasons)}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid`);
      await this.recorder.record(tx, tenantId, 'lead_settings', 'updated', { id: tenantId }, { mode: input.assignmentMode, slaMinutes: input.slaMinutes });
      return { ok: true };
    });
  }

  saveStages(tenantId: string, input: { id?: string | undefined; name: string; kind: 'open' | 'won' | 'lost' }[]) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const { stages } = await this.ensureSetup(tx, tenantId);
      if (!input.some((s) => s.kind === 'open')) throw validationFailed([{ path: 'stages', message: 'Keep at least one open stage' }]);
      if (!input.some((s) => s.kind === 'won') || !input.some((s) => s.kind === 'lost')) throw validationFailed([{ path: 'stages', message: 'Keep a Won stage and a Lost stage' }]);
      if (new Set(input.map((s) => s.name.trim().toLowerCase())).size !== input.length) throw validationFailed([{ path: 'stages', message: 'Stage names must be different' }]);
      const keep = new Set(input.flatMap((s) => (s.id ? [s.id] : [])));
      for (const old of stages) {
        if (keep.has(old.id)) continue;
        const used = (await tx.execute(sql`SELECT 1 FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND stage_id = ${old.id}::uuid LIMIT 1`)).rows.length > 0;
        if (used) throw new AppError(409, 'stage_in_use', `Leads are still in "${old.name}": move them first`);
        await tx.execute(sql`DELETE FROM erp.lead_stages WHERE tenant_id = ${tenantId}::uuid AND id = ${old.id}::uuid`);
      }
      // positions are moved out of the way first, so the new order never clashes with the old one
      await tx.execute(sql`UPDATE erp.lead_stages SET position = position + 1000 WHERE tenant_id = ${tenantId}::uuid`);
      for (const [i, s] of input.entries()) {
        if (s.id && stages.some((x) => x.id === s.id)) await tx.execute(sql`UPDATE erp.lead_stages SET name = ${s.name.trim()}, kind = ${s.kind}, position = ${i + 1} WHERE tenant_id = ${tenantId}::uuid AND id = ${s.id}::uuid`);
        else await tx.execute(sql`INSERT INTO erp.lead_stages (tenant_id, id, name, position, kind) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${s.name.trim()}, ${i + 1}, ${s.kind})`);
      }
      await this.recorder.record(tx, tenantId, 'lead_stages', 'updated', { id: tenantId }, { count: input.length });
      return (await tx.execute<Stage>(sql`SELECT id, name, position, kind, status FROM erp.lead_stages WHERE tenant_id = ${tenantId}::uuid AND status = 'active' ORDER BY position`)).rows;
    });
  }

  /** A lead typed in by a person must carry the details the business marked required, and a choice must be one of the offered options. (Enquiries that arrive from a form or an advert are taken as they come.) */
  private checkFields(defs: CustomField[], values: Record<string, string> | undefined, partial: boolean): void {
    const v = values ?? {}; const problems: { path: string; message: string }[] = [];
    for (const d of defs) {
      const x = (v[d.key] ?? '').trim();
      if (!partial && d.required && x === '') problems.push({ path: `fields.${d.key}`, message: `${d.label} is required` });
      if (x !== '' && d.type === 'select' && d.options && !d.options.includes(x)) problems.push({ path: `fields.${d.key}`, message: `${d.label} must be one of: ${d.options.join(', ')}` });
      if (x !== '' && d.type === 'number' && !/^-?\d{1,15}(\.\d{1,4})?$/.test(x)) problems.push({ path: `fields.${d.key}`, message: `${d.label} must be a number` });
    }
    if (problems.length) throw validationFailed(problems);
  }

  // ---- creating a lead ----------------------------------------------------------------------------------------------------
  /** Makes a lead, or notes that the same person enquired again. Used by the screens and by every connector. */
  async create(tx: Tx, tenantId: string, input: LeadInput, ctx: { actorId: string | null; connectorId: string | null; allowDuplicate: boolean }): Promise<{ lead: LeadDto; duplicate: boolean }> {
    const { settings, stages } = await this.ensureSetup(tx, tenantId);
    const phoneNorm = normalizePhone(input.phone); const email = normalizeEmail(input.email);
    const source = input.source ?? 'manual';
    // answers that arrive under a form's own wording ("Monthly electricity bill") are filed under the business's field of that name
    const slugOf = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (input.fields) input = { ...input, fields: Object.fromEntries(Object.entries(input.fields).map(([k, v]) => [settings.customFields.find((d) => d.key === k || slugOf(d.label) === slugOf(k))?.key ?? k, v])) };
    // the same enquiry delivered twice (the ad platform retries), then the same person asking again
    if (ctx.connectorId && input.externalId) {
      const same = (await tx.execute<LeadRow>(sql`SELECT ${COLS} FROM erp.leads l WHERE l.tenant_id = ${tenantId}::uuid AND l.connector_id = ${ctx.connectorId}::uuid AND l.external_id = ${input.externalId}`)).rows[0];
      if (same) return { lead: presentLead(same), duplicate: true };
    }
    if (phoneNorm || email) {
      const dup = (await tx.execute<LeadRow>(sql`SELECT ${COLS} FROM erp.leads l WHERE l.tenant_id = ${tenantId}::uuid AND l.status = 'open' AND l.created_at > now() - interval '180 days' AND l.duplicate_of IS NULL AND ((${phoneNorm}::text IS NOT NULL AND l.phone_norm = ${phoneNorm}) OR (${email}::text IS NOT NULL AND lower(l.email) = ${email})) ORDER BY l.created_at DESC LIMIT 1`)).rows[0];
      if (dup) {
        if (!ctx.allowDuplicate && !ctx.connectorId) throw new AppError(409, 'duplicate_lead', `${dup.name} (${dup.lead_no}) is already an open lead with the same phone or email`, { lead: presentLead(dup) });
        if (ctx.connectorId || !ctx.allowDuplicate) {
          await tx.execute(sql`UPDATE erp.leads SET enquiry_count = enquiry_count + 1, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${dup.id}::uuid`);
          await this.activity(tx, tenantId, dup.id, 'system', `Enquired again through ${source}${input.campaign ? ` (${input.campaign})` : ''}`, null);
          return { lead: presentLead({ ...dup, enquiry_count: dup.enquiry_count + 1 }), duplicate: true };
        }
      }
    }
    const seq = (await tx.execute<{ lead_seq: number }>(sql`UPDATE erp.lead_settings SET lead_seq = lead_seq + 1 WHERE tenant_id = ${tenantId}::uuid RETURNING lead_seq`)).rows[0]?.lead_seq ?? 1;
    const leadNo = `L-${String(seq).padStart(5, '0')}`;
    let ownerId = input.ownerId ?? null; let cursor = settings.cursor;
    if (!ownerId && settings.assignmentMode === 'round_robin') {
      const pool = [...new Set([...settings.members, ...settings.rules.flatMap((r) => r.users)])];
      const active = new Set(pool.length ? (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.users WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND id = ANY(${uuids(pool)})`)).rows.map((r) => r.id) : []);
      const pick = pickOwner(settings.assignmentMode, settings.members, settings.rules, { city: input.city ?? null, pincode: input.pincode ?? null, source, campaign: input.campaign ?? null }, cursor, active);
      ownerId = pick.owner; cursor = pick.cursor;
      if (ownerId) await tx.execute(sql`UPDATE erp.lead_settings SET rr_cursor = ${cursor} WHERE tenant_id = ${tenantId}::uuid`);
    }
    const firstStage = stages.find((s) => s.kind === 'open') as Stage;
    const id = uuidv7();
    const r = (await tx.execute<LeadRow>(sql`
      INSERT INTO erp.leads (tenant_id, id, lead_no, name, phone, phone_norm, email, city, pincode, state, source, connector_id, external_id, campaign, adset, ad, form_name, utm, click_id, stage_id, owner_id, assigned_at, sla_due_at, interest, value_estimate, fields, consent, consent_at, raw, created_by)
      VALUES (${tenantId}::uuid, ${id}::uuid, ${leadNo}, ${input.name.trim().slice(0, 200)}, ${input.phone?.trim() || null}, ${phoneNorm}, ${email}, ${input.city?.trim() || null}, ${input.pincode?.trim() || null}, ${input.state?.trim() || null}, ${source}, ${ctx.connectorId}::uuid, ${input.externalId ?? null},
        ${input.campaign ?? null}, ${input.adset ?? null}, ${input.ad ?? null}, ${input.formName ?? null}, ${JSON.stringify(input.utm ?? {})}::jsonb, ${input.clickId ?? null}, ${firstStage.id}::uuid, ${ownerId}::uuid, ${ownerId ? sql`now()` : sql`NULL`}, now() + (${settings.slaMinutes} * interval '1 minute'),
        ${input.interest ?? null}, ${input.valueEstimate ?? null}, ${JSON.stringify(input.fields ?? {})}::jsonb, ${input.consent ?? false}, ${input.consent ? sql`now()` : sql`NULL`}, ${input.raw === undefined ? sql`NULL` : sql`${JSON.stringify(input.raw)}::jsonb`}, ${ctx.actorId}::uuid)
      RETURNING ${COLS_BARE}`)).rows[0] as LeadRow;
    await this.activity(tx, tenantId, id, 'system', `Lead created from ${source}${input.campaign ? ` · ${input.campaign}` : ''}`, ctx.actorId);
    if (ownerId) await this.activity(tx, tenantId, id, 'assign', 'Assigned automatically', null);
    await this.recorder.record(tx, tenantId, 'lead', 'created', { id }, { leadNo, source, ownerId });
    return { lead: presentLead(r), duplicate: false };
  }

  createManual(tenantId: string, actorId: string, input: LeadInput, allowDuplicate: boolean) {
    return this.uow.inTenant(tenantId, async (tx) => {
      this.checkFields((await this.ensureSetup(tx, tenantId)).settings.customFields, input.fields, false);
      return (await this.create(tx, tenantId, { ...input, source: input.source ?? 'manual' }, { actorId, connectorId: null, allowDuplicate })).lead;
    });
  }

  // ---- reading ------------------------------------------------------------------------------------------------------------
  list(tenantId: string, q: ListQuery, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const w: SQL[] = [sql`l.tenant_id = ${tenantId}::uuid`, await this.scopeSql(tx, tenantId, scope)];
      if (q.status) w.push(sql`l.status = ${q.status}`);
      if (q.stageId) w.push(sql`l.stage_id = ${q.stageId}::uuid`);
      if (q.ownerId) w.push(sql`l.owner_id = ${q.ownerId}::uuid`);
      if (q.unassigned) w.push(sql`l.owner_id IS NULL`);
      if (q.source) w.push(sql`l.source = ${q.source}`);
      if (q.campaign) w.push(sql`l.campaign ILIKE ${'%' + q.campaign.replace(/[%_\\]/g, '\\$&') + '%'}`);
      if (q.from) w.push(sql`l.created_at >= ${q.from}::date`);
      if (q.to) w.push(sql`l.created_at < ${q.to}::date + 1`);
      if (q.overdue) w.push(sql`l.status = 'open' AND l.first_response_at IS NULL AND l.sla_due_at < now()`);
      if (q.followUpDue) w.push(sql`l.status = 'open' AND l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now()`);
      if (q.q) { const like = '%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'; const digits = normalizePhone(q.q); w.push(sql`(l.name ILIKE ${like} OR l.lead_no ILIKE ${like} OR l.email ILIKE ${like} OR l.city ILIKE ${like} OR l.phone ILIKE ${like} OR (${digits}::text IS NOT NULL AND l.phone_norm LIKE ${(digits ?? '') + '%'}))`); }
      const before = decodeCursor(q.cursor);
      if (before) w.push(sql`l.id < ${before}::uuid`);
      const rows = (await tx.execute<LeadRow>(sql`SELECT ${COLS}, u.display_name AS owner_name FROM erp.leads l LEFT JOIN erp.users u ON u.tenant_id = l.tenant_id AND u.id = l.owner_id WHERE ${sql.join(w, sql` AND `)} ORDER BY l.id DESC LIMIT ${q.limit + 1}`)).rows;
      const page = rows.slice(0, q.limit); const last = page[page.length - 1];
      return { items: page.map(presentLead), nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  /** How many leads sit in each stage, and how many need attention: the numbers over the board and on the dashboard. */
  counts(tenantId: string, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const w = await this.scopeSql(tx, tenantId, scope, 'leads');
      const byStage = (await tx.execute<{ stage_id: string; n: number }>(sql`SELECT stage_id, count(*)::int AS n FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND status = 'open' AND ${w} GROUP BY stage_id`)).rows;
      const a = (await tx.execute<{ overdue: number; follow_up: number; unassigned: number; today: number }>(sql`SELECT
        count(*) FILTER (WHERE status = 'open' AND first_response_at IS NULL AND sla_due_at < now())::int AS overdue,
        count(*) FILTER (WHERE status = 'open' AND next_follow_up_at < now())::int AS follow_up,
        count(*) FILTER (WHERE status = 'open' AND owner_id IS NULL)::int AS unassigned,
        count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND ${w}`)).rows[0];
      return { byStage: Object.fromEntries(byStage.map((s) => [s.stage_id, s.n])), overdue: a?.overdue ?? 0, followUpDue: a?.follow_up ?? 0, unassigned: a?.unassigned ?? 0, today: a?.today ?? 0 };
    }, { readOnly: true });
  }

  get(tenantId: string, id: string, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.assertVisible(tx, tenantId, id, scope);
      const r = (await tx.execute<LeadRow>(sql`SELECT ${COLS}, u.display_name AS owner_name FROM erp.leads l LEFT JOIN erp.users u ON u.tenant_id = l.tenant_id AND u.id = l.owner_id WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ${id}::uuid`)).rows[0];
      if (!r) throw new AppError(404, 'not_found', 'Lead not found');
      const acts = (await tx.execute<{ id: string; kind: string; body: string; due_at: string | null; done_at: string | null; created_at: string; by: string | null }>(sql`SELECT a.id, a.kind, a.body, a.due_at, a.done_at, a.created_at, u.display_name AS by FROM erp.lead_activities a LEFT JOIN erp.users u ON u.tenant_id = a.tenant_id AND u.id = a.created_by WHERE a.tenant_id = ${tenantId}::uuid AND a.lead_id = ${id}::uuid ORDER BY a.created_at DESC, a.id DESC LIMIT 500`)).rows;
      return { ...presentLead(r), activities: acts.map((a) => ({ id: a.id, kind: a.kind, body: a.body, dueAt: iso(a.due_at), doneAt: iso(a.done_at), createdAt: iso(a.created_at) as string, by: a.by })) };
    }, { readOnly: true });
  }

  // ---- changing a lead ----------------------------------------------------------------------------------------------------
  private async activity(tx: Tx, tenantId: string, leadId: string, kind: string, body: string, actorId: string | null, dueAt?: string): Promise<string> {
    const id = uuidv7();
    await tx.execute(sql`INSERT INTO erp.lead_activities (tenant_id, id, lead_id, kind, body, due_at, created_by) VALUES (${tenantId}::uuid, ${id}::uuid, ${leadId}::uuid, ${kind}, ${body.slice(0, 2000)}, ${dueAt ?? null}::timestamptz, ${actorId}::uuid)`);
    return id;
  }
  private async lock(tx: Tx, tenantId: string, id: string, scope?: Scope): Promise<LeadRow> {
    await this.assertVisible(tx, tenantId, id, scope);
    const r = (await tx.execute<LeadRow>(sql`SELECT ${COLS} FROM erp.leads l WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ${id}::uuid FOR UPDATE`)).rows[0];
    if (!r) throw new AppError(404, 'not_found', 'Lead not found');
    return r;
  }
  private async refreshFollowUp(tx: Tx, tenantId: string, leadId: string): Promise<void> {
    await tx.execute(sql`UPDATE erp.leads SET next_follow_up_at = (SELECT min(due_at) FROM erp.lead_activities WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${leadId}::uuid AND kind = 'task' AND done_at IS NULL), updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${leadId}::uuid`);
  }

  update(tenantId: string, actorId: string, id: string, p: Partial<Pick<LeadInput, 'name' | 'phone' | 'email' | 'city' | 'pincode' | 'state' | 'interest' | 'valueEstimate' | 'fields' | 'consent'>>, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cur = await this.lock(tx, tenantId, id, scope);
      if (p.fields) this.checkFields((await this.ensureSetup(tx, tenantId)).settings.customFields, p.fields, false);
      const phone = p.phone === undefined ? cur.phone : p.phone?.trim() || null;
      const email = p.email === undefined ? cur.email : p.email?.trim() || null;
      await tx.execute(sql`UPDATE erp.leads SET name = ${p.name?.trim() || cur.name}, phone = ${phone}, phone_norm = ${normalizePhone(phone)}, email = ${normalizeEmail(email) ?? email}, city = ${p.city === undefined ? cur.city : p.city?.trim() || null}, pincode = ${p.pincode === undefined ? cur.pincode : p.pincode?.trim() || null}, state = ${p.state === undefined ? cur.state : p.state?.trim() || null},
        interest = ${p.interest === undefined ? cur.interest : p.interest?.trim() || null}, value_estimate = ${p.valueEstimate === undefined ? cur.value_estimate : p.valueEstimate}, fields = ${JSON.stringify(p.fields ?? cur.fields)}::jsonb, consent = ${p.consent ?? cur.consent}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.recorder.record(tx, tenantId, 'lead', 'updated', { id }, { fields: Object.keys(p) });
      return { ok: true };
    });
  }

  setStage(tenantId: string, actorId: string, id: string, input: { stageId: string; lostReason?: string | undefined }, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cur = await this.lock(tx, tenantId, id, scope);
      const st = (await tx.execute<Stage>(sql`SELECT id, name, position, kind, status FROM erp.lead_stages WHERE tenant_id = ${tenantId}::uuid AND id = ${input.stageId}::uuid AND status = 'active'`)).rows[0];
      if (!st) throw validationFailed([{ path: 'stageId', message: 'That stage does not exist' }]);
      if (st.kind === 'lost' && !input.lostReason?.trim()) throw validationFailed([{ path: 'lostReason', message: 'Say why the lead was lost' }]);
      const old = (await tx.execute<{ name: string }>(sql`SELECT name FROM erp.lead_stages WHERE tenant_id = ${tenantId}::uuid AND id = ${cur.stage_id}::uuid`)).rows[0]?.name ?? '';
      await tx.execute(sql`UPDATE erp.leads SET stage_id = ${st.id}::uuid, status = ${st.kind}, lost_reason = ${st.kind === 'lost' ? input.lostReason?.trim() ?? null : null}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.activity(tx, tenantId, id, 'stage', `${old} → ${st.name}${st.kind === 'lost' ? `: ${input.lostReason?.trim()}` : ''}`, actorId);
      await this.recorder.record(tx, tenantId, 'lead', 'stage_changed', { id }, { from: old, to: st.name, status: st.kind });
      return { ok: true, status: st.kind };
    });
  }

  assign(tenantId: string, actorId: string, id: string, ownerId: string | null, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cur = await this.lock(tx, tenantId, id, scope);
      let name = 'nobody';
      if (ownerId) {
        const u = (await tx.execute<{ display_name: string }>(sql`SELECT display_name FROM erp.users WHERE tenant_id = ${tenantId}::uuid AND id = ${ownerId}::uuid AND status = 'active'`)).rows[0];
        if (!u) throw validationFailed([{ path: 'ownerId', message: 'That person is not an active user' }]);
        name = u.display_name;
      }
      if (cur.owner_id === ownerId) return { ok: true };
      await tx.execute(sql`UPDATE erp.leads SET owner_id = ${ownerId}::uuid, assigned_at = ${ownerId ? sql`now()` : sql`NULL`}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.activity(tx, tenantId, id, 'assign', `Assigned to ${name}`, actorId);
      await this.recorder.record(tx, tenantId, 'lead', 'assigned', { id }, { ownerId });
      return { ok: true };
    });
  }

  addActivity(tenantId: string, actorId: string, id: string, input: { kind: 'note' | 'call' | 'whatsapp' | 'email' | 'visit' | 'survey' | 'task'; body: string; dueAt?: string | undefined }, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.lock(tx, tenantId, id, scope);
      if (input.kind === 'task' && !input.dueAt) throw validationFailed([{ path: 'dueAt', message: 'A task needs a due date' }]);
      const actId = await this.activity(tx, tenantId, id, input.kind, input.body, actorId, input.dueAt);
      // the first thing done with the lead stops the response clock
      if (input.kind !== 'task') await tx.execute(sql`UPDATE erp.leads SET first_response_at = COALESCE(first_response_at, now()), updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      else await this.refreshFollowUp(tx, tenantId, id);
      return { id: actId };
    });
  }

  completeTask(tenantId: string, actorId: string, id: string, activityId: string, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.lock(tx, tenantId, id, scope);
      const r = await tx.execute(sql`UPDATE erp.lead_activities SET done_at = now() WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${id}::uuid AND id = ${activityId}::uuid AND kind = 'task' AND done_at IS NULL`);
      if ((r.rowCount ?? 0) === 0) throw new AppError(404, 'not_found', 'That task is not open');
      await this.refreshFollowUp(tx, tenantId, id);
      await this.activity(tx, tenantId, id, 'system', 'Task done', actorId);
      return { ok: true };
    });
  }

  /** Records that this lead is now a customer (the screen creates the customer through the normal customer form, then tells us which). */
  linkParty(tenantId: string, actorId: string, id: string, partyId: string, scope?: Scope) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cur = await this.lock(tx, tenantId, id, scope);
      if (cur.party_id && cur.party_id !== partyId) throw new AppError(409, 'already_linked', 'This lead is already linked to another customer');
      const p = (await tx.execute<{ legal_name: string; is_customer: boolean }>(sql`SELECT legal_name, is_customer FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${partyId}::uuid`)).rows[0];
      if (!p) throw new AppError(404, 'not_found', 'Customer not found');
      if (!p.is_customer) throw validationFailed([{ path: 'partyId', message: 'That party is not a customer' }]);
      await tx.execute(sql`UPDATE erp.leads SET party_id = ${partyId}::uuid, converted_at = COALESCE(converted_at, now()), updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.activity(tx, tenantId, id, 'system', `Became customer ${p.legal_name}`, actorId);
      await this.recorder.record(tx, tenantId, 'lead', 'converted', { id }, { partyId });
      return { ok: true };
    });
  }

  /** Folds a duplicate into the lead that should stay: its history moves across and it is closed as a duplicate. */
  merge(tenantId: string, actorId: string, id: string, intoId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (id === intoId) throw validationFailed([{ path: 'intoId', message: 'Choose a different lead' }]);
      const from = await this.lock(tx, tenantId, id); const into = await this.lock(tx, tenantId, intoId);
      const lost = (await tx.execute<{ id: string }>(sql`SELECT id FROM erp.lead_stages WHERE tenant_id = ${tenantId}::uuid AND kind = 'lost' AND status = 'active' ORDER BY position LIMIT 1`)).rows[0];
      await tx.execute(sql`UPDATE erp.lead_activities SET lead_id = ${intoId}::uuid WHERE tenant_id = ${tenantId}::uuid AND lead_id = ${id}::uuid`);
      await tx.execute(sql`UPDATE erp.leads SET status = 'lost', stage_id = ${lost?.id ?? from.stage_id}::uuid, lost_reason = 'Duplicate', duplicate_of = ${intoId}::uuid, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await tx.execute(sql`UPDATE erp.leads SET enquiry_count = enquiry_count + ${from.enquiry_count}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${intoId}::uuid`);
      await this.activity(tx, tenantId, intoId, 'system', `${from.lead_no} (${from.name}) was merged into this lead`, actorId);
      await this.refreshFollowUp(tx, tenantId, intoId);
      await this.recorder.record(tx, tenantId, 'lead', 'merged', { id }, { into: into.lead_no });
      return { ok: true };
    });
  }
}

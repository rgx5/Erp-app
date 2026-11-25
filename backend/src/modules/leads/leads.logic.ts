/** The pure parts of leads: tidying what arrives from forms and ad platforms, and choosing who gets a lead. Nothing here touches the database. */

export const SOURCES = ['website', 'meta', 'google', 'webhook', 'manual', 'import', 'indiamart', 'justdial', 'referral', 'walkin', 'phone', 'whatsapp', 'other'] as const;
export type Source = (typeof SOURCES)[number];

/** Digits only; an Indian number is reduced to its ten digits so +91 98100 00001, 09810000001 and 9810000001 are the same person. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length < 7) return null;
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  if (d.length === 13 && d.startsWith('091')) return d.slice(3);
  return d.slice(0, 15);
}
export const normalizeEmail = (raw: string | null | undefined): string | null => {
  const e = (raw ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : null;
};
const clip = (v: unknown, n: number): string | null => { const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''; const t = s.trim().slice(0, n); return t === '' ? null : t; };

export interface Incoming {
  name: string; phone: string | null; email: string | null; city: string | null; pincode: string | null; state: string | null;
  campaign: string | null; adset: string | null; ad: string | null; formName: string | null; clickId: string | null; utm: Record<string, string>; interest: string | null;
  fields: Record<string, string>; consent: boolean; externalId: string | null;
}
const blank = (): Incoming => ({ name: '', phone: null, email: null, city: null, pincode: null, state: null, campaign: null, adset: null, ad: null, formName: null, clickId: null, utm: {}, interest: null, fields: {}, consent: false, externalId: null });

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
const truthy = (v: unknown): boolean => v === true || (typeof v === 'string' && /^(true|yes|y|1|on|agree|agreed|i agree)$/i.test(v.trim()));

/** Maps a field name from any form (a question, a column id) onto one of ours, or null when it is something extra to keep as it is. */
export function fieldTarget(key: string): keyof Pick<Incoming, 'name' | 'phone' | 'email' | 'city' | 'pincode' | 'state' | 'interest'> | 'first' | 'last' | 'consent' | null {
  const k = slug(key);
  if (['name', 'full_name', 'fullname', 'your_name', 'customer_name', 'contact_name'].includes(k)) return 'name';
  if (['first_name', 'firstname', 'fname'].includes(k)) return 'first';
  if (['last_name', 'lastname', 'lname', 'surname'].includes(k)) return 'last';
  if (['phone', 'phone_number', 'mobile', 'mobile_number', 'mobile_no', 'contact_number', 'whatsapp', 'whatsapp_number', 'tel', 'telephone', 'contact'].includes(k)) return 'phone';
  if (['email', 'email_address', 'e_mail', 'work_email'].includes(k)) return 'email';
  if (['city', 'town', 'location', 'your_city'].includes(k)) return 'city';
  if (['pincode', 'pin_code', 'pin', 'zip', 'zip_code', 'postal_code', 'post_code', 'postcode', 'zipcode'].includes(k)) return 'pincode';
  if (['state', 'region', 'province'].includes(k)) return 'state';
  if (['interest', 'product', 'service', 'requirement', 'interested_in'].includes(k)) return 'interest';
  if (['consent', 'agree', 'terms', 'privacy', 'accept'].includes(k)) return 'consent';
  return null;
}

function put(out: Incoming, key: string, value: unknown, first: { v: string; l: string }): void {
  const text = typeof value === 'boolean' ? (value ? 'yes' : 'no') : clip(value, 500);
  if (text === null) return;
  const t = fieldTarget(key);
  if (t === 'first') first.v = text;
  else if (t === 'last') first.l = text;
  else if (t === 'consent') out.consent = truthy(value);
  else if (t === 'name' && !out.name) out.name = text.slice(0, 200);
  else if (t === 'phone' && !out.phone) out.phone = text.slice(0, 30);
  else if (t === 'email' && !out.email) out.email = text.slice(0, 254);
  else if (t === 'city' && !out.city) out.city = text.slice(0, 100);
  else if (t === 'pincode' && !out.pincode) out.pincode = text.slice(0, 12);
  else if (t === 'state' && !out.state) out.state = text.slice(0, 100);
  else if (t === 'interest' && !out.interest) out.interest = text.slice(0, 200);
  else if (t === null && Object.keys(out.fields).length < 40) out.fields[slug(key) || 'field'] = text;
}
const finish = (out: Incoming, first: { v: string; l: string }): Incoming => { if (!out.name) out.name = [first.v, first.l].filter(Boolean).join(' ').trim(); return out; };

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

/** A website form or generic webhook: a flat set of fields, with campaign tags and click ids picked out. */
export function fromWebsite(body: Record<string, unknown>): Incoming {
  const out = blank(); const first = { v: '', l: '' };
  for (const [k, v] of Object.entries(body)) {
    const s = slug(k);
    if (UTM_KEYS.includes(s)) { const t = clip(v, 200); if (t) out.utm[s] = t; continue; }
    if (s === 'gclid' || s === 'fbclid' || s === 'wbraid' || s === 'gbraid') { out.clickId ??= clip(v, 200); continue; }
    if (s === 'page' || s === 'page_url' || s === 'url' || s === 'referrer') { const t = clip(v, 300); if (t) out.fields[s] = t; continue; }
    if (s === 'campaign' || s === 'campaign_name') { out.campaign = clip(v, 200); continue; }
    if (s === 'adset' || s === 'ad_set') { out.adset = clip(v, 200); continue; }
    if (s === 'ad' || s === 'ad_name') { out.ad = clip(v, 200); continue; }
    if (s === 'form' || s === 'form_name') { out.formName = clip(v, 200); continue; }
    if (s === 'external_id' || s === 'lead_id' || s === 'id') { out.externalId = clip(v, 120); continue; }
    if (s === 'message' || s === 'comments' || s === 'notes' || s === 'enquiry' || s === 'query') { const t = clip(v, 1000); if (t) out.fields['message'] = t; continue; }
    if (v !== null && typeof v === 'object') continue;
    put(out, k, v, first);
  }
  if (!out.campaign && out.utm['utm_campaign']) out.campaign = out.utm['utm_campaign'] as string;
  return finish(out, first);
}

/** The answers on a Meta (Facebook / Instagram) lead form, as the Graph API returns them: field_data is a list of { name, values }. */
export function fromMeta(lead: { id?: string; created_time?: string; ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string; form_id?: string; form_name?: string; field_data?: { name?: string; values?: unknown[] }[] }): Incoming {
  const out = blank(); const first = { v: '', l: '' };
  for (const f of lead.field_data ?? []) { if (typeof f?.name === 'string') put(out, f.name, Array.isArray(f.values) ? f.values.join(', ') : '', first); }
  out.externalId = clip(lead.id, 120);
  out.campaign = clip(lead.campaign_name ?? lead.campaign_id, 200); out.adset = clip(lead.adset_name ?? lead.adset_id, 200); out.ad = clip(lead.ad_name ?? lead.ad_id, 200); out.formName = clip(lead.form_name ?? lead.form_id, 200);
  return finish(out, first);
}

/** A Google Ads lead form submission, as Google posts it to a webhook. */
export function fromGoogle(p: { lead_id?: string; campaign_id?: string | number; adgroup_id?: string | number; creative_id?: string | number; form_id?: string | number; gcl_id?: string; user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[] }): Incoming {
  const out = blank(); const first = { v: '', l: '' };
  for (const c of p.user_column_data ?? []) {
    const id = c.column_id ?? c.column_name ?? '';
    put(out, id.startsWith('QUESTION') || id.startsWith('CUSTOM') ? (c.column_name ?? id) : id, c.string_value ?? '', first);
  }
  out.externalId = clip(p.lead_id, 120); out.campaign = clip(p.campaign_id, 200); out.adset = clip(p.adgroup_id, 200); out.ad = clip(p.creative_id, 200); out.formName = clip(p.form_id, 200); out.clickId = clip(p.gcl_id, 200);
  return finish(out, first);
}

export interface AssignRule { match?: { city?: string[]; pincodePrefix?: string[]; source?: string[]; campaign?: string[] }; users: string[] }
const has = (list: string[] | undefined, value: string | null | undefined, how: 'equals' | 'prefix' | 'contains'): boolean => {
  if (!list || list.length === 0) return true;
  const v = (value ?? '').toLowerCase().trim(); if (!v) return false;
  return list.some((x) => { const m = x.toLowerCase().trim(); return how === 'prefix' ? v.startsWith(m) : how === 'contains' ? v.includes(m) : v === m; });
};
/** Who gets a lead: the first rule whose conditions all fit names a pool; otherwise the default members. The cursor moves on so the work is shared evenly. Returns the owner and the new cursor. */
export function pickOwner(mode: 'manual' | 'round_robin', members: string[], rules: AssignRule[], lead: { city: string | null; pincode: string | null; source: string; campaign: string | null }, cursor: number, active: ReadonlySet<string>): { owner: string | null; cursor: number } {
  if (mode !== 'round_robin') return { owner: null, cursor };
  const rule = rules.find((r) => r.users.some((u) => active.has(u)) && has(r.match?.city, lead.city, 'equals') && has(r.match?.pincodePrefix, lead.pincode, 'prefix') && has(r.match?.source, lead.source, 'equals') && has(r.match?.campaign, lead.campaign, 'contains'));
  const pool = (rule ? rule.users : members).filter((u) => active.has(u));
  if (pool.length === 0) return { owner: null, cursor };
  const i = ((cursor % pool.length) + pool.length) % pool.length;
  return { owner: pool[i] as string, cursor: cursor + 1 };
}

export const DEFAULT_STAGES: { name: string; kind: 'open' | 'won' | 'lost' }[] = [
  { name: 'New', kind: 'open' }, { name: 'Contacted', kind: 'open' }, { name: 'Site survey', kind: 'open' }, { name: 'Proposal sent', kind: 'open' }, { name: 'Negotiation', kind: 'open' }, { name: 'Won', kind: 'won' }, { name: 'Lost', kind: 'lost' },
];

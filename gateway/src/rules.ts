import { BlockList, isIP } from 'node:net';

export interface Rules { mode: 'full' | 'readonly' | 'owner_only'; networks: string[]; hours: { days: number[]; from: string; to: string; timezone: string } | null; requestsPerSecond: number | null }
export interface Refusal { status: number; code: string; message: string }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Reads the rules the control plane sent. Anything unrecognised returns null, and a site whose rules cannot be read is refused rather than left open. */
export function readRules(v: unknown): Rules | null {
  if (v === undefined || v === null) return { mode: 'full', networks: [], hours: null, requestsPerSecond: null };
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const mode = o['mode'] ?? 'full'; if (mode !== 'full' && mode !== 'readonly' && mode !== 'owner_only') return null;
  const nets = o['allowedNetworks'] ?? []; if (!Array.isArray(nets) || nets.length > 50 || !nets.every((n) => typeof n === 'string' && parseNet(n))) return null;
  const h = o['hours'] ?? null; let hours: Rules['hours'] = null;
  if (h !== null) {
    const x = h as Record<string, unknown>;
    if (typeof h !== 'object' || !Array.isArray(x['days']) || !x['days'].every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) || typeof x['from'] !== 'string' || !HHMM.test(x['from']) || typeof x['to'] !== 'string' || !HHMM.test(x['to']) || typeof x['timezone'] !== 'string') return null;
    try { new Intl.DateTimeFormat('en', { timeZone: x['timezone'] }); } catch { return null; }
    hours = { days: x['days'] as number[], from: x['from'], to: x['to'], timezone: x['timezone'] };
  }
  const rps = o['requestsPerSecond']; if (rps !== undefined && (!Number.isInteger(rps) || (rps as number) < 1 || (rps as number) > 200)) return null;
  return { mode, networks: nets as string[], hours, requestsPerSecond: (rps as number | undefined) ?? null };
}

function parseNet(s: string): { a: string; p: number; v: 4 | 6 } | null {
  const [a, p, extra] = s.trim().split('/'); if (!a || extra !== undefined) return null;
  const v = isIP(a); if (!v) return null; const max = v === 4 ? 32 : 128;
  const prefix = p === undefined ? max : /^\d{1,3}$/.test(p) ? Number(p) : -1;
  return prefix < 0 || prefix > max ? null : { a, p: prefix, v: v as 4 | 6 };
}
const listCache = new WeakMap<Rules, BlockList>();
function inNetworks(r: Rules, ip: string): boolean {
  let list = listCache.get(r);
  if (!list) { list = new BlockList(); for (const n of r.networks) { const p = parseNet(n)!; list.addSubnet(p.a, p.p, p.v === 4 ? 'ipv4' : 'ipv6'); } listCache.set(r, list); }
  const plain = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip; // an IPv4 address seen through an IPv6 socket
  const v = isIP(plain); if (!v) return false;
  return list.check(plain, v === 4 ? 'ipv4' : 'ipv6');
}

const DAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function inHours(h: NonNullable<Rules['hours']>, at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: h.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = DAY[get('weekday')] ?? 0; const mins = Number(get('hour')) * 60 + Number(get('minute'));
  const [fh, fm] = h.from.split(':').map(Number) as [number, number]; const [th, tm] = h.to.split(':').map(Number) as [number, number];
  const from = fh * 60 + fm; const to = th * 60 + tm;
  if (from === to) return h.days.includes(day); // the whole of each listed day
  if (from < to) return h.days.includes(day) && mins >= from && mins < to;
  return (h.days.includes(day) && mins >= from) || (h.days.includes((day + 6) % 7) && mins < to); // overnight: the late part belongs to the day it started
}

const AUTH_ANY = /^\/v1\/auth\/(login|refresh|logout)$/;
const OWNER_READS = new Set(['/owner', '/v1/auth/me', '/v1/dashboard', '/v1/receivables/ageing', '/v1/companies']);

/** Decides whether one remote request may go through. `/health/live` is never limited. null = allowed. */
export function check(r: Rules, req: { method: string; path: string; ip: string; at: Date }): Refusal | null {
  const path = (req.path.split('?')[0] ?? '').toLowerCase().replace(/\/+$/, '') || '/';
  if (path === '/health/live') return null;
  if (r.networks.length > 0 && !inNetworks(r, req.ip)) return { status: 403, code: 'remote_network_blocked', message: 'This business does not allow remote access from where you are connecting. Use the office network or ask the owner.' };
  if (r.hours && !inHours(r.hours, req.at)) return { status: 403, code: 'remote_hours_blocked', message: 'Remote access for this business is closed at this time. Try during the allowed hours.' };
  const m = req.method.toUpperCase();
  const reading = m === 'GET' || m === 'HEAD';
  if (r.mode === 'readonly' && !reading && !AUTH_ANY.test(path)) return { status: 403, code: 'remote_readonly', message: 'Remote access for this business is view-only. Make changes from the office.' };
  if (r.mode === 'owner_only' && !(AUTH_ANY.test(path) || (reading && OWNER_READS.has(path)))) return { status: 403, code: 'remote_owner_only', message: 'Remote access for this business shows the owner dashboard only.' };
  return null;
}

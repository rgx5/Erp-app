import { isIP } from 'node:net';
import { z } from 'zod';

/** A single address or a network such as 203.0.113.0/24 or 2001:db8::/32. */
export function parseNetwork(s: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const [a, p, extra] = s.trim().split('/');
  if (!a || extra !== undefined) return null;
  const v = isIP(a); if (!v) return null;
  const max = v === 4 ? 32 : 128;
  const prefix = p === undefined ? max : /^\d{1,3}$/.test(p) ? Number(p) : -1;
  if (prefix < 0 || prefix > max) return null;
  return { address: a, prefix, family: v === 4 ? 'ipv4' : 'ipv6' };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const zone = z.string().min(1).max(60).refine((z) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } }, 'Unknown time zone');

/**
 * What remote users of one client may do. `full` is everything the product allows remotely; `readonly` blocks every change (sign-in and sign-out still work);
 * `owner_only` allows only the owner dashboard page and the few reads it makes. Networks empty = from anywhere. Hours null = at any time.
 */
export const remoteRulesSchema = z.strictObject({
  mode: z.enum(['full', 'readonly', 'owner_only']).default('full'),
  allowedNetworks: z.array(z.string().refine((s) => parseNetwork(s) !== null, 'Use an address or a network like 203.0.113.0/24')).max(50).default([]),
  hours: z.strictObject({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), from: hhmm, to: hhmm, timezone: zone }).nullable().default(null),
  requestsPerSecond: z.number().int().min(1).max(200).optional(),
});
export type RemoteRules = z.infer<typeof remoteRulesSchema>;
/** A stored value, read back: an empty or damaged object means the defaults (no extra limits) for the control plane's own display; the gateway is told exactly what is stored. */
export const readRules = (v: unknown): RemoteRules => { const r = remoteRulesSchema.safeParse(v ?? {}); return r.success ? r.data : remoteRulesSchema.parse({}); };

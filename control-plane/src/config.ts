import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(0).max(65535).default(8090),
  HOST: z.string().default('127.0.0.1'),
  /** Ed25519 private key (PEM) that signs licences. Servers verify with its public key (their LICENCE_PUBLIC_KEY). */
  LICENCE_PRIVATE_KEY: z.string().min(20),
  /** Ed25519 private key (PEM) that signs release manifests. Site agents verify with its public key. */
  RELEASE_PRIVATE_KEY: z.string().min(20),
  SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** A site that has not reported for this many minutes is silent. */
  SILENT_AFTER_MINUTES: z.coerce.number().int().min(1).default(10),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** 32 random bytes, base64: seals staff two-step secrets at rest. Required in production. */
  DATA_ENCRYPTION_KEY: z.string().optional(),
  /** Shared secret the gateway presents when it asks whether a site's tunnel may connect. */
  GATEWAY_TOKEN: z.string().min(32).optional(),
  /** Public key (PEM) that each site's backup key is sealed to (made with `cli escrow-keygen`; the private key is split between two custodians). */
  ESCROW_PUBLIC_KEY: z.string().min(50).optional(),
  /** Staff must set up two-step sign-in before they can do anything else. Default: on in production. */
  REQUIRE_STAFF_MFA: z.enum(['true', 'false']).optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.DATA_ENCRYPTION_KEY) ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'is required in production' });
  if (env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length !== 32) ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'must be 32 random bytes, base64-encoded' });
});
export type Config = z.infer<typeof schema>;
/** Whether staff must have two-step sign-in. */
export const mfaRequired = (c: Config): boolean => (c.REQUIRE_STAFF_MFA ?? (c.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';
/** Keys pasted into a hosting panel often arrive on one line with the line breaks written as \n: turn them back. */
const PEM_VARS = ['LICENCE_PRIVATE_KEY', 'RELEASE_PRIVATE_KEY', 'ESCROW_PUBLIC_KEY'];
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '').map((([k, v]) => [k, PEM_VARS.includes(k) && typeof v === 'string' ? v.replace(/\\n/g, '\n') : v]))));

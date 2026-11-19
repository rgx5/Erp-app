import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(8080),
    HOST: z.string().min(1).default('0.0.0.0'),
    HTTP_ADAPTER: z.enum(['fastify', 'node']).default('fastify'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** The runtime (application) role. It must not own the tables and must not bypass RLS: checked again at boot. */
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
    DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(100).default(30_000),
    /** Ed25519 private key (PKCS#8 PEM) that signs access tokens. Required in production; development generates an ephemeral one. */
    AUTH_JWT_PRIVATE_KEY: z.string().min(1).optional(),
    /** JSON array of PEM public keys that are still accepted for verification (key rotation window). */
    AUTH_JWT_PREVIOUS_PUBLIC_KEYS: z.string().optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).default(2_592_000),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().min(60).default(900),
    /** 32 random bytes, base64. Encrypts MFA secrets at rest. Required in production; development generates an ephemeral one. */
    DATA_ENCRYPTION_KEY: z.string().optional(),
    /** The outbox relay delivers committed events to consumers. Several instances may run it at once (SKIP LOCKED + leases). */
    OUTBOX_RELAY_ENABLED: bool.optional(),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
    OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).default(60),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
    /** Allows POST /v1/auth/signup (anyone can create a tenant). Off by default; tenants are otherwise provisioned by the platform operator. */
    SELF_SIGNUP_ENABLED: bool.optional(),
    /** Enables POST /v1/platform/tenants. At least 32 characters. Unset disables the endpoint. */
    PLATFORM_ADMIN_TOKEN: z.string().min(32).optional(),
    /** Ed25519 public key (PEM) that signed licences must verify against. Absent: signed licences cannot be imported. */
    LICENCE_PUBLIC_KEY: z.string().min(20).optional(),
    /** The site this server runs at (an id from /v1/sites). Absent: records belong to the primary site. Needed per server once a client has several sites. */
    SITE_ID: z.uuid().optional(),
    /** The oldest desktop client this server serves. Absent: any. Clients older than this are told to update. */
    MIN_CLIENT_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    SWAGGER_ENABLED: bool.optional(),
    /** Requests allowed per client address per window; 0 turns the limiter off. */
    RATE_LIMIT_PER_WINDOW: z.coerce.number().int().min(0).default(0),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
    /** How long an authenticated principal may be reused without asking the database again; 0 (default) checks every request. */
    AUTH_PRINCIPAL_CACHE_TTL_MS: z.coerce.number().int().min(0).max(60_000).default(0),
    /** Browser/desktop origins allowed to call the API, comma separated (for example `app://onesync,https://erp.example.com`). Empty = none. Never `*`. */
    CORS_ALLOWED_ORIGINS: z.string().default('').transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)).refine((l) => !l.includes('*'), 'A wildcard origin is not allowed'),
    REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.AUTH_JWT_PRIVATE_KEY) ctx.addIssue({ code: 'custom', path: ['AUTH_JWT_PRIVATE_KEY'], message: 'is required in production' });
      if (!env.DATA_ENCRYPTION_KEY) ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'is required in production' });
    }
    if (env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length !== 32) {
      ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'must be 32 bytes, base64-encoded' });
    }
  });

export type Env = Omit<z.infer<typeof schema>, 'SWAGGER_ENABLED' | 'SELF_SIGNUP_ENABLED' | 'OUTBOX_RELAY_ENABLED'> & { SWAGGER_ENABLED: boolean; SELF_SIGNUP_ENABLED: boolean; OUTBOX_RELAY_ENABLED: boolean };

/** Reads and validates the environment once. Anything missing or malformed stops the process at startup. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Keys pasted into a hosting panel often arrive on one line with the line breaks written as \n: turn them back.
  // A hosting panel (or a compose file) passes an unset optional setting as an empty string: that means "not set".
  const fixed = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '').map(([k, v]) => [k, (k === 'AUTH_JWT_PRIVATE_KEY' || k === 'LICENCE_PUBLIC_KEY') && typeof v === 'string' ? v.replace(/\\n/g, '\n') : v]));
  const parsed = schema.safeParse(fixed);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const env = parsed.data;
  return { ...env, SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production', SELF_SIGNUP_ENABLED: env.SELF_SIGNUP_ENABLED ?? false, OUTBOX_RELAY_ENABLED: env.OUTBOX_RELAY_ENABLED ?? env.NODE_ENV !== 'test' };
}

export const ENV = Symbol('ENV');

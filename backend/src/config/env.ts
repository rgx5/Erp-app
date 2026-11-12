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
    SWAGGER_ENABLED: bool.optional(),
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
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const env = parsed.data;
  return { ...env, SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production', SELF_SIGNUP_ENABLED: env.SELF_SIGNUP_ENABLED ?? false, OUTBOX_RELAY_ENABLED: env.OUTBOX_RELAY_ENABLED ?? env.NODE_ENV !== 'test' };
}

export const ENV = Symbol('ENV');

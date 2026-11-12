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
    /** Slice 0 only: the tenant comes from the X-Tenant-Id header. Replaced by the identity slice. */
    AUTH_MODE: z.enum(['dev-header']).default('dev-header'),
    /** Enables POST /v1/platform/tenants. At least 32 characters. Unset disables the endpoint. */
    PLATFORM_ADMIN_TOKEN: z.string().min(32).optional(),
    SWAGGER_ENABLED: bool.optional(),
    REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'dev-header') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev-header trusts a client-supplied header and must not run in production',
      });
    }
  });

export type Env = Omit<z.infer<typeof schema>, 'SWAGGER_ENABLED'> & { SWAGGER_ENABLED: boolean };

/** Reads and validates the environment once. Anything missing or malformed stops the process at startup. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const env = parsed.data;
  return { ...env, SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production' };
}

export const ENV = Symbol('ENV');

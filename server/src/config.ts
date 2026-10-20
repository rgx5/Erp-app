export interface Config {
  databaseUrl: string
  jwtSecret: string
  port: number
  host: string
  corsOrigins: string[]
  filesDir: string
  production: boolean
  bcryptCost: number
  tokenTtlSeconds: number
  publicUrl: string
  trustProxy: boolean
  /** Accept self-service sign-up of new organisations (turn off on a server that hosts a single business). */
  allowSignup: boolean
}

const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me'

/** Reads the environment. In production a missing JWT_SECRET or DATABASE_URL is a startup error, never a silent default. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  const databaseUrl = env.DATABASE_URL ?? ''
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  let jwtSecret = env.JWT_SECRET ?? ''
  if (!jwtSecret) {
    if (production) throw new Error('JWT_SECRET is required in production (generate one with: openssl rand -hex 32)')
    jwtSecret = DEV_SECRET
  }
  if (production && jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters')
  return {
    databaseUrl,
    jwtSecret,
    port: Number(env.PORT ?? 8090),
    host: env.HOST ?? '0.0.0.0',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    filesDir: env.FILES_DIR ?? './data/files',
    production,
    bcryptCost: Number(env.BCRYPT_COST ?? 10),
    tokenTtlSeconds: Number(env.TOKEN_TTL_SECONDS ?? 43_200),
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    allowSignup: env.ALLOW_SIGNUP !== '0' && env.ALLOW_SIGNUP !== 'false',
  }
}

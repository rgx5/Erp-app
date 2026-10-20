import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { Config } from './config'

export interface Claims {
  /** The user id. */
  sub: string
  org: string
  /** The device this token was issued to. */
  dev: string
  /** The user's `token_ver` when issued: a password change bumps it and ends every older token. */
  ver: number
  /** The device's `session_ver` when issued: "sign out" bumps it. */
  sv: number
}

export function signToken(cfg: Config, c: Claims, ttl = cfg.tokenTtlSeconds): string {
  return jwt.sign(c, cfg.jwtSecret, { algorithm: 'HS256', expiresIn: ttl })
}

export function verifyToken(cfg: Config, token: string): Claims | null {
  try {
    const p = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] }) as Partial<Claims>
    if (typeof p.sub !== 'string' || typeof p.org !== 'string' || typeof p.dev !== 'string' || typeof p.ver !== 'number' || typeof p.sv !== 'number') return null
    return { sub: p.sub, org: p.org, dev: p.dev, ver: p.ver, sv: p.sv }
  } catch {
    return null
  }
}

// ── API keys: `kosh_<keyId>_<secret>`; only a hash of the secret is stored ──

export const API_KEY_PREFIX = 'kosh_'
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex')

export function newApiKey(): { id: string; secret: string; key: string } {
  const id = randomBytes(8).toString('hex')
  const secret = randomBytes(24).toString('hex')
  return { id, secret, key: `${API_KEY_PREFIX}${id}_${secret}` }
}

export function parseApiKey(token: string): { id: string; secret: string } | null {
  const m = /^kosh_([0-9a-f]{16})_([0-9a-f]{48})$/.exec(token)
  return m ? { id: m[1], secret: m[2] } : null
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

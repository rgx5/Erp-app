import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

export interface AccessClaims {
  sub: string; // user id
  tid: string; // tenant id
  sid: string; // session family id
  iat: number;
  exp: number;
}

const ISSUER = 'onesync-erp';
const AUDIENCE = 'onesync-erp-api';
const b64 = (value: Buffer | string): string => Buffer.from(value).toString('base64url');
const kidOf = (publicKey: KeyObject): string => createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('base64url').slice(0, 16);

/**
 * Signs and verifies EdDSA (Ed25519) JWTs. `previousPublicKeys` keep tokens signed by a retired key valid until they
 * expire, which is how keys are rotated without logging everyone out. Only EdDSA is ever accepted (no `alg` confusion).
 */
export class TokenService {
  private readonly privateKey: KeyObject;
  private readonly kid: string;
  private readonly verifiers = new Map<string, KeyObject>();
  readonly ephemeral: boolean;

  constructor(privateKeyPem: string | undefined, previousPublicKeysPem: string[] = []) {
    this.ephemeral = !privateKeyPem;
    this.privateKey = privateKeyPem ? createPrivateKey(privateKeyPem) : generateKeyPairSync('ed25519').privateKey;
    if (this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('AUTH_JWT_PRIVATE_KEY must be an Ed25519 key');
    const publicKey = createPublicKey(this.privateKey);
    this.kid = kidOf(publicKey);
    this.verifiers.set(this.kid, publicKey);
    for (const pem of previousPublicKeysPem) {
      const key = createPublicKey(pem);
      this.verifiers.set(kidOf(key), key);
    }
  }

  issue(claims: Pick<AccessClaims, 'sub' | 'tid' | 'sid'>, ttlSeconds: number, now = Date.now()): string {
    const iat = Math.floor(now / 1000);
    const header = b64(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: this.kid }));
    const payload = b64(JSON.stringify({ iss: ISSUER, aud: AUDIENCE, ...claims, iat, exp: iat + ttlSeconds }));
    const signature = sign(null, Buffer.from(`${header}.${payload}`), this.privateKey);
    return `${header}.${payload}.${b64(signature)}`;
  }

  /** Returns the claims, or `undefined` for anything wrong with the token (the caller reports one generic failure). */
  verify(token: string, now = Date.now()): AccessClaims | undefined {
    try {
      const [header, payload, signature, extra] = token.split('.');
      if (!header || !payload || !signature || extra !== undefined) return undefined;
      const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
      if (head.alg !== 'EdDSA' || !head.kid) return undefined;
      const key = this.verifiers.get(head.kid);
      if (!key || !verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'))) return undefined;
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (claims['iss'] !== ISSUER || claims['aud'] !== AUDIENCE) return undefined;
      const { sub, tid, sid, iat, exp } = claims;
      if (typeof sub !== 'string' || typeof tid !== 'string' || typeof sid !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') return undefined;
      if (exp * 1000 <= now) return undefined;
      return { sub, tid, sid, iat, exp };
    } catch {
      return undefined;
    }
  }
}

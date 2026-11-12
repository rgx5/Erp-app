import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM envelope for small secrets at rest (TOTP seeds). Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox needs a 32-byte key');
  }

  seal(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }

  /** `aad` binds the secret to its owner (tenant:user), so a sealed value cannot be moved to another row. */
  open(sealed: string, aad: string): string {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unsupported sealed value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }
}

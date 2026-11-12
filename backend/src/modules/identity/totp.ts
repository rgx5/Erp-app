import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 time-based one-time passwords (HMAC-SHA1, 6 digits, 30 s) — what every authenticator app implements.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export function totpCode(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Accepts the current 30 s step and one step either side (clock drift). Returns the matching step so the caller can refuse a
 * code that was already used (replay), or `undefined` when nothing matches.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const step = Math.floor(now / 30_000);
  for (const candidate of [step, step - 1, step + 1]) {
    const expected = Buffer.from(totpCode(secret, candidate));
    if (timingSafeEqual(expected, Buffer.from(code))) return candidate;
  }
  return undefined;
}

export const otpauthUri = (secret: string, account: string, issuer: string): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

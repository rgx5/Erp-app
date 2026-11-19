import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

/** Stable text for signing: object keys sorted at every level, so the same document always signs to the same bytes. The product servers use the same rule. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const signDocument = (doc: unknown, privatePem: string): string => sign(null, Buffer.from(canonical(doc)), createPrivateKey(privatePem)).toString('base64');
export function verifyDocument(doc: unknown, signature: string, publicPem: string): boolean {
  try { return verify(null, Buffer.from(canonical(doc)), createPublicKey(publicPem), Buffer.from(signature, 'base64')); } catch { return false; }
}
export const publicKeyOf = (privatePem: string): string => createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'pem' }).toString();
export const sha256 = (text: string): Buffer => createHash('sha256').update(text).digest();
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

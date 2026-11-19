import { createPrivateKey, constants, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';

/**
 * Escrow of each client's backup key. A key is sealed to an escrow PUBLIC key held here, so this service can store it but never read it back.
 * The matching private key is split into two shares (each alone is random noise) held by two custodians: opening a sealed key needs both.
 */
export function generateEscrowKeys(): { publicKey: string; shares: [string, string] } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const pem = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  const a = randomBytes(pem.length);
  const b = Buffer.alloc(pem.length);
  for (let i = 0; i < pem.length; i++) b[i] = (pem[i] as number) ^ (a[i] as number);
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), shares: [a.toString('base64'), b.toString('base64')] };
}
export function sealToEscrow(secret: string, publicPem: string): string {
  return publicEncrypt({ key: publicPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(secret)).toString('base64');
}
export function openEscrow(sealed: string, shareA: string, shareB: string): string {
  const a = Buffer.from(shareA, 'base64'); const b = Buffer.from(shareB, 'base64');
  if (a.length !== b.length) throw new Error('The two shares do not belong together');
  const pem = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) pem[i] = (a[i] as number) ^ (b[i] as number);
  return privateDecrypt({ key: createPrivateKey(pem.toString()), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(sealed, 'base64')).toString();
}

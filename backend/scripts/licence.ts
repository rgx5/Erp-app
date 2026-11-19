/**
 * Control-plane tool for licences.
 *   npx tsx scripts/licence.ts keys                      prints a new Ed25519 key pair (keep the private key secret; set the public key on servers as LICENCE_PUBLIC_KEY)
 *   LICENCE_PRIVATE_KEY=... npx tsx scripts/licence.ts sign licence.json     prints the signed licence for POST /v1/platform/tenants/:id/licence
 */
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonical, licenceSchema } from '../src/modules/identity/entitlements.service.js';

const [command, file] = process.argv.slice(2);
if (command === 'keys') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  console.log(JSON.stringify({ LICENCE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }), LICENCE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, null, 2));
} else if (command === 'sign' && file) {
  const priv = process.env['LICENCE_PRIVATE_KEY'];
  if (!priv) { console.error('LICENCE_PRIVATE_KEY is required'); process.exit(2); }
  const parsed = licenceSchema.safeParse({ issuedAt: new Date().toISOString(), ...JSON.parse(readFileSync(file, 'utf8')) });
  if (!parsed.success) { console.error(JSON.stringify(parsed.error.issues, null, 2)); process.exit(2); }
  console.log(JSON.stringify({ licence: parsed.data, signature: sign(null, Buffer.from(canonical(parsed.data)), createPrivateKey(priv)).toString('base64') }, null, 2));
} else {
  console.error('usage: licence.ts keys | licence.ts sign <licence.json>');
  process.exit(2);
}

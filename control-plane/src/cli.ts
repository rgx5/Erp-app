/**
 *   npm run cli -- keys                                  prints two new Ed25519 key pairs (licence and release signing). Keep the private keys secret.
 *   npm run cli -- create-staff <email> <name> <role>    creates a staff user (reads the password from CP_PASSWORD). The first admin is made this way.
 *   npm run cli -- escrow-keygen                         makes the escrow key: prints the public key (set ESCROW_PUBLIC_KEY) and TWO shares of the private key for two custodians
 *   npm run cli -- escrow-open <sealed> <shareA> <shareB>  opens a sealed backup key (for a recovery ceremony only)
 */
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { createPool, migrate } from './db.js';
import { generateEscrowKeys, openEscrow } from './escrow.js';

const [command, ...args] = process.argv.slice(2);
const pair = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { public: publicKey.export({ type: 'spki', format: 'pem' }), private: privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };
if (command === 'keys') {
  console.log(JSON.stringify({ LICENCE: pair(), RELEASE: pair() }, null, 2));
} else if (command === 'escrow-keygen') {
  const k = generateEscrowKeys();
  console.log(JSON.stringify({ ESCROW_PUBLIC_KEY: k.publicKey, shareForCustodianA: k.shares[0], shareForCustodianB: k.shares[1], warning: 'Give each share to a different person to store offline. Neither share alone can open anything. Do not keep both together.' }, null, 2));
} else if (command === 'escrow-open') {
  const [sealed, a, b] = args;
  if (!sealed || !a || !b) { console.error('usage: cli escrow-open <sealed> <shareA> <shareB>'); process.exit(2); }
  console.log(openEscrow(sealed, a, b));
} else if (command === 'create-staff') {
  const [email, name, role] = args;
  const password = process.env['CP_PASSWORD'];
  if (!email || !name || !role || !password || password.length < 12 || !process.env['DATABASE_URL']) { console.error('usage: DATABASE_URL=... CP_PASSWORD=<12+ chars> cli create-staff <email> <name> <admin|support|viewer>'); process.exit(2); }
  const pool = createPool(process.env['DATABASE_URL']);
  await migrate(pool);
  await pool.query('INSERT INTO staff_users (id, email, display_name, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), email, name, await hash(password), role]);
  console.log(`created ${email} (${role})`);
  await pool.end();
} else { console.error('usage: cli keys | cli create-staff <email> <name> <role> | cli escrow-keygen | cli escrow-open <sealed> <shareA> <shareB>'); process.exit(2); }

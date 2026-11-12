import { hash, verify } from '@node-rs/argon2';

// argon2id with the OWASP-recommended minimum profile (19 MiB, 2 iterations, 1 lane). Parameters are stored in each hash,
// so they can be raised later and old hashes still verify (see `needsRehash`).
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 } as const; // 2 = Argon2id

export const hashPassword = (password: string): Promise<string> => hash(password, PARAMS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false; // a malformed stored hash never authenticates
  }
}

export const needsRehash = (stored: string): boolean => !stored.startsWith(`$argon2id$v=19$m=${PARAMS.memoryCost},t=${PARAMS.timeCost},p=${PARAMS.parallelism}$`);

/** Verifies against a fixed hash so an unknown account costs the same time as a wrong password. */
let dummy: Promise<string> | undefined;
export async function burnPasswordTime(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummy, password);
}

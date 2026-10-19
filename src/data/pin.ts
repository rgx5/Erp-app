import * as Crypto from 'expo-crypto'

/**
 * Staff PINs on an offline workspace are stored only as a salted hash (`sha256$salt$hex`), never in the clear.
 *
 * Honest limit, same as the billing app: a 4-digit PIN cannot be made truly secret — anyone who copies the database can
 * try all 10,000 combinations. The hash stops a PIN being read out of storage or a backup; the lockout stops guessing
 * at the screen; real protection is the phone's own lock. That is why the app also offers a biometric lock.
 */

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

export async function hashPin(pin: string, salt = hex(Crypto.getRandomBytes(8))): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`)
  return `sha256$${salt}$${digest}`
}

export async function verifyPin(pin: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false
  const [scheme, salt] = stored.split('$')
  if (scheme !== 'sha256' || !salt) return false
  return (await hashPin(pin, salt)) === stored
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin)

/** Seconds a person is locked out after this many wrong PINs in a row: none for 4, then 30 s doubling up to 15 min. */
export function lockoutSeconds(failures: number): number {
  if (failures < 5) return 0
  return Math.min(900, 30 * 2 ** (failures - 5))
}

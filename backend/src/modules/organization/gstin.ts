const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The 15th GSTIN character: a base-36 weighted checksum over the first 14 (weights 1,2,1,2,...). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = ALPHABET.indexOf(first14[i] ?? '');
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36] ?? '';
}

export function isValidGstin(value: string): boolean {
  return SHAPE.test(value) && gstinCheckCharacter(value.slice(0, 14)) === value[14];
}

/** Characters 3-12 of a GSTIN are the holder's PAN. */
export const panOfGstin = (gstin: string): string => gstin.slice(2, 12);
export const stateCodeOfGstin = (gstin: string): string => gstin.slice(0, 2);

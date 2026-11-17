export const STATES: readonly { code: string; name: string }[] = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'],
  ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'],
  ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'],
  ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
].map(([code, name]) => ({ code: code as string, name: name as string }))

export const stateName = (code: string): string => STATES.find((s) => s.code === code)?.name ?? code

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** The 15th GSTIN character: a base-36 weighted checksum over the first 14. Same rule as the server, so a typo is caught as it is typed. */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = ALPHABET.indexOf(first14[i] ?? '') * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return ALPHABET[(36 - (sum % 36)) % 36] ?? ''
}

export const normalizeGstin = (v: string): string => v.replace(/\s+/g, '').toUpperCase()
export const isValidGstin = (v: string): boolean => SHAPE.test(v) && gstinCheckCharacter(v.slice(0, 14)) === v[14] && STATES.some((s) => s.code === v.slice(0, 2))
export const panOfGstin = (gstin: string): string => gstin.slice(2, 12)
export const stateOfGstin = (gstin: string): string => gstin.slice(0, 2)
export const isValidPan = (v: string): boolean => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)
export const isValidPincode = (v: string): boolean => /^[1-9][0-9]{5}$/.test(v)

/** The financial year (April to March) that contains a date, as its first day. */
export function financialYearStart(today: string, startMonth = 4): string {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  return `${m >= startMonth ? y : y - 1}-${String(startMonth).padStart(2, '0')}-01`
}

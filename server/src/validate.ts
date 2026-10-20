import { badRequest } from './errors'

export function str(b: Record<string, unknown>, k: string, o: { min?: number; max?: number; optional?: boolean; label?: string } = {}): string {
  const v = b[k]
  const label = o.label ?? k
  if (v === undefined || v === null || v === '') {
    if (o.optional) return ''
    throw badRequest(`${label} is required`)
  }
  if (typeof v !== 'string') throw badRequest(`${label} must be text`)
  const t = v.trim()
  if (t.length < (o.min ?? 1)) throw badRequest(`${label} is too short`)
  if (t.length > (o.max ?? 200)) throw badRequest(`${label} is too long`)
  return t
}

export const optStr = (b: Record<string, unknown>, k: string, o: { min?: number; max?: number; label?: string } = {}): string | undefined =>
  b[k] === undefined || b[k] === null ? undefined : str(b, k, { ...o, optional: false })

export function strArray(b: Record<string, unknown>, k: string, o: { max?: number; label?: string } = {}): string[] | undefined {
  const v = b[k]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badRequest(`${o.label ?? k} must be a list of text`)
  if (v.length > (o.max ?? 500)) throw badRequest(`${o.label ?? k} has too many entries`)
  return [...new Set(v as string[])]
}

export const bool = (b: Record<string, unknown>, k: string): boolean | undefined => {
  const v = b[k]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw badRequest(`${k} must be true or false`)
  return v
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PIN = /^\d{4,6}$/
export const SAFE_ID = /^[A-Za-z0-9_.:-]{1,100}$/

export const email = (b: Record<string, unknown>, k = 'email'): string => {
  const v = str(b, k, { max: 200, label: 'Email' }).toLowerCase()
  if (!EMAIL.test(v)) throw badRequest('That email address does not look right')
  return v
}
export const pin = (b: Record<string, unknown>, k = 'pin'): string => {
  const v = str(b, k, { max: 6, label: 'PIN' })
  if (!PIN.test(v)) throw badRequest('The PIN must be 4 to 6 digits')
  return v
}
export const password = (b: Record<string, unknown>, k = 'password'): string => {
  const v = typeof b[k] === 'string' ? (b[k] as string) : ''
  if (v.length < 8) throw badRequest('The password must be at least 8 characters')
  if (v.length > 200) throw badRequest('The password is too long')
  return v
}
export const safeId = (v: unknown, label = 'id'): string => {
  if (typeof v !== 'string' || !SAFE_ID.test(v)) throw badRequest(`${label} may only contain letters, digits and _ . : -`)
  return v
}

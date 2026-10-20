import { fmtDate } from '@/domain/dates'
import type { CustomFieldDef, CustomFieldType, CustomFieldValues, CustomValue } from './types'

export const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = { text: 'Text', number: 'Number', date: 'Date', choice: 'Choice', yesno: 'Yes / No' }

const YES = /^(y|yes|true|1|haan|ha)$/i
const NO = /^(n|no|false|0|nahi)$/i

/**
 * Turns what a person typed (or a spreadsheet cell held) into the value stored for a field, or says what is wrong with it.
 * An empty string means "no value" and is always fine unless the field is required (the caller decides that).
 */
export function parseFieldValue(def: Pick<CustomFieldDef, 'label' | 'type' | 'options'>, raw: string): { value?: CustomValue; error?: string } {
  const t = raw.trim()
  if (!t) return {}
  switch (def.type) {
    case 'text': return { value: t.slice(0, 200) }
    case 'number': {
      const n = Number(t.replace(/[,\s₹]/g, ''))
      return Number.isFinite(n) ? { value: n } : { error: `${def.label} must be a number` }
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(new Date(`${t}T12:00:00`).getTime())) return { error: `${def.label} must be a date written YYYY-MM-DD` }
      return { value: t }
    }
    case 'choice': {
      const hit = def.options.find((o) => o.toLowerCase() === t.toLowerCase())
      return hit ? { value: hit } : { error: `${def.label} must be one of: ${def.options.join(', ')}` }
    }
    case 'yesno':
      if (YES.test(t)) return { value: true }
      if (NO.test(t)) return { value: false }
      return { error: `${def.label} must be Yes or No` }
  }
}

/** A stored value as a person reads it. */
export function formatFieldValue(def: Pick<CustomFieldDef, 'type'>, v: CustomValue | undefined): string {
  if (v === undefined || v === '') return ''
  if (def.type === 'yesno') return v ? 'Yes' : 'No'
  if (def.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(new Date(`${v}T12:00:00`).getTime())
  return String(v)
}

/** The same value as a spreadsheet cell (dates stay YYYY-MM-DD so an export can be imported back). */
export const fieldCell = (def: Pick<CustomFieldDef, 'type'>, v: CustomValue | undefined): string | number =>
  v === undefined ? '' : def.type === 'yesno' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? v : String(v)

/** Active definitions in the order the business set. */
export const activeFields = (defs: CustomFieldDef[]) => defs.filter((d) => d.active).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))

/** The required fields an item is still missing a value for. */
export const missingRequired = (defs: CustomFieldDef[], doc: CustomFieldValues | undefined) =>
  activeFields(defs).filter((d) => d.required && (doc?.values[d.id] === undefined || doc.values[d.id] === ''))

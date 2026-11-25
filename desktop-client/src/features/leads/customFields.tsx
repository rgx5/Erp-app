import { SelectField, TextField } from '@/ui/primitives'
import type { CustomField } from './queries'

/** Ready-made sets of details for common kinds of business: a starting point to change, not a limit. */
export const FIELD_PRESETS: { id: string; label: string; fields: CustomField[] }[] = [
  { id: 'solar', label: 'Solar installer', fields: [
    { key: 'property_type', label: 'Property', type: 'select', options: ['Home', 'Commercial', 'Industrial', 'Farm'] }, { key: 'monthly_bill', label: 'Monthly electricity bill (₹)', type: 'number', showOnCard: true },
    { key: 'roof_type', label: 'Roof type', type: 'select', options: ['RCC', 'Metal sheet', 'Tile', 'Other'] }, { key: 'roof_area', label: 'Roof area (sq ft)', type: 'number' }, { key: 'system_size_kw', label: 'System size (kW)', type: 'number', showOnCard: true }, { key: 'discom', label: 'Electricity company (DISCOM)', type: 'text' }] },
  { id: 'realestate', label: 'Real estate', fields: [
    { key: 'property_type', label: 'Looking for', type: 'select', options: ['Flat', 'Villa', 'Plot', 'Shop', 'Office'], showOnCard: true }, { key: 'budget', label: 'Budget (₹)', type: 'number', showOnCard: true }, { key: 'location', label: 'Preferred location', type: 'text' }, { key: 'purpose', label: 'Purpose', type: 'select', options: ['Self use', 'Investment'] }] },
  { id: 'education', label: 'School or coaching', fields: [
    { key: 'student_name', label: 'Student name', type: 'text', showOnCard: true }, { key: 'class_wanted', label: 'Class or course', type: 'text', required: true, showOnCard: true }, { key: 'parent_name', label: 'Parent name', type: 'text' }] },
  { id: 'b2b', label: 'Business to business', fields: [
    { key: 'company', label: 'Company', type: 'text', showOnCard: true }, { key: 'designation', label: 'Designation', type: 'text' }, { key: 'requirement', label: 'Requirement', type: 'text' }, { key: 'quantity', label: 'Quantity or size of order', type: 'text' }, { key: 'budget', label: 'Budget (₹)', type: 'number' }] },
  { id: 'retail', label: 'Retail or showroom', fields: [
    { key: 'product', label: 'Product of interest', type: 'text', showOnCard: true }, { key: 'budget', label: 'Budget (₹)', type: 'number' }, { key: 'visit_date', label: 'Planned visit', type: 'date' }] },
]

export const slugKey = (label: string): string => { const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); return /^[a-z]/.test(s) ? s : `f_${s}` }
export const humanKey = (k: string): string => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The details a business asked for on every lead, as inputs. Missing ones that are required are marked. */
export function FieldInputs({ defs, values, onChange, disabled }: { defs: CustomField[]; values: Record<string, string>; onChange: (key: string, value: string) => void; disabled?: boolean }) {
  if (defs.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-3">
      {defs.map((d) => {
        const label = d.required ? `${d.label} *` : d.label; const v = values[d.key] ?? ''
        if (d.type === 'select') return <SelectField key={d.key} label={label} value={v} disabled={disabled ?? false} onChange={(e) => onChange(d.key, e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(d.options ?? []).map((o) => ({ value: o, label: o }))]} />
        if (d.type === 'yes_no') return <SelectField key={d.key} label={label} value={v} disabled={disabled ?? false} onChange={(e) => onChange(d.key, e.target.value)} options={[{ value: '', label: 'Choose…' }, { value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]} />
        return <TextField key={d.key} label={label} type={d.type === 'date' ? 'date' : 'text'} inputMode={d.type === 'number' ? 'decimal' : undefined} value={v} disabled={disabled ?? false} onChange={(e) => onChange(d.key, e.target.value)} />
      })}
    </div>
  )
}

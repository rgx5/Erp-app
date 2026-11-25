import { Boxes, Target, Truck, Upload, Users } from 'lucide-react'
import { useState } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { leadImportSpec } from '@/features/leads/LeadsPage'
import { ImportDialog } from '@/features/masterdata/ImportDialog'
import { useItemImportSpec } from '@/features/masterdata/ItemsPage'
import { usePartyImportSpec } from '@/features/masterdata/PartiesPage'
import { FORMATS_NOTE } from '@/features/import/readers'
import { licensed } from '@/auth/permissions'
import { Card } from '@/ui/primitives'

type Kind = 'items' | 'customers' | 'suppliers' | 'leads'
const CARDS: { kind: Kind; title: string; text: string; icon: typeof Boxes; needs: string; module?: string }[] = [
  { kind: 'items', title: 'Items', text: 'Products and services with their units, tax codes, HSN/SAC and prices.', icon: Boxes, needs: 'masterdata:write' },
  { kind: 'customers', title: 'Customers', text: 'People and businesses you sell to, with GSTIN and contact details.', icon: Users, needs: 'masterdata:write' },
  { kind: 'suppliers', title: 'Suppliers', text: 'Businesses you buy from, with GSTIN and contact details.', icon: Truck, needs: 'masterdata:write' },
  { kind: 'leads', title: 'Leads', text: 'Enquiries from a spreadsheet or another tool, to follow up in the pipeline.', icon: Target, needs: 'leads:write', module: 'leads' },
]

function Items({ onClose }: { onClose: () => void }) { return <ImportDialog spec={useItemImportSpec()} onClose={onClose} /> }
function Parties({ role, onClose }: { role: 'customer' | 'supplier'; onClose: () => void }) { return <ImportDialog spec={usePartyImportSpec(role)} onClose={onClose} /> }

/** Bringing data in from a file lives here, not on the working pages. Pick what the file holds; the rest (matching columns, checking rows) is the same for all. */
export function ImportPage() {
  const me = useSession((s) => s.me)
  const [open, setOpen] = useState<Kind | null>(null)
  const granted = me?.permissions ?? []
  const shown = CARDS.filter((c) => can(granted, c.needs) && licensed(me, c.module))
  return (
    <div className="flex flex-col gap-4">
      <div><h1 className="page-title">Import data</h1><p className="page-sub">Bring records in from a spreadsheet, another system's export, or a backup file. Nothing is saved until you have checked the rows.</p></div>
      {shown.length === 0 ? <Card title="Nothing to import"><p className="text-sm text-muted">Your role does not allow importing. Ask an administrator.</p></Card> : (
        <div className="grid max-w-4xl grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((c) => (
            <button key={c.kind} type="button" onClick={() => setOpen(c.kind)} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-left hover:border-brand">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-soft text-brand"><c.icon className="size-4" aria-hidden /></span>
              <span><span className="flex items-center gap-1.5 text-sm font-semibold">Import {c.title.toLowerCase()} <Upload className="size-3.5 text-muted" aria-hidden /></span><span className="mt-0.5 block text-xs text-muted">{c.text}</span></span>
            </button>
          ))}
        </div>)}
      <p className="max-w-3xl text-xs text-muted">{FORMATS_NOTE}</p>
      {open === 'items' ? <Items onClose={() => setOpen(null)} /> : null}
      {open === 'customers' ? <Parties role="customer" onClose={() => setOpen(null)} /> : null}
      {open === 'suppliers' ? <Parties role="supplier" onClose={() => setOpen(null)} /> : null}
      {open === 'leads' ? <ImportDialog spec={leadImportSpec(undefined)} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

import { Link, Outlet } from '@tanstack/react-router'
import { Boxes, Building2, ClipboardCheck, Clock, LayoutDashboard, LogOut, Percent, Ruler, Tags, Truck, Users, type LucideIcon } from 'lucide-react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { cn } from './cn'
import { Button } from './primitives'

interface NavItem { to: string; label: string; icon: LucideIcon; needs?: string[]; section?: string }

/** What exists today. Each later slice adds its entries here; an entry is hidden when the person lacks the permission it needs. */
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, needs: ['dashboard:read'] },
  { to: '/setup', label: 'Setup', icon: ClipboardCheck, needs: ['organization:write'] },
  { to: '/organization/companies', label: 'Companies', icon: Building2, needs: ['organization:read'], section: 'Organization' },
  { to: '/masterdata/items', label: 'Items', icon: Boxes, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/customers', label: 'Customers', icon: Users, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/suppliers', label: 'Suppliers', icon: Truck, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/price-lists', label: 'Price lists', icon: Tags, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/tax-codes', label: 'Tax codes', icon: Percent, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/units', label: 'Units', icon: Ruler, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/payment-terms', label: 'Payment terms', icon: Clock, needs: ['masterdata:read'], section: 'Master data' },
]

export function Shell() {
  const { me, logout, server } = useSession()
  const granted = me?.permissions ?? []
  return (
    <div className="grid h-full grid-cols-[220px_1fr]">
      <aside className="flex flex-col border-r border-line bg-surface">
        <div className="px-4 py-4 text-base font-semibold">OneSyncERP</div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Main">
          {NAV.filter((n) => can(granted, ...(n.needs ?? []))).map((n, i, shown) => (
            <div key={n.to} className="flex flex-col">
              {n.section && shown[i - 1]?.section !== n.section ? <p className="mt-3 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{n.section}</p> : null}
            <Link to={n.to} activeOptions={{ exact: n.to === '/' }} className="flex h-9 items-center gap-2.5 rounded-md px-3 text-sm text-muted hover:bg-canvas hover:text-ink" activeProps={{ className: cn('bg-canvas text-ink font-medium') }}>
              <n.icon className="size-4" aria-hidden /> {n.label}
            </Link>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3 text-xs text-muted">
          <p className="truncate" title={me?.user?.email}>{me?.user?.displayName ?? 'Signed in'}</p>
          <p className="truncate">{server?.url}</p>
          <Button variant="ghost" className="mt-2 w-full justify-start px-2" onClick={() => void logout()}><LogOut className="size-4" aria-hidden /> Sign out</Button>
        </div>
      </aside>
      <main className="overflow-auto p-6"><Outlet /></main>
    </div>
  )
}

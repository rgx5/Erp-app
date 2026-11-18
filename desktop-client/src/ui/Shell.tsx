import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeftRight, BadgeCheck, Calculator, ListChecks, Warehouse as WarehouseIcon, Boxes, ClipboardList, PackageCheck, ShoppingCart, Wallet, FileText, Landmark, Receipt as ReceiptIcon, Building2, ClipboardCheck, Clock, LayoutDashboard, LogOut, Percent, Ruler, Tags, Truck, Users, BookOpen, ChevronDown, Layers, Users2, ShieldCheck, KeyRound, ScrollText, UserCog, ScanBarcode, Store, UserRound, Banknote, Settings2, Scale, Factory, Cog, Gauge, Handshake, FileSpreadsheet, FolderOpen, CalendarCheck, LineChart, ListTree, type LucideIcon } from 'lucide-react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { cn } from './cn'
import { useFlash } from './flash'
import { Alert } from './primitives'

interface NavItem { to: string; label: string; icon: LucideIcon; needs?: string[]; section?: string }

/** What exists today. Each later slice adds its entries here; an entry is hidden when the person lacks the permission it needs. */
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, needs: ['dashboard:read'] },
  { to: '/setup', label: 'Setup', icon: ClipboardCheck, needs: ['organization:write'] },
  { to: '/sales/quotes', label: 'Quotes', icon: FileText, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/orders', label: 'Sales orders', icon: ClipboardList, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/invoices', label: 'Invoices', icon: FileText, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/receipts', label: 'Receipts', icon: ReceiptIcon, needs: ['receivables:read'], section: 'Sales' },
  { to: '/sales/receivables', label: 'Receivables', icon: Landmark, needs: ['receivables:read'], section: 'Sales' },
  { to: '/accounting/journals', label: 'Journal entries', icon: BookOpen, needs: ['accounting:read'], section: 'Accounting' },
  { to: '/accounting/expenses', label: 'Expenses', icon: Wallet, needs: ['expenses:read'], section: 'Accounting' },
  { to: '/accounting/chart', label: 'Chart of accounts', icon: ListTree, needs: ['accounting:read'], section: 'Accounting' },
  { to: '/accounting/reports', label: 'Financial reports', icon: LineChart, needs: ['accounting:read'], section: 'Accounting' },
  { to: '/accounting/bank', label: 'Bank reconciliation', icon: Landmark, needs: ['bank:read'], section: 'Accounting' },
  { to: '/accounting/periods', label: 'Periods and year-end', icon: CalendarCheck, needs: ['accounting:read'], section: 'Accounting' },
  { to: '/report-centre', label: 'Report centre', icon: FolderOpen, needs: ['accounting:read'], section: 'Accounting' },
  { to: '/gst', label: 'GST returns', icon: FileSpreadsheet, needs: ['gst:read'], section: 'Accounting' },
  { to: '/manufacturing/orders', label: 'Work orders', icon: Factory, needs: ['manufacturing:read'], section: 'Manufacturing' },
  { to: '/manufacturing/boms', label: 'Bills of material', icon: ListTree, needs: ['manufacturing:read'], section: 'Manufacturing' },
  { to: '/manufacturing/work-centres', label: 'Work centres', icon: Cog, needs: ['manufacturing:read'], section: 'Manufacturing' },
  { to: '/manufacturing/job-work', label: 'Job work', icon: Handshake, needs: ['manufacturing:read'], section: 'Manufacturing' },
  { to: '/manufacturing/costing', label: 'Production costing', icon: Gauge, needs: ['manufacturing:read'], section: 'Manufacturing' },
  { to: '/payroll/runs', label: 'Payroll runs', icon: Banknote, needs: ['payroll:read'], section: 'Payroll' },
  { to: '/payroll/people', label: 'People', icon: UserRound, needs: ['payroll:read'], section: 'Payroll' },
  { to: '/payroll/dues', label: 'Statutory dues', icon: Scale, needs: ['payroll:read'], section: 'Payroll' },
  { to: '/payroll/setup', label: 'Payroll setup', icon: Settings2, needs: ['payroll:read'], section: 'Payroll' },
  { to: '/pos/counter', label: 'Counter', icon: ScanBarcode, needs: ['pos:sell'], section: 'Point of sale' },
  { to: '/pos/admin', label: 'Shifts and setup', icon: Store, needs: ['pos:read'], section: 'Point of sale' },
  { to: '/admin/users', label: 'Users', icon: Users2, needs: ['users:read'], section: 'Administration' },
  { to: '/admin/roles', label: 'Roles', icon: ShieldCheck, needs: ['roles:read'], section: 'Administration' },
  { to: '/admin/api-keys', label: 'API keys', icon: KeyRound, needs: ['api_keys:manage'], section: 'Administration' },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText, needs: ['audit:read'], section: 'Administration' },
  { to: '/account', label: 'My account', icon: UserCog, section: 'Administration' },
  { to: '/inventory/stock', label: 'Stock on hand', icon: WarehouseIcon, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/movements', label: 'Movements', icon: ListChecks, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/transfers', label: 'Transfers', icon: ArrowLeftRight, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/counts', label: 'Stock counts', icon: ClipboardCheck, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/tracking', label: 'Batches and serials', icon: Layers, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/valuation', label: 'Valuation', icon: Calculator, needs: ['stock:read'], section: 'Inventory' },
  { to: '/purchasing/orders', label: 'Purchase orders', icon: ShoppingCart, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/purchasing/receipts', label: 'Goods receipts', icon: PackageCheck, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/purchasing/bills', label: 'Supplier bills', icon: ClipboardList, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/purchasing/payments', label: 'Payments', icon: Wallet, needs: ['payables:read'], section: 'Purchasing' },
  { to: '/purchasing/payables', label: 'Payables', icon: Landmark, needs: ['payables:read'], section: 'Purchasing' },
  { to: '/purchasing/landed-costs', label: 'Landed costs', icon: ReceiptIcon, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/approvals', label: 'Approvals', icon: BadgeCheck, needs: [], section: 'Control' },
  { to: '/organization/companies', label: 'Companies', icon: Building2, needs: ['organization:read'], section: 'Organization' },
  { to: '/masterdata/items', label: 'Items', icon: Boxes, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/customers', label: 'Customers', icon: Users, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/suppliers', label: 'Suppliers', icon: Truck, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/categories', label: 'Categories', icon: FolderOpen, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/price-lists', label: 'Price lists', icon: Tags, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/tax-codes', label: 'Tax codes', icon: Percent, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/units', label: 'Units', icon: Ruler, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/payment-terms', label: 'Payment terms', icon: Clock, needs: ['masterdata:read'], section: 'Master data' },
]

const OPEN_KEY = 'onesync.nav.closed'
const readClosed = (): string[] => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[] } catch { return [] } }

/** The sidebar: top-level entries, then one collapsible group per area. The group holding the current screen is always open. */
function Sidebar({ items }: { items: NavItem[] }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const [closed, setClosed] = useState<string[]>(readClosed)
  const toggle = (name: string): void => { const next = closed.includes(name) ? closed.filter((x) => x !== name) : [...closed, name]; setClosed(next); try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)) } catch { /* not remembered */ } }
  const here = (n: NavItem): boolean => (n.to === '/' ? path === '/' : path === n.to || path.startsWith(`${n.to}/`))
  const link = (n: NavItem, nested: boolean) => (
    <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === '/' }} className={cn('group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-[13px] text-muted transition-colors hover:bg-canvas hover:text-ink', nested ? 'pl-3 pr-2' : 'px-2.5')} activeProps={{ className: 'bg-brand-soft font-medium text-brand hover:bg-brand-soft hover:text-brand' }}>
      <n.icon className="size-4 shrink-0 opacity-80" aria-hidden /> <span className="truncate">{n.label}</span>
    </Link>
  )
  const top = items.filter((n) => !n.section)
  const groups = [...new Set(items.filter((n) => n.section).map((n) => n.section as string))]
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2" aria-label="Main">
      {top.map((n) => link(n, false))}
      {groups.map((g) => {
        const rows = items.filter((n) => n.section === g)
        const open = !closed.includes(g) || rows.some(here)
        return (
          <div key={g} className="mt-2">
            <button type="button" aria-expanded={open} onClick={() => toggle(g)} className="flex w-full items-center justify-between rounded px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted/80 hover:text-ink"><span>{g}</span><ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} aria-hidden /></button>
            {open ? <div className="flex flex-col gap-0.5">{rows.map((n) => link(n, true))}</div> : null}
          </div>
        )
      })}
    </nav>
  )
}

export function Shell() {
  const { me, logout, server } = useSession()
  const flash = useFlash()
  const granted = me?.permissions ?? []
  const initials = (me?.user?.displayName ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="grid h-full grid-cols-[232px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-ink shadow-card" aria-hidden>O</span>
          <span className="text-[15px] font-semibold tracking-tight">OneSyncERP</span>
        </div>
        <Sidebar items={NAV.filter((n) => can(granted, ...(n.needs ?? [])))} />
        <div className="flex items-center gap-2.5 border-t border-line p-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-hidden>{initials}</span>
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-medium" title={me?.user?.email}>{me?.user?.displayName ?? 'Signed in'}</p>
            <p className="truncate text-muted" title={server?.url}>{server?.url}</p>
          </div>
          <button type="button" aria-label="Sign out" title="Sign out" onClick={() => void logout()} className="grid size-8 place-items-center rounded-md text-muted hover:bg-canvas hover:text-ink"><LogOut className="size-4" aria-hidden /></button>
        </div>
      </aside>
      <main className="min-h-0 overflow-auto px-8 py-7">
        <div className="mx-auto max-w-[1280px]">
          {flash.message ? <div className="mb-4"><Alert tone={flash.tone}><span className="flex items-center justify-between gap-4">{flash.message}<button type="button" className="text-xs underline" onClick={flash.clear}>Dismiss</button></span></Alert></div> : null}
          <Outlet />
        </div>
      </main>
    </div>
  )
}

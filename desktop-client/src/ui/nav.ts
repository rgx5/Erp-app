import { licensed } from '@/auth/permissions'
import { isStarter } from '@/auth/edition'
import { Database, Upload, BellRing, FileCheck, Target, Repeat, Download, Printer, ArrowLeftRight, BadgeCheck, Calculator, ListChecks, Warehouse as WarehouseIcon, Boxes, ClipboardList, PackageCheck, ShoppingCart, Wallet, FileText, Landmark, Receipt as ReceiptIcon, Building2, ClipboardCheck, Clock, LayoutDashboard, Percent, Ruler, Tags, Truck, Users, BookOpen, Layers, Users2, ShieldCheck, KeyRound, ScrollText, UserCog, ScanBarcode, Store, UserRound, Banknote, Settings2, Scale, Factory, Cog, Gauge, Handshake, FileSpreadsheet, FolderOpen, CalendarCheck, LineChart, ListTree, type LucideIcon } from 'lucide-react'

/** `advanced`: left out of the small-business (Starter) menu; the page itself still works if someone opens it. */
export interface NavItem { to: string; label: string; icon: LucideIcon; needs?: string[]; section?: string; advanced?: boolean }

/** The licensed module a page belongs to (see the server's modules); pages that belong to none are Core and always shown. */
export function moduleOfPage(n: Pick<NavItem, 'to' | 'section'>): string | undefined {
  if (n.to === '/leads/settings' || n.to === '/leads/sources') return 'leads'
  if (n.to === '/payroll/setup') return 'payroll'
  if (n.to === '/pos/admin') return 'pos'
  if (n.to === '/data/import') return undefined
  if (n.to === '/accounting/expenses') return 'pos'
  if (n.to === '/accounting/bank') return 'banking'
  if (n.to === '/accounting/tds') return 'purchasing'
  if (n.to === '/gst') return 'gst'
  if (n.to === '/approvals') return 'approvals'
  if (n.to === '/accounting/journals' || n.to === '/accounting/chart' || n.to === '/accounting/reports' || n.to === '/accounting/periods' || n.to === '/report-centre') return 'accounting'
  return ({ Sales: 'sales', Purchasing: 'purchasing', Inventory: 'inventory', Manufacturing: 'manufacturing', Payroll: 'payroll', 'Point of sale': 'pos', Leads: 'leads' } as Record<string, string>)[n.section ?? '']
}
/** The menu this person sees: what their role allows and their plan includes. */
export function visibleNav(items: NavItem[], allowed: (needs: string[]) => boolean, me: Parameters<typeof licensed>[0]): NavItem[] {
  const starter = isStarter(me)
  return items.filter((n) => allowed(n.needs ?? []) && licensed(me, moduleOfPage(n)) && !(starter && n.advanced))
}

/** What exists today. Each later slice adds its entries here; an entry is hidden when the person lacks the permission it needs. */
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, needs: ['dashboard:read'] },
  { to: '/settings', label: 'All settings', icon: Settings2, section: 'Settings' },
  { to: '/setup', label: 'Setup checklist', icon: ClipboardCheck, needs: ['organization:write'], section: 'Settings' },
  { to: '/leads', label: 'Leads', icon: Target, needs: ['leads:read'], section: 'Leads' },
  { to: '/leads/reports', label: 'Lead reports', icon: LineChart, needs: ['leads:read_all'], section: 'Leads' },
  { to: '/leads/sources', label: 'Lead sources', icon: Download, needs: ['leads:manage'], section: 'Settings' },
  { to: '/leads/settings', label: 'Lead settings', icon: Settings2, needs: ['leads:manage'], section: 'Settings' },
  { to: '/sales/quotes', label: 'Quotes', icon: FileText, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/orders', label: 'Sales orders', icon: ClipboardList, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/invoices', label: 'Invoices', icon: FileText, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/receipts', label: 'Receipts', icon: ReceiptIcon, needs: ['receivables:read'], section: 'Sales' },
  { to: '/sales/reminders', label: 'Payment reminders', icon: BellRing, needs: ['receivables:read'], section: 'Sales' },
  { to: '/sales/einvoicing', label: 'E-invoicing', icon: FileCheck, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/recurring', label: 'Recurring invoices', icon: Repeat, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/challans', label: 'Delivery challans', icon: Truck, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/analysis', label: 'Sales analysis', icon: Gauge, needs: ['sales:read'], section: 'Sales' },
  { to: '/sales/receivables', label: 'Receivables', icon: Landmark, needs: ['receivables:read'], section: 'Sales' },
  { to: '/accounting/journals', label: 'Journal entries', icon: BookOpen, needs: ['accounting:read'], section: 'Accounting' },
  { to: '/accounting/expenses', label: 'Expenses', icon: Wallet, needs: ['expenses:read'], section: 'Accounting' },
  { to: '/accounting/tds', label: 'TDS', icon: Percent, needs: ['payables:read'], section: 'Accounting' },
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
  { to: '/payroll/setup', label: 'Payroll setup', icon: Settings2, needs: ['payroll:read'], section: 'Settings' },
  { to: '/pos/counter', label: 'Counter', icon: ScanBarcode, needs: ['pos:sell'], section: 'Point of sale' },
  { to: '/retail/loyalty', label: 'Loyalty and coupons', icon: Percent, needs: ['retail:read'], section: 'Point of sale' },
  { to: '/pos/day-end', label: 'Day-end report', icon: ScrollText, needs: ['pos:read'], section: 'Point of sale' },
  { to: '/pos/admin', label: 'POS shifts and setup', icon: Store, needs: ['pos:read'], section: 'Settings' },
  { to: '/admin/users', label: 'Users', icon: Users2, needs: ['users:read'], section: 'Settings' },
  { to: '/admin/roles', label: 'Roles', icon: ShieldCheck, needs: ['roles:read'], section: 'Settings' },
  { to: '/admin/api-keys', label: 'API keys', icon: KeyRound, needs: ['api_keys:manage'], section: 'Settings', advanced: true },
  { to: '/data/migrate', label: 'Move from another program', icon: ArrowLeftRight, needs: ['organization:write'], section: 'Data' },
  { to: '/data/import', label: 'Import data', icon: Upload, section: 'Data' },
  { to: '/data/export', label: 'Export data', icon: Download, section: 'Data' },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText, needs: ['audit:read'], section: 'Settings', advanced: true },
  { to: '/account', label: 'My account and layout', icon: UserCog, section: 'Settings' },
  { to: '/inventory/stock', label: 'Stock on hand', icon: WarehouseIcon, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/reorder', label: 'Reorder list', icon: ListChecks, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/movements', label: 'Movements', icon: ListChecks, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/transfers', label: 'Transfers', icon: ArrowLeftRight, needs: ['stock:read'], section: 'Inventory', advanced: true },
  { to: '/inventory/counts', label: 'Stock counts', icon: ClipboardCheck, needs: ['stock:read'], section: 'Inventory' },
  { to: '/inventory/tracking', label: 'Batches and serials', icon: Layers, needs: ['stock:read'], section: 'Inventory', advanced: true },
  { to: '/inventory/valuation', label: 'Valuation', icon: Calculator, needs: ['stock:read'], section: 'Inventory', advanced: true },
  { to: '/purchasing/orders', label: 'Purchase orders', icon: ShoppingCart, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/purchasing/receipts', label: 'Goods receipts', icon: PackageCheck, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/purchasing/bills', label: 'Supplier bills', icon: ClipboardList, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/purchasing/payments', label: 'Payments', icon: Wallet, needs: ['payables:read'], section: 'Purchasing' },
  { to: '/purchasing/payables', label: 'Payables', icon: Landmark, needs: ['payables:read'], section: 'Purchasing' },
  { to: '/purchasing/landed-costs', label: 'Landed costs', icon: ReceiptIcon, needs: ['purchasing:read'], section: 'Purchasing' },
  { to: '/approvals', label: 'Approvals', icon: BadgeCheck, needs: [] },
  { to: '/organization/companies', label: 'Companies', icon: Building2, needs: ['organization:read'], section: 'Settings' },
  { to: '/masterdata/items', label: 'Items', icon: Boxes, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/customers', label: 'Customers', icon: Users, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/suppliers', label: 'Suppliers', icon: Truck, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/categories', label: 'Categories', icon: FolderOpen, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/labels', label: 'Print labels', icon: Printer, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/price-lists', label: 'Price lists', icon: Tags, needs: ['masterdata:read'], section: 'Master data' },
  { to: '/masterdata/tax-codes', label: 'Tax codes', icon: Percent, needs: ['masterdata:read'], section: 'Settings', advanced: true },
  { to: '/masterdata/units', label: 'Units', icon: Ruler, needs: ['masterdata:read'], section: 'Settings', advanced: true },
  { to: '/masterdata/payment-terms', label: 'Payment terms', icon: Clock, needs: ['masterdata:read'], section: 'Settings', advanced: true },
]


/** The areas shown on the rail. Each owns some sections of the menu; its pages become the tabs under the top bar. */
export interface AppModule { id: string; label: string; icon: LucideIcon; sections: (string | null)[] }
export const MODULES: AppModule[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, sections: [null, 'Control'] },
  { id: 'sales', label: 'Sales', icon: FileText, sections: ['Sales'] },
  { id: 'leads', label: 'Leads', icon: Target, sections: ['Leads'] },
  { id: 'buy', label: 'Buy', icon: ShoppingCart, sections: ['Purchasing'] },
  { id: 'stock', label: 'Stock', icon: Boxes, sections: ['Inventory', 'Master data'] },
  { id: 'books', label: 'Books', icon: BookOpen, sections: ['Accounting'] },
  { id: 'pos', label: 'POS', icon: ScanBarcode, sections: ['Point of sale'] },
  { id: 'make', label: 'Make', icon: Factory, sections: ['Manufacturing'] },
  { id: 'people', label: 'Payroll', icon: Users2, sections: ['Payroll'] },
  { id: 'data', label: 'Data', icon: Database, sections: ['Data'] },
  { id: 'settings', label: 'Settings', icon: Settings2, sections: ['Settings', 'Administration', 'Organization'] },
]
export const moduleOf = (n: NavItem): AppModule => MODULES.find((m) => m.sections.includes(n.section ?? null)) ?? (MODULES[0] as AppModule)
export const isHere = (n: NavItem, path: string): boolean => (n.to === '/' ? path === '/' : path === n.to || path.startsWith(`${n.to}/`))
/** The menu entry the current path belongs to (the longest match, so /sales/invoices/new counts as Invoices). */
export const currentNav = (items: NavItem[], path: string): NavItem | undefined => items.filter((n) => isHere(n, path)).sort((a, b) => b.to.length - a.to.length)[0]

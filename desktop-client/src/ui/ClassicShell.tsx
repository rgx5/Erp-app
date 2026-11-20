import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { BadgeCheck, BookOpen, Boxes, Building2, ChevronDown, ChevronRight, Database, Download, FolderOpen, Info, Factory, FileText, LogOut, PanelLeftClose, PanelLeftOpen, ScanBarcode, Search, Settings2, ShoppingCart, UserCog, Users2, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isStarter } from '@/auth/edition'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { useChosenCompany, useCompanies } from '@/features/organization/queries'
import { LicenceBanner } from './LicenceBanner'
import { Logo } from './Logo'
import { cn } from './cn'
import { CommandPalette } from './CommandPalette'
import { NAV, currentNav, isHere, visibleNav, type NavItem } from './nav'
import { Toasts } from './Toasts'

const RAIL_KEY = 'onesync.nav.rail'
const readRail = (): boolean => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } }
const GROUP_ICON: Record<string, LucideIcon> = { Sales: FileText, Purchasing: ShoppingCart, Inventory: Boxes, 'Master data': Database, Accounting: BookOpen, Manufacturing: Factory, Payroll: Users2, 'Point of sale': ScanBarcode, Administration: Settings2, Organization: Building2, Control: BadgeCheck }

/**
 * The sidebar. Deep navy, so the work area is the brightest thing on screen. Areas are collapsed to one line each and only the one
 * you are in is open, which keeps a 40-page product to about a dozen lines. It folds to an icon rail; in the rail an area opens as a
 * small flyout.
 */
function Sidebar({ items, rail }: { items: NavItem[]; rail: boolean }) {
  const starter = isStarter(useSession((s) => s.me))
  /** A small shop's "Accounting" holds only expenses, so it is called that. */
  const nameOf = (g: string): string => (starter && g === 'Accounting' ? 'Expenses' : g)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const groups = useMemo(() => [...new Set(items.filter((n) => n.section).map((n) => n.section as string))], [items])
  const here = currentNav(items, path)
  const [open, setOpen] = useState<string | null>(here?.section ?? null)
  const [fly, setFly] = useState<string | null>(null)
  const box = useRef<HTMLElement>(null)
  useEffect(() => { if (here?.section) setOpen(here.section); setFly(null) }, [here?.section, path])
  useEffect(() => {
    if (!fly) return
    const off = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setFly(null) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [fly])

  const link = (n: NavItem, nested: boolean) => {
    const active = isHere(n, path) && here?.to === n.to
    return (
      <Link key={n.to} to={n.to} title={rail && !nested ? n.label : undefined} className={cn('group relative flex h-8 shrink-0 items-center gap-2.5 rounded-md text-[13px] transition-colors', rail && !nested ? 'justify-center px-0' : nested ? 'pl-9 pr-2' : 'px-2.5', active ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-canvas hover:text-ink')}>
        {active ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent" aria-hidden /> : null}
        {nested && !rail ? null : <n.icon className={cn('size-4 shrink-0', active ? 'text-brand' : 'opacity-80')} aria-hidden />}
        {rail && !nested ? <span className="sr-only">{n.label}</span> : <span className="truncate">{n.label}</span>}
      </Link>
    )
  }
  const top = items.filter((n) => !n.section)
  return (
    <nav ref={box} className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2" aria-label="Main">
      {top.map((n) => link(n, false))}
      <div className="my-1.5 h-px bg-line" aria-hidden />
      {groups.map((g) => {
        const rows = items.filter((n) => n.section === g)
        const Icon = GROUP_ICON[g] ?? Boxes
        const active = rows.some((n) => here?.to === n.to)
        const isOpen = !rail && open === g
        return (
          <div key={g} className="relative">
            <button type="button" aria-expanded={rail ? fly === g : isOpen} title={rail ? nameOf(g) : undefined} onClick={() => (rail ? setFly(fly === g ? null : g) : setOpen(isOpen ? null : g))}
              className={cn('flex h-8 w-full items-center gap-2.5 rounded-md text-[13px] transition-colors', rail ? 'justify-center px-0' : 'px-2.5', active && !isOpen ? 'font-medium text-brand' : 'text-muted hover:bg-canvas hover:text-ink')}>
              <Icon className="size-4 shrink-0 opacity-75" aria-hidden />
              {rail ? <span className="sr-only">{nameOf(g)}</span> : <><span className="flex-1 truncate text-left">{nameOf(g)}</span><ChevronDown className={cn('size-3.5 opacity-60 transition-transform', !isOpen && '-rotate-90')} aria-hidden /></>}
            </button>
            {isOpen ? <div className="relative mb-1 mt-0.5 flex flex-col gap-0.5"><span className="absolute bottom-1 left-[17px] top-1 w-px bg-line" aria-hidden />{rows.map((n) => link(n, true))}</div> : null}
            {rail && fly === g ? (
              <div className="settle fixed left-[60px] z-40 mt-[-32px] w-52 rounded-lg border border-line bg-surface p-1.5 shadow-pop" role="menu" aria-label={g}>
                <p className="eyebrow px-2 pb-1 pt-0.5">{g}</p>
                {rows.map((n) => <Link key={n.to} to={n.to} role="menuitem" className={cn('flex h-8 items-center gap-2 rounded px-2 text-[13px]', here?.to === n.to ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-canvas hover:text-ink')}><n.icon className="size-4 opacity-80" aria-hidden />{n.label}</Link>)}
              </div>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}

function UserMenu() {
  const { me, logout, server } = useSession()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const go = useNavigate()
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const initials = (me?.user?.displayName ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-8 items-center gap-2 rounded-md pl-1 pr-2 hover:bg-sunken">
        <span className="grid size-6 place-items-center rounded-full bg-brand-soft text-[10.5px] font-semibold text-brand" aria-hidden>{initials}</span>
        <span className="max-w-32 truncate text-[12.5px] font-medium"><span className="sr-only">Account menu: </span>{me?.user?.displayName ?? 'Signed in'}</span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="settle absolute right-0 top-9 z-40 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-pop">
          <div className="border-b border-line px-2.5 pb-2 pt-1.5"><p className="truncate text-[13px] font-medium">{me?.user?.displayName}</p><p className="truncate text-xs text-muted">{me?.user?.email}</p><p className="mt-1 truncate text-[11px] text-faint" title={server?.url}>{server?.url}</p></div>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); void go({ to: '/account' as never }) }} className="mt-1 flex h-8 w-full items-center gap-2 rounded px-2.5 text-[13px] hover:bg-sunken"><UserCog className="size-4 text-muted" aria-hidden />My account and layout</button>
          {window.onesync ? (
            <div className="my-1 border-y border-line py-1">
              <button role="menuitem" type="button" onClick={() => { setOpen(false); void window.onesync?.app.about() }} className="flex h-8 w-full items-center gap-2 rounded px-2.5 text-[13px] hover:bg-sunken"><Info className="size-4 text-muted" aria-hidden />About OneSyncERP</button>
              <button role="menuitem" type="button" onClick={() => { setOpen(false); void window.onesync?.app.checkForUpdates() }} className="flex h-8 w-full items-center gap-2 rounded px-2.5 text-[13px] hover:bg-sunken"><Download className="size-4 text-muted" aria-hidden />Check for updates</button>
              <button role="menuitem" type="button" onClick={() => { setOpen(false); void window.onesync?.app.openLogs() }} className="flex h-8 w-full items-center gap-2 rounded px-2.5 text-[13px] hover:bg-sunken"><FolderOpen className="size-4 text-muted" aria-hidden />Open log folder</button>
            </div>) : null}
          <button role="menuitem" type="button" onClick={() => void logout()} className="flex h-8 w-full items-center gap-2 rounded px-2.5 text-[13px] text-bad hover:bg-bad-soft"><LogOut className="size-4" aria-hidden />Sign out</button>
        </div>
      ) : null}
    </div>
  )
}

export function ClassicShell() {
  const { me } = useSession()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const granted = me?.permissions ?? []
  const allowed = useCallback((needs: string[]) => can(granted, ...needs), [granted])
  const items = useMemo(() => visibleNav(NAV, allowed, me), [allowed, me])
  const here = currentNav(items, path)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [rail, setRail] = useState(readRail)
  const companies = useCompanies()
  const { companyId } = useChosenCompany()
  const company = (companies.data ?? []).find((c) => c.id === companyId) ?? companies.data?.[0]
  const toggleRail = (): void => setRail((r) => { try { localStorage.setItem(RAIL_KEY, r ? '0' : '1') } catch { /* not remembered */ } return !r })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o) }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); toggleRail() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={cn('grid h-full transition-[grid-template-columns] duration-150', rail ? 'grid-cols-[56px_1fr]' : 'grid-cols-[224px_1fr]')}>
      <aside className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className={cn('app-drag titlebar-left flex h-12 shrink-0 items-center gap-2.5', rail ? 'justify-center' : 'px-4')}>
          <Logo className="size-8" />
          {rail ? null : <span className="text-[14px] font-semibold tracking-tight">OneSyncERP</span>}
        </div>
        <Sidebar items={items} rail={rail} />
        <button type="button" onClick={toggleRail} title={rail ? 'Expand the menu (Ctrl+\\)' : 'Fold the menu (Ctrl+\\)'} className={cn('flex h-10 shrink-0 items-center gap-2 border-t border-line text-[12px] text-muted hover:text-ink', rail ? 'justify-center' : 'px-4')}>
          {rail ? <PanelLeftOpen className="size-4" aria-hidden /> : <><PanelLeftClose className="size-4" aria-hidden />Fold menu</>}
        </button>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="app-drag titlebar-right flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
          <nav aria-label="Where you are" className="flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px]">
            {here?.section ? <><span className="text-muted">{here.section}</span><ChevronRight className="size-3.5 text-faint" aria-hidden /></> : null}
            <span className="truncate font-medium">{here?.label ?? 'OneSyncERP'}</span>
          </nav>
          <button type="button" onClick={() => setPaletteOpen(true)} className="mx-auto flex h-8 w-full min-w-0 max-w-md items-center gap-2 rounded-md border border-line bg-sunken px-3 text-[13px] text-faint hover:border-line-strong">
            <Search className="size-3.5" aria-hidden /><span className="min-w-0 flex-1 truncate text-left">Search pages or start something…</span><kbd className="hidden lg:inline">Ctrl</kbd><kbd className="hidden lg:inline">K</kbd>
          </button>
          {company ? <Link to="/organization/companies" className="hidden max-w-48 items-center gap-1.5 truncate rounded-md border border-line px-2.5 py-1 text-[12.5px] font-medium hover:bg-sunken xl:flex" title="Company"><Building2 className="size-3.5 shrink-0 text-muted" aria-hidden /><span className="truncate">{company.tradeName ?? company.legalName}</span></Link> : null}
          <UserMenu />
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <div key={path} className="settle mx-auto max-w-[1360px] px-6 py-5">
            <LicenceBanner />
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
      <CommandPalette items={items} can={allowed} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}

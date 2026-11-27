import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronRight, LayoutDashboard, Menu, Search, Users, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReceiptText, Boxes } from 'lucide-react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { useT } from '@/i18n'
import { BackBar } from './BackBar'
import { LicenceBanner } from './LicenceBanner'
import { Logo } from './Logo'
import { HeaderTools } from './UserMenu'
import { cn } from './cn'
import { NAV, currentNav, visibleNav, type NavItem } from './nav'
import { Toasts } from './Toasts'

/** The four places most people go to all day; the rest are under More. A tab shows only if the person's role and plan include that page. */
const TABS: Array<{ to: string; label: string; icon: typeof Menu }> = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/sales/invoices', label: 'Sales', icon: ReceiptText },
  { to: '/masterdata/customers', label: 'Parties', icon: Users },
  { to: '/inventory/stock', label: 'Stock', icon: Boxes },
]
const LAST = ['Data', 'Settings']

/** Every page of the product as a full-screen list, grouped the way the desktop menu groups them, with a search box. */
function MoreSheet({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const t = useT(); const go = useNavigate(); const { logout, me } = useSession()
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const names = [...new Set(items.filter((n) => n.section).map((n) => n.section as string))].sort((a, b) => Number(LAST.includes(a)) - Number(LAST.includes(b)) || LAST.indexOf(a) - LAST.indexOf(b))
    const needle = q.trim().toLowerCase()
    return names.map((g) => ({ g, rows: items.filter((n) => n.section === g && (!needle || t(n.label).toLowerCase().includes(needle) || g.toLowerCase().includes(needle))) })).filter((x) => x.rows.length)
  }, [items, q, t])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  const open = (to: string): void => { onClose(); void go({ to: to as never }) }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas" role="dialog" aria-label="All pages" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <button type="button" aria-label="Close menu" onClick={onClose} className="grid size-10 place-items-center rounded-lg text-ink active:bg-sunken"><X className="size-5" aria-hidden /></button>
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a page" aria-label="Find a page" className="h-10 w-full rounded-lg border border-line bg-sunken pl-9 pr-3 text-[16px] outline-none focus:border-brand" /></div>
      </div>
      <div className="flex-1 overflow-auto pb-8">
        {groups.map(({ g, rows }) => (
          <section key={g} className="mt-4">
            <h2 className="eyebrow px-4 pb-1.5">{t(g)}</h2>
            <ul className="border-y border-line bg-surface">
              {rows.map((n) => (
                <li key={n.to} className="border-b border-line/70 last:border-b-0">
                  <button type="button" onClick={() => open(n.to)} className="flex h-12 w-full items-center gap-3 px-4 text-left text-[15px] active:bg-sunken"><n.icon className="size-[18px] shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1 truncate">{t(n.label)}</span><ChevronRight className="size-4 text-faint" aria-hidden /></button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted">No page matches.</p> : null}
        <div className="mt-6 px-4"><p className="mb-2 text-xs text-muted">Signed in as {me?.user?.displayName ?? ''}</p><button type="button" onClick={() => { onClose(); void logout() }} className="h-11 w-full rounded-lg border border-line bg-surface text-[15px] font-medium text-bad active:bg-bad-soft">Sign out</button></div>
      </div>
    </div>
  )
}

/**
 * The frame on a phone: a slim top bar with the page name, the page itself, and a bottom bar of the four daily places plus More, which opens every page.
 * The same menu, permissions and plan rules as the desktop frame decide what appears.
 */
export function MobileShell() {
  const t = useT()
  const { me } = useSession()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const granted = me?.permissions ?? []
  const allowed = useCallback((needs: string[]) => can(granted, ...needs), [granted])
  const items = useMemo(() => visibleNav(NAV, allowed, me), [allowed, me])
  const here = currentNav(items, path)
  const [more, setMore] = useState(false)
  useEffect(() => { setMore(false) }, [path])
  const tabs = TABS.filter((tab) => items.some((n) => n.to === tab.to))
  const activeTab = tabs.find((tab) => (tab.to === '/' ? path === '/' : path === tab.to || path.startsWith(tab.to + '/'))) ?? null
  const atRoot = path === '/' || items.some((n) => n.to === path)
  return (
    <div className="flex h-full flex-col bg-canvas" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Logo className="size-7" />
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight">{here ? t(here.label) : "OneSyncERP"}</span>
        <HeaderTools />
      </header>
      <main className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3">
        <LicenceBanner />
        <BackBar items={items} />
        <div key={path} className="settle"><Outlet /></div>
        <div className="h-4" aria-hidden />
      </main>
      <nav aria-label="Main" className="grid shrink-0 grid-cols-5 border-t border-line bg-surface" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} data-atroot={atRoot}>
        {tabs.map((tab) => (
          <Link key={tab.to} to={tab.to as never} className={cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', activeTab === tab ? 'text-brand' : 'text-muted')}>
            <tab.icon className="size-5" aria-hidden />{tab.label}
          </Link>
        ))}
        {Array.from({ length: Math.max(0, 4 - tabs.length) }).map((_, i) => <span key={i} aria-hidden />)}
        <button type="button" onClick={() => setMore(true)} className={cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', !activeTab ? 'text-brand' : 'text-muted')}><Menu className="size-5" aria-hidden />More</button>
      </nav>
      {more ? <MoreSheet items={items} onClose={() => setMore(false)} /> : null}
      <Toasts />
    </div>
  )
}

import { NotificationsBell } from './NotificationsBell'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { LogOut, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { CommandPalette } from './CommandPalette'
import { LicenceBanner } from './LicenceBanner'
import { Logo } from './Logo'
import { cn } from './cn'
import { MODULES, NAV, currentNav, moduleOf, visibleNav, type NavItem } from './nav'
import { PaneContext } from './paneContext'
import { Toasts } from './Toasts'

/**
 * The frame: a slim rail of areas, a top bar with search (Ctrl+K), the pages of the current area as tabs, the page itself with a
 * docked pane beside it for the record being edited, and a status bar. Menu entries are hidden when the person lacks the permission.
 */
export function CommandShell() {
  const { me, logout, server } = useSession()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const granted = me?.permissions ?? []
  const allowed = useCallback((needs: string[]) => can(granted, ...needs), [granted])
  const items = useMemo(() => visibleNav(NAV, allowed, me), [allowed, me])
  const here = currentNav(items, path)
  const area = here ? moduleOf(here) : MODULES[0]!
  const tabs = items.filter((n) => moduleOf(n) === area)
  const modules = MODULES.filter((m) => items.some((n) => moduleOf(n) === m))
  const [palette, setPalette] = useState(false)
  const [pane, setPane] = useState<HTMLElement | null>(null)
  const initials = (me?.user?.displayName ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const first = (m: (typeof MODULES)[number]): NavItem | undefined => items.find((n) => moduleOf(n) === m)
  return (
    <div className="grid h-full grid-cols-[68px_minmax(0,1fr)] overflow-hidden grid-rows-[48px_40px_1fr_26px]">
      <aside className="row-span-3 flex min-h-0 flex-col items-center gap-1 border-r border-line bg-surface py-3" aria-label="Areas">
        <Logo className="mb-2 size-9" />
        <nav className="flex flex-1 flex-col items-center gap-1" aria-label="Main">
          {modules.map((m) => {
            const target = first(m)
            const on = m === area
            return target ? (
              <Link key={m.id} to={target.to as never} aria-label={m.label} title={m.label} className={cn('grid h-12 w-12 place-items-center rounded-xl text-[10px] font-medium leading-tight transition-colors', on ? 'bg-hero text-brand-ink shadow-[inset_3px_0_0_var(--color-accent)]' : 'text-muted hover:bg-canvas hover:text-ink')}>
                <span className="flex flex-col items-center gap-0.5"><m.icon className="size-[18px]" aria-hidden />{m.label}</span>
              </Link>) : null
          })}
        </nav>
        <button type="button" aria-label="Sign out" title={`Sign out ${me?.user?.displayName ?? ''}`} onClick={() => void logout()} className="grid size-10 place-items-center rounded-xl text-muted hover:bg-canvas hover:text-ink"><LogOut className="size-4" aria-hidden /></button>
        <Link to={'/account' as never} aria-label="My account" title="My account" className="grid size-8 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{initials}</Link>
      </aside>

      <header className="col-start-2 flex items-center gap-4 border-b border-line bg-surface px-5">
        <span className="text-[15px] font-semibold tracking-tight">{area.label}</span>
        <button type="button" onClick={() => setPalette(true)} aria-label="Open the command palette" className="flex h-8 w-full max-w-[460px] items-center justify-between rounded-lg border border-line bg-canvas px-3 text-[13px] text-muted hover:border-line-strong">
          <span className="flex items-center gap-2"><Search className="size-3.5" aria-hidden />Search or run a command…</span><kbd className="rounded border border-line bg-surface px-1.5 text-[11px]">Ctrl K</kbd>
        </button>
        <span className="flex-1" />
        <NotificationsBell />
        <span className="text-xs text-muted" title={me?.user?.email}>{me?.user?.displayName ?? ''}</span>
      </header>

      <nav className="col-start-2 flex items-end gap-0.5 overflow-x-auto border-b border-line bg-surface px-4" aria-label={`${area.label} pages`}>
        {tabs.map((n) => (
          <Link key={n.to} to={n.to as never} activeOptions={{ exact: n.to === '/' }} className={cn('whitespace-nowrap border-b-2 px-3 pb-2 pt-2.5 text-[13px] transition-colors', here === n ? 'border-brand font-semibold text-ink' : 'border-transparent text-muted hover:text-ink')}>{n.label}</Link>
        ))}
      </nav>

      <div className="col-start-2 flex min-h-0 min-w-0">
        <main className="min-w-0 flex-1 overflow-auto px-5 py-4">
          <div className="mx-auto max-w-[1400px]">
            <LicenceBanner />
            <Toasts />
            <PaneContext.Provider value={pane}><Outlet /></PaneContext.Provider>
          </div>
        </main>
        <aside ref={setPane} className="min-h-0 shrink-0 border-l border-line bg-surface empty:hidden" aria-label="Record" />
      </div>

      <footer className="col-span-2 col-start-1 flex items-center gap-5 bg-hero px-4 text-[11.5px] text-[#c9d3f5]">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#34d399]" aria-hidden />Connected</span>
        <span className="flex-1" />
        <span className="truncate" title={server?.url}>{server?.url}</span>
        <span>Ctrl K to search</span>
      </footer>
      <CommandPalette items={items} can={allowed} open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}

import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { cn } from './cn'
import { useFlash } from './flash'
import { Alert } from './primitives'
import { CommandPalette } from './CommandPalette'
import { NAV, type NavItem } from './nav'

const OPEN_KEY = 'onesync.nav.closed'
const readClosed = (): string[] => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[] } catch { return [] } }

/** The sidebar: top-level entries, then one collapsible group per area. The group holding the current screen is always open. */
function Sidebar({ items }: { items: NavItem[] }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const [closed, setClosed] = useState<string[]>(readClosed)
  const toggle = (name: string): void => { const next = closed.includes(name) ? closed.filter((x) => x !== name) : [...closed, name]; setClosed(next); try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)) } catch { /* not remembered */ } }
  const here = (n: NavItem): boolean => (n.to === '/' ? path === '/' : path === n.to || path.startsWith(`${n.to}/`))
  const link = (n: NavItem, nested: boolean) => (
    <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === '/' }} className={cn('group flex h-8 shrink-0 items-center gap-2.5 rounded-md text-[13px] text-muted transition-colors hover:bg-canvas hover:text-ink', nested ? 'pl-3 pr-2' : 'px-2.5')} activeProps={{ className: 'bg-brand-soft font-medium text-brand shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-brand-soft hover:text-brand' }}>
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

export function ClassicShell() {
  const { me, logout, server } = useSession()
  const flash = useFlash()
  const granted = me?.permissions ?? []
  const allowed = useCallback((needs: string[]) => can(granted, ...needs), [granted])
  const palette = useMemo(() => NAV.filter((n) => allowed(n.needs ?? [])), [allowed])
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const initials = (me?.user?.displayName ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="grid h-full grid-cols-[232px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid size-8 place-items-center rounded-lg hero-gradient text-sm font-bold text-brand-ink shadow-card" aria-hidden>O</span>
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
      <CommandPalette items={palette} can={allowed} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}

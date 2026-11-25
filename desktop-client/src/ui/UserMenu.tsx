import { Link, useNavigate } from '@tanstack/react-router'
import { BookOpen, Building2, ChevronDown, Download, FolderOpen, Info, LayoutPanelLeft, LogOut, UserCog } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useReachability } from '@/api/reachability'
import { useSession } from '@/auth/session'
import { useChosenCompany, useCompanies } from '@/features/organization/queries'
import { NotificationsBell } from './NotificationsBell'
import { useLayout } from './layout'

export function UserMenu() {
  const { me, logout, server } = useSession()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const go = useNavigate()
  const layout = useLayout((l) => l.layout); const setLayout = useLayout((l) => l.set)
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
          <button role="menuitem" type="button" onClick={() => { setOpen(false); setLayout(layout === 'command' ? 'classic' : 'command') }} className="flex h-8 w-full items-center gap-2 rounded px-2.5 text-[13px] hover:bg-sunken"><LayoutPanelLeft className="size-4 text-muted" aria-hidden />{layout === 'command' ? 'Switch to the classic layout' : 'Switch to the command-centre layout'}</button>
          <a role="menuitem" href="https://docs.onesyncerp.com" target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="flex h-8 w-full items-center gap-2 rounded px-2.5 text-[13px] hover:bg-sunken"><BookOpen className="size-4 text-muted" aria-hidden />Help and documentation</a>
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


/** The company this window works in; a link to the companies page. */
export function CompanyChip() {
  const companies = useCompanies()
  const { companyId } = useChosenCompany()
  const company = (companies.data ?? []).find((c) => c.id === companyId) ?? companies.data?.[0]
  return company ? <Link to="/organization/companies" className="hidden max-w-48 items-center gap-1.5 truncate rounded-md border border-line px-2.5 py-1 text-[12.5px] font-medium hover:bg-sunken xl:flex" title="Company"><Building2 className="size-3.5 shrink-0 text-muted" aria-hidden /><span className="truncate">{company.tradeName ?? company.legalName}</span></Link> : null
}

/** A dot that says whether the server answers. */
export function ConnectionDot() {
  const down = useReachability((r) => r.down)
  return <span title={down ? 'Cannot reach the server' : 'Connected to the server'} className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className={`size-2 rounded-full ${down ? 'bg-bad' : 'bg-good'}`} aria-hidden /><span className="hidden 2xl:inline">{down ? 'Offline' : 'Connected'}</span></span>
}

/** The right-hand end of the top bar, the same in both layouts: company, connection, alerts and the account menu. */
export function HeaderTools() {
  return <><CompanyChip /><ConnectionDot /><NotificationsBell /><UserMenu /></>
}

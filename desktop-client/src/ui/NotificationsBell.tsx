import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { currentApi } from '@/auth/session'
import { useWorkspace } from '@/features/organization/workspace'
import { cn } from './cn'

const notice = z.object({ id: z.string(), severity: z.enum(['info', 'warn', 'bad']), title: z.string(), detail: z.string(), to: z.string(), count: z.number() })
type Notice = z.infer<typeof notice>
type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>

/** The bell in the top bar: what needs this person's attention, refreshed when something changes (and every ten minutes as a fallback) and when the window is focused. */
export function NotificationsBell() {
  const ws = useWorkspace(); const go = useNavigate()
  const companyId = ws.company?.id
  const q = useQuery({
    queryKey: ['notifications', companyId], enabled: Boolean(companyId), refetchInterval: 10 * 60_000, refetchOnWindowFocus: true, staleTime: 60_000,
    queryFn: async (): Promise<Notice[]> => (await currentApi().call((currentApi().raw as unknown as Raw)['GET']!('/v1/notifications', { params: { query: { companyId: companyId as string } } }) as never, z.object({ items: z.array(notice) }))).items,
  })
  const [open, setOpen] = useState(false); const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const items = q.data ?? []
  const urgent = items.some((n) => n.severity === 'bad')
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={items.length ? `Notifications: ${items.length} need attention` : 'Notifications: nothing needs attention'} onClick={() => setOpen((o) => !o)} className="relative grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink">
        <Bell className="size-[18px]" aria-hidden />
        {items.length ? <span className={cn('absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 text-white', urgent ? 'bg-bad' : 'bg-warn')} aria-hidden>{items.length}</span> : null}
      </button>
      {open ? (
        <div role="menu" aria-label="Notifications" className="settle absolute right-0 top-9 z-40 w-80 rounded-lg border border-line bg-surface p-1.5 shadow-pop">
          {items.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted">Nothing needs your attention.</p> : items.map((n) => (
            <button key={n.id} role="menuitem" type="button" onClick={() => { setOpen(false); void go({ to: n.to as never }) }} className="flex w-full flex-col gap-0.5 rounded px-2.5 py-2 text-left hover:bg-sunken">
              <span className="flex items-center gap-2 text-[13px] font-medium"><span className={cn('size-2 shrink-0 rounded-full', n.severity === 'bad' ? 'bg-bad' : n.severity === 'warn' ? 'bg-warn' : 'bg-brand')} aria-hidden />{n.title}</span>
              <span className="pl-4 text-xs text-muted">{n.detail}</span>
            </button>))}
        </div>) : null}
    </div>
  )
}

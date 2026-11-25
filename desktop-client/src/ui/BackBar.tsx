import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { currentNav, type NavItem } from './nav'

/** On any page that sits below a menu page (a record, a new document), a Back button that returns to wherever the person came from. */
export function BackBar({ items }: { items: NavItem[] }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const router = useRouter()
  const go = useNavigate()
  if (path === '/' || items.some((n) => n.to === path)) return null // a menu page itself
  const parent = currentNav(items, path)
  const back = (): void => { if (window.history.length > 1) router.history.back(); else void go({ to: (parent?.to ?? '/') as never }) }
  return <button type="button" onClick={back} className="mb-2 inline-flex h-7 items-center gap-1 rounded-md pr-2 text-[13px] text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Back</button>
}

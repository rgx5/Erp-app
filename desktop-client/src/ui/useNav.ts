import { useCallback, useMemo } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { NAV, visibleNav, type NavItem } from './nav'

/** The menu entries this person may see (their role and their plan), and the check the command palette uses. */
export function useVisibleNav(): { items: NavItem[]; allowed: (needs: string[]) => boolean } {
  const me = useSession((s) => s.me)
  const granted = me?.permissions ?? []
  const allowed = useCallback((needs: string[]) => can(granted, ...needs), [granted])
  const items = useMemo(() => visibleNav(NAV, allowed, me), [allowed, me])
  return { items, allowed }
}

import { useEffect } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { useWorkspace } from '@/features/organization/workspace'
import { runDueRecurring } from '@/features/sales/recurringQueries'
import { ClassicShell } from './ClassicShell'
import { CommandShell } from './CommandShell'
import { MobileShell } from './MobileShell'
import { usePhone } from './usePhone'
import { useFlash } from './flash'
import { useLayout } from './layout'

/** Raises recurring invoices that have come due, once each time the app opens for someone who may post sales. */
function useRaiseDueRecurring(): void {
  const ws = useWorkspace(); const flash = useFlash()
  const allowed = useSession((s) => can(s.me?.permissions ?? [], 'sales:post') && (!s.me?.entitlements || s.me.entitlements.modules.includes('sales') || !s.me.entitlements.restricted))
  const companyId = ws.company?.id
  useEffect(() => {
    if (!companyId || !allowed) return
    const key = `onesync.recurring.${companyId}.${new Date().toISOString().slice(0, 10)}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* run anyway */ }
    void runDueRecurring(companyId).then((r) => { if (r.generated.length) flash.show(`${r.generated.length} recurring invoice${r.generated.length === 1 ? ' was' : 's were'} raised.`) }).catch(() => undefined)
  }, [companyId, allowed]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The app frame, in whichever layout the person chose under My account. */
export function Shell() {
  useRaiseDueRecurring()
  const phone = usePhone()
  const layout = useLayout((s) => s.layout)
  if (phone) return <MobileShell />
  return layout === 'command' ? <CommandShell /> : <ClassicShell />
}

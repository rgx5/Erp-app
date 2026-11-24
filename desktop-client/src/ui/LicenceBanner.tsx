import { useReachability } from '@/api/reachability'
import { retryNow } from '@/auth/reconnect'
import { useSession } from '@/auth/session'
import { Alert, Button } from './primitives'

/** Tells people when the system is read-only (suspended or expired) or when the licence is about to expire. Renders nothing otherwise. */
export function LicenceBanner() {
  const note = useNote()
  return <>{<div className="mb-3 empty:hidden"><ConnectionNote /></div>}{note ? <div className="mb-3">{note}</div> : null}</>
}

/** Shown whenever the server cannot be reached: says so plainly, keeps trying by itself, and offers a button to try right now. */
function ConnectionNote() {
  const { down, checking } = useReachability()
  const offlineStart = useSession((s) => s.offlineStart)
  if (!down && !offlineStart) return null
  return (
    <Alert tone={down && !offlineStart ? 'error' : 'info'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span role="status">{offlineStart ? 'Working offline: the app opened with the details from your last sign-in. The counter keeps selling; everything is checked with the server again as soon as the connection returns.' : 'Cannot reach the server. Your work is safe; the app keeps trying and refreshes by itself when it is back.'}</span>
        <Button variant="secondary" busy={checking} onClick={() => void retryNow()}>Try again now</Button>
      </div>
    </Alert>
  )
}

function useNote() {
  const e = useSession((s) => s.me?.entitlements)
  if (!e?.restricted) return null
  if (e.readOnly) return <Alert><span role="status">{e.readOnlyReason === 'expired' ? 'The licence has expired, so the system is read-only. You can view and export your data. Ask your administrator to renew it.' : 'This account is suspended, so the system is read-only. You can view and export your data. Contact your administrator.'}</span></Alert>
  if (e.daysLeft !== null && e.daysLeft <= 14) return <Alert tone="info"><span role="status">{e.daysLeft >= 0 ? `The licence ends in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'}. Ask your administrator to renew it.` : 'The licence has ended. The system will become read-only soon: ask your administrator to renew it.'}</span></Alert>
  return null
}

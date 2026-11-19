import { useSession } from '@/auth/session'
import { Alert } from './primitives'

/** Tells people when the system is read-only (suspended or expired) or when the licence is about to expire. Renders nothing otherwise. */
export function LicenceBanner() {
  const note = useNote()
  return note ? <div className="mb-3">{note}</div> : null
}

function useNote() {
  const e = useSession((s) => s.me?.entitlements)
  if (!e?.restricted) return null
  if (e.readOnly) return <Alert><span role="status">{e.readOnlyReason === 'expired' ? 'The licence has expired, so the system is read-only. You can view and export your data. Ask your administrator to renew it.' : 'This account is suspended, so the system is read-only. You can view and export your data. Contact your administrator.'}</span></Alert>
  if (e.daysLeft !== null && e.daysLeft <= 14) return <Alert tone="info"><span role="status">{e.daysLeft >= 0 ? `The licence ends in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'}. Ask your administrator to renew it.` : 'The licence has ended. The system will become read-only soon: ask your administrator to renew it.'}</span></Alert>
  return null
}

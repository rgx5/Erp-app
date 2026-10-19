import { AppState } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'
import { useApp } from './store'

/**
 * The app lock: fingerprint, face or the phone's own PIN/pattern when the app opens or returns after being away. It
 * protects the business data on a phone that gets lent, lost or left on a counter — the thing a 4-digit staff PIN cannot.
 */

/** How long the app may sit in the background before it asks again. */
const GRACE_MS = 30_000

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
  } catch { return false }
}

/** Shows the system prompt. Resolves true when the person proves who they are. */
export async function unlock(reason = 'Unlock your business'): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false, cancelLabel: 'Cancel' })
    if (r.success) useApp.getState().setLocked(false)
    return r.success
  } catch { return false }
}

let left: number | null = null
let sub: { remove: () => void } | null = null

/** Locks the app after it has been in the background for a while. Call once from the root. */
export function watchAppLock() {
  if (sub) return
  sub = AppState.addEventListener('change', (st) => {
    const s = useApp.getState()
    if (st === 'background' || st === 'inactive') { left ??= Date.now(); return }
    if (st === 'active') {
      if (s.prefs.appLock && s.workspace && left && Date.now() - left > GRACE_MS) s.setLocked(true)
      left = null
    }
  })
}

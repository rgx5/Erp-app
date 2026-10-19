import { AppState } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { getApi, getToken, setToken } from './auth'
import { snapshotToData } from './snapshot'
import { onOutboxAdded, useApp } from './store'
import { createSyncEngine, type SyncEngine } from './sync'

/**
 * Wires the sync engine to the live app: a 30-second heartbeat, an immediate upload after every change, a refresh when
 * the connection returns or the app comes back to the foreground. Offline workspaces never start any of this.
 */

const HEARTBEAT_MS = 30_000
/** Pull fresh data from the server at most this often in the background (pull-to-refresh is always immediate). */
const PULL_EVERY_MS = 5 * 60_000

let engine: SyncEngine | null = null
let timer: ReturnType<typeof setInterval> | null = null
let kickTimer: ReturnType<typeof setTimeout> | null = null
let online = true
let unsubNet: (() => void) | null = null
let appSub: { remove: () => void } | null = null

function build(): SyncEngine {
  return createSyncEngine({
    api: () => getApi(),
    token: () => getToken(),
    setToken: (t) => { void setToken(t) },
    outbox: () => useApp.getState().outbox,
    updateOutbox: (id, patch) => useApp.getState().updateOutbox(id, patch),
    applySnapshot: async (snap) => {
      const s = useApp.getState()
      await s.replaceData(snapshotToData(snap, s.data), { keepOutbox: true })
    },
    isOnline: () => online,
    getState: () => useApp.getState().sync,
    setState: (p) => useApp.getState().patchSync(p),
  })
}

const connected = () => useApp.getState().workspace?.mode === 'remote'

async function tick(pull: boolean) {
  if (!engine || !connected()) return
  await engine.flush()
  const { lastPulledAt } = useApp.getState().sync
  if (pull || !lastPulledAt || Date.now() - lastPulledAt > PULL_EVERY_MS) await engine.pull()
}

/** Starts background syncing for a connected workspace (safe to call again). */
export function startSync() {
  if (!connected() || timer) return
  engine = build()
  engine.recount()
  useApp.getState().patchSync({ authenticated: !!getToken() })
  timer = setInterval(() => { void tick(false) }, HEARTBEAT_MS)
  onOutboxAdded(kickSync)
  unsubNet = NetInfo.addEventListener((s) => {
    const was = online
    online = s.isConnected !== false && s.isInternetReachable !== false
    useApp.getState().patchSync({ online })
    if (online && !was) void tick(true)
  })
  appSub = AppState.addEventListener('change', (st) => { if (st === 'active') void tick(true) })
  void tick(true)
}

export function stopSync() {
  if (timer) clearInterval(timer)
  if (kickTimer) clearTimeout(kickTimer)
  timer = null; kickTimer = null; engine = null
  unsubNet?.(); unsubNet = null
  appSub?.remove(); appSub = null
  onOutboxAdded(null)
}

/** A change was just queued: upload soon, coalescing a burst (a bill writes several rows) into one flush. */
export function kickSync() {
  if (!engine) return
  if (kickTimer) clearTimeout(kickTimer)
  kickTimer = setTimeout(() => { void engine?.flush() }, 600)
}

/** The "Sync now" button and pull-to-refresh: upload everything, then download the latest. */
export async function syncNow() {
  if (!engine) { if (connected()) startSync(); if (!engine) return }
  await engine.syncNow()
}

/** Puts every set-aside change back in the queue (after the cause has been fixed). */
export async function retryRejected() {
  await useApp.getState().resetRejected()
  engine?.recount()
  await engine?.flush()
}

import { id } from '@/domain/ids'
import { industryById } from '@/industries'
import { buildDemo, newBusinessState, type NewBusiness } from './demo'
import { createApi, normalizeApiUrl, type Api, type LoginResult } from './api'
import { createKoshApi } from './kosh/api'
import { hashPin, lockoutSeconds, verifyPin } from './pin'
import { secureDelete, secureGet, secureSet } from './secure'
import { snapshotToData } from './snapshot'
import { useApp, type Workspace } from './store'
import { listOf } from './state'
import { getStorage } from './storage'

/**
 * Everything that changes *who* and *where*: connecting to a server, creating an offline business, trying a demo,
 * switching person, signing out. Business operations live in ops.ts; this is the lifecycle around them.
 */

let token: string | null = null
export const getToken = () => token
export async function setToken(t: string | null) {
  token = t
  if (t) await secureSet('token', t); else await secureDelete('token')
}

/** The API client for the connected server (null for an offline workspace). */
export function getApi(): Api | null {
  const ws = useApp.getState().workspace
  return ws?.mode === 'remote' && ws.apiUrl && ws.backend !== 'kosh' ? createApi(ws.apiUrl, getToken) : null
}

const TAG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const randomTag = () => 'M' + Array.from({ length: 2 }, () => TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)]).join('')
/** 9-digit barcode bodies leave room for ~89 phones with 10 million codes each, far from a counter's 1, 2, 3… */
const randomBarcodeBase = () => (1 + Math.floor(Math.random() * 88)) * 10_000_000

/** Best guess at which pack a connected store resembles, from its category ids. Can be changed in Settings. */
function detectIndustry(categoryIds: string[]): string {
  if (categoryIds.some((c) => /^cat_(w|m|fab_|home_|kids)/.test(c))) return 'apparel'
  return 'general'
}

// ───────────────────────────── boot ─────────────────────────────

/** Loads everything from the phone and restores the saved sign-in. */
export async function bootApp(): Promise<void> {
  await useApp.getState().boot()
  const ws = useApp.getState().workspace
  if (ws?.mode === 'remote') token = await secureGet('token')
}

// ───────────────────────────── connecting to a server ─────────────────────────────

async function finishConnect(apiUrl: string, login: LoginResult, email?: string): Promise<void> {
  const s = useApp.getState()
  const keepDevice = s.workspace?.mode === 'remote' && s.workspace.storeId === login.store.id ? s.workspace : null
  const api = createApi(apiUrl, () => login.token)
  const snap = await api.snapshot()
  const data = snapshotToData(snap, keepDevice ? s.data : undefined)
  const ws: Workspace = {
    id: login.store.id, name: login.store.name, mode: 'remote', industry: keepDevice?.industry ?? detectIndustry(snap.categories.map((c) => c.id)),
    apiUrl: normalizeApiUrl(apiUrl), storeId: login.store.id, deviceTag: keepDevice?.deviceTag ?? randomTag(),
    barcodeBase: keepDevice?.barcodeBase ?? randomBarcodeBase(), createdAt: keepDevice?.createdAt ?? Date.now(),
    ...(email ? { loginEmail: email } : keepDevice?.loginEmail ? { loginEmail: keepDevice.loginEmail } : {}),
  }
  await setToken(login.token)
  await s.replaceData(data, { keepOutbox: !!keepDevice })
  await s.setWorkspace(ws)
  await s.setSession({ userId: login.user.id })
  s.patchSync({ authenticated: true, lastError: null, lastPulledAt: Date.now() })
}

/** Owner / manager sign-in with email and password, then the whole business is downloaded. */
export async function connectWithPassword(apiUrl: string, email: string, password: string): Promise<void> {
  const login = await createApi(apiUrl).webLogin(email.trim(), password)
  await finishConnect(apiUrl, login, email.trim())
}

/** Staff sign-in with the business's Store ID, their name and their 4-digit PIN. */
export async function connectWithPin(apiUrl: string, storeId: string, userId: string, pin: string): Promise<void> {
  const login = await createApi(apiUrl).pinLogin(storeId.trim(), userId, pin)
  await finishConnect(apiUrl, login)
}

/** The staff list a PIN sign-in offers (names only — the server never sends hashes). */
export const listStaff = (apiUrl: string, storeId: string) => createApi(apiUrl).staff(storeId.trim())

/** The session token lapsed (they last 12 hours): sign in again without losing anything waiting to upload. */
export async function reauthenticate(password: string): Promise<void> {
  const s = useApp.getState()
  const ws = s.workspace
  if (!ws?.apiUrl || !ws.loginEmail) throw new Error('Sign out and connect again to continue syncing.')
  if (ws.backend === 'kosh') {
    const login = await createKoshApi(ws.apiUrl).login(ws.loginEmail, password, ws.deviceId ?? 'dev', 'OneSyncERP app')
    await setToken(login.token)
  } else {
    const login = await createApi(ws.apiUrl).webLogin(ws.loginEmail, password)
    await setToken(login.token)
  }
  s.patchSync({ authenticated: true, lastError: null })
}

// ───────────────────────────── offline & demo workspaces ─────────────────────────────

/** A brand-new business that lives on this phone. */
export async function createLocalBusiness(input: Omit<NewBusiness, 'pinHash' | 'pack'> & { packId: string; pin: string }): Promise<void> {
  const pack = industryById(input.packId)
  const pinHash = await hashPin(input.pin)
  const data = newBusinessState({ ...input, pack, pinHash })
  const owner = listOf(data.users)[0]
  const s = useApp.getState()
  await setToken(null)
  await s.replaceData(data)
  await s.setWorkspace({ id: data.store!.id, name: data.store!.name, mode: 'local', industry: pack.id, deviceTag: '', barcodeBase: 1, createdAt: Date.now() })
  await s.setSession({ userId: owner.id })
}

/** A fully-stocked sample business (all PINs 1234) to explore the app. */
export async function createDemoBusiness(packId: string): Promise<void> {
  const pinHash = await hashPin('1234')
  const data = buildDemo(packId, { pinHash })
  const owner = listOf(data.users).find((u) => u.role === 'owner')!
  const s = useApp.getState()
  await setToken(null)
  await s.replaceData(data)
  await s.setWorkspace({ id: data.store!.id, name: data.store!.name, mode: 'local', industry: packId, deviceTag: '', barcodeBase: 1, createdAt: Date.now(), demo: true })
  await s.setSession({ userId: owner.id })
}

// ───────────────────────────── people ─────────────────────────────

const FAIL_KEY = 'pinFailures'
const LOCK_KEY = 'pinLockedUntil'

export type PinResult = 'ok' | 'wrong' | 'locked' | 'offline'

/** Seconds left on a wrong-PIN lockout for this phone (0 = not locked). */
export async function lockedForSeconds(): Promise<number> {
  const saved = await getStorage().load()
  const until = Number(saved.kv[LOCK_KEY] ?? 0)
  return Math.max(0, Math.ceil((until - Date.now()) / 1000))
}

/**
 * Switch to another person at the counter. An offline workspace checks the stored PIN hash; a connected one asks the
 * server (which also issues that person's own token, so what they can do syncs under their own role).
 */
export async function switchUser(userId: string, pin: string): Promise<PinResult> {
  const s = useApp.getState()
  const ws = s.workspace
  const user = s.data.users[userId]
  if (!ws || !user || !user.active) return 'wrong'

  if (await lockedForSeconds() > 0) return 'locked'

  let ok = false
  if (ws.mode === 'remote' && ws.backend === 'kosh' && ws.apiUrl && ws.storeId && ws.deviceId) {
    try {
      const login = await createKoshApi(ws.apiUrl).pinLogin(ws.storeId, userId, pin, ws.deviceId, 'OneSyncERP app')
      await setToken(login.token)
      ok = true
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0
      if (status === 429) return 'locked'
      if (status === 0) return 'offline'
    }
  } else if (ws.mode === 'remote' && ws.apiUrl && ws.storeId) {
    try {
      const login = await createApi(ws.apiUrl).pinLogin(ws.storeId, userId, pin)
      await setToken(login.token)
      ok = true
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0
      if (status === 429) return 'locked'
      if (status === 0) return 'offline'
    }
  } else {
    ok = await verifyPin(pin, user.pin)
  }

  const saved = await getStorage().load()
  if (ok) {
    await getStorage().write({ kv: { [FAIL_KEY]: null, [LOCK_KEY]: null } })
    await s.setSession({ userId })
    return 'ok'
  }
  const failures = Number(saved.kv[FAIL_KEY] ?? 0) + 1
  const wait = lockoutSeconds(failures)
  await getStorage().write({ kv: { [FAIL_KEY]: String(failures), ...(wait ? { [LOCK_KEY]: String(Date.now() + wait * 1000) } : {}) } })
  return wait ? 'locked' : 'wrong'
}

/** Sign out of this business on this phone. Everything not yet uploaded is lost, so callers confirm first. */
export async function signOut(): Promise<void> {
  await setToken(null)
  await useApp.getState().wipe()
}

export const newWorkspaceId = () => id('ws')

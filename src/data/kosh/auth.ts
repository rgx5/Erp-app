import { industryById } from '@/industries'
import { applyPull, mutationsFromChanges, settingsToDoc } from '@/replication/client'
import type { Mutation } from '@/replication/types'
import { newBusinessState, type NewBusiness } from '../demo'
import { hashPin } from '../pin'
import { emptyData, listOf, COLLECTIONS, type Changes, type DataState } from '../state'
import { setToken } from '../auth'
import { useApp, type Workspace } from '../store'
import { createKoshApi, type KoshApi, type KoshSession } from './api'

const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
export const newDeviceId = () => `dev_${hex(10)}`
const TAG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const randomTag = () => 'M' + Array.from({ length: 2 }, () => TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)]).join('')
const randomBarcodeBase = () => (1 + Math.floor(Math.random() * 88)) * 10_000_000
const DEVICE_NAME = 'Kosh app'

/** The api for the connected Kosh workspace (null for any other kind). */
export function getKoshApi(getToken: () => string | null): KoshApi | null {
  const ws = useApp.getState().workspace
  return ws?.mode === 'remote' && ws.backend === 'kosh' && ws.apiUrl ? createKoshApi(ws.apiUrl, getToken) : null
}

/** Downloads the whole business, page by page. */
export async function downloadAll(api: KoshApi, fallbackStoreId: string): Promise<{ data: DataState; cursor: number }> {
  let data = emptyData()
  let cursor = 0
  for (;;) {
    const page = await api.pull(cursor, 500)
    data = applyPull(data, page, new Set(), fallbackStoreId)
    cursor = page.cursor
    if (!page.hasMore) break
  }
  return { data, cursor }
}

function workspaceFor(session: KoshSession, url: string, deviceId: string, industry: string, keep?: Workspace | null, extra: Partial<Workspace> = {}): Workspace {
  return {
    id: session.org.id, name: session.org.name, mode: 'remote', backend: 'kosh', industry, apiUrl: url, storeId: session.org.id, deviceId,
    ...(session.branch?.id ? { branchId: session.branch.id } : {}),
    deviceTag: keep?.deviceTag ?? randomTag(), barcodeBase: keep?.barcodeBase ?? randomBarcodeBase(), createdAt: keep?.createdAt ?? Date.now(), ...extra,
  }
}

/** Sign in to an existing business on a Kosh server and download it. */
async function finishLogin(url: string, session: KoshSession, deviceId: string, email?: string): Promise<void> {
  const s = useApp.getState()
  const keep = s.workspace?.backend === 'kosh' && s.workspace.storeId === session.org.id ? s.workspace : null
  const api = createKoshApi(url, () => session.token)
  const { data, cursor } = await downloadAll(api, session.org.id)
  const industry = data.store?.industry ?? session.org.industry ?? keep?.industry ?? 'general'
  await setToken(session.token)
  await s.replaceData(data, { keepOutbox: !!keep })
  await s.setWorkspace(workspaceFor(session, url, deviceId, industry, keep, email ? { loginEmail: email } : keep?.loginEmail ? { loginEmail: keep.loginEmail } : {}))
  await s.setCursor(cursor)
  await s.setSession({ userId: session.user.id })
  s.patchSync({ authenticated: true, lastError: null, lastPulledAt: Date.now() })
}

const deviceIdFor = (orgId?: string) => {
  const ws = useApp.getState().workspace
  return ws?.backend === 'kosh' && (!orgId || ws.storeId === orgId) && ws.deviceId ? ws.deviceId : newDeviceId()
}

/** Owner / manager sign-in with email and password. */
export async function koshLogin(url: string, email: string, password: string): Promise<void> {
  const deviceId = deviceIdFor()
  const session = await createKoshApi(url).login(email.trim(), password, deviceId, DEVICE_NAME)
  await finishLogin(url, session, session.device?.id ?? deviceId, email.trim())
}

/** Staff sign-in with a PIN. */
export async function koshPinLogin(url: string, orgId: string, userId: string, pin: string): Promise<void> {
  const deviceId = deviceIdFor(orgId)
  const session = await createKoshApi(url).pinLogin(orgId, userId, pin, deviceId, DEVICE_NAME)
  await finishLogin(url, session, session.device?.id ?? deviceId)
}

export const koshStaff = (url: string, orgId: string) => createKoshApi(url).staff(orgId.trim())

/** Every document of a state as the writes that would create it on an empty server (users are not documents). */
export function publishAll(data: DataState, deviceId = 'publish'): Mutation[] {
  const put: Record<string, unknown[]> = {}
  for (const coll of COLLECTIONS) if (coll !== 'users') put[coll] = listOf(data[coll] as Record<string, never>)
  let n = 0
  const muts = mutationsFromChanges(emptyData(), { put: put as Changes['put'] }, { deviceId, nextSeq: () => ++n })
  if (data.store) muts.unshift({ mid: `${deviceId}:settings`, coll: 'settings', id: 'store', op: 'create', data: settingsToDoc(data.store), at: Date.now() })
  return muts.filter((m) => !(m.coll === 'bills' && (m.data as { status?: string } | undefined)?.status === 'held'))
}

export interface NewKoshBusiness extends Omit<NewBusiness, 'pinHash' | 'pack'> { packId: string; pin: string; email: string; password: string }

/**
 * Creates a business on a Kosh server: the organisation and its owner there, the starting catalogue here, then everything is
 * uploaded. The owner keeps the same id on both sides, so bills and reports attribute sales to the right person.
 */
export async function koshCreateBusiness(url: string, input: NewKoshBusiness): Promise<void> {
  const pack = industryById(input.packId)
  const data = newBusinessState({ ...input, pack, pinHash: await hashPin(input.pin) })
  data.store = { ...data.store!, industry: pack.id }
  const owner = listOf(data.users)[0]
  const deviceId = newDeviceId()
  const session = await createKoshApi(url).signup({
    orgName: input.name, ownerName: input.ownerName, email: input.email.trim(), password: input.password, pin: input.pin, industry: pack.id, ownerId: owner.id, deviceId, deviceName: DEVICE_NAME,
  })
  await adopt(url, session, deviceId, data, pack.id, input.email.trim())
}

/**
 * Moves the business that lives on this phone to a Kosh server: creates the organisation there with this owner, and uploads
 * every record. Staff other than the owner keep their local PIN hashes only on this phone, so they are added again on the
 * server (the returned count says how many).
 */
export async function koshMoveToServer(url: string, input: { email: string; password: string; pin: string }): Promise<{ staffToReAdd: number }> {
  const s = useApp.getState()
  const ws = s.workspace
  const me = s.session ? s.data.users[s.session.userId] : null
  if (!ws || ws.mode !== 'local' || !me || me.role !== 'owner') throw new Error('Only the owner of an offline business can move it to a server.')
  const deviceId = newDeviceId()
  const data: DataState = { ...s.data, store: s.data.store ? { ...s.data.store, industry: ws.industry } : s.data.store }
  const session = await createKoshApi(url).signup({
    orgName: s.data.store?.name ?? ws.name, ownerName: me.name, email: input.email.trim(), password: input.password, pin: input.pin, industry: ws.industry, ownerId: me.id, deviceId, deviceName: DEVICE_NAME,
  })
  await adopt(url, session, deviceId, data, ws.industry, input.email.trim(), ws)
  return { staffToReAdd: listOf(s.data.users).filter((u) => u.id !== me.id && u.active).length }
}

async function adopt(url: string, session: KoshSession, deviceId: string, data: DataState, industry: string, email: string, keep?: Workspace | null): Promise<void> {
  const s = useApp.getState()
  await setToken(session.token)
  await s.replaceData(data)
  await s.setWorkspace(workspaceFor(session, url, deviceId, industry, null, { loginEmail: email, ...(keep?.createdAt ? { createdAt: keep.createdAt } : {}), ...(keep?.demo ? { demo: true } : {}) }))
  await s.setCursor(0)
  await s.setSession({ userId: session.user.id })
  s.patchSync({ authenticated: true, lastError: null })
  s.enqueue(publishAll(useApp.getState().data, deviceId))
}

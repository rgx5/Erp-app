import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { adminUser, apiKey, auditEvent, page, role, type AdminUser, type ApiKey, type AuditEvent, type Role } from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const send = <T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, schema: z.ZodType<T>, opts: { key?: string; ifMatch?: number } = {}): Promise<T> =>
  currentApi().call(raw()[method]!(path, { body: body ?? {}, headers: { ...(opts.key ? { 'idempotency-key': opts.key } : {}), ...(opts.ifMatch !== undefined ? { 'if-match': String(opts.ifMatch) } : {}) } }) as never, schema)

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['admin'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
function usePaged<T>(key: unknown[], enabled: boolean, path: string, extra: Record<string, unknown>, schema: z.ZodType<T>) {
  const q = useInfiniteQuery({ queryKey: ['admin', ...key], enabled, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get(path, { query: query({ limit: 100, cursor: pageParam, ...extra }) }, page(schema)), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as T[]) }
}

export const useUsers = (on = true) => usePaged<AdminUser>(['users'], on, '/v1/users', {}, adminUser)
export const useCreateUser = () => useWrite(({ body, key }: { body: { email: string; displayName: string; password: string; roleIds: string[] }; key: string }) => send('POST', '/v1/users', body, adminUser, { key }))
export const useUpdateUser = () => useWrite(({ id, version, body }: { id: string; version: number; body: { displayName?: string; status?: string } }) => send('PATCH', `/v1/users/${id}`, body, adminUser, { ifMatch: version }))
export const useSetUserRoles = () => useWrite(({ id, roleIds }: { id: string; roleIds: string[] }) => send('PUT', `/v1/users/${id}/roles`, { roleIds }, adminUser))

export const useRoles = (on = true) => usePaged<Role>(['roles'], on, '/v1/roles', {}, role)
export const useCreateRole = () => useWrite(({ body, key }: { body: { name: string; description?: string; permissions: string[] }; key: string }) => send('POST', '/v1/roles', body, role, { key }))
export const useUpdateRole = () => useWrite(({ id, version, body }: { id: string; version: number; body: { name?: string; description?: string | null; permissions?: string[] } }) => send('PATCH', `/v1/roles/${id}`, body, role, { ifMatch: version }))
export const usePermissions = () => useQuery({ queryKey: ['admin', 'permissions'], staleTime: 300_000, queryFn: async (): Promise<string[]> => (await get('/v1/roles/permissions', {}, z.object({ items: z.array(z.string()) }))).items })

export const useApiKeys = (on = true) => usePaged<ApiKey>(['api-keys'], on, '/v1/api-keys', {}, apiKey)
export const useCreateApiKey = () => useWrite((body: { name: string; permissions: string[]; expiresAt?: string }) => send('POST', '/v1/api-keys', body, apiKey.extend({ key: z.string() })))
export const useRevokeApiKey = () => useWrite((id: string) => send('POST', `/v1/api-keys/${id}/revoke`, {}, apiKey))

export interface AuditFilter { action?: string; entityType?: string; outcome?: string; from?: string; to?: string }
export const useAudit = (f: AuditFilter) => usePaged<AuditEvent>(['audit', f], true, '/v1/audit-events', f as Record<string, unknown>, auditEvent)

export const changePassword = (currentPassword: string, newPassword: string): Promise<unknown> => currentApi().call(raw()['POST']!('/v1/auth/password', { body: { currentPassword, newPassword } }) as never, z.unknown())
export const mfaEnroll = (): Promise<{ secret: string; otpauthUri: string }> => send('POST', '/v1/auth/mfa/enroll', {}, z.object({ secret: z.string(), otpauthUri: z.string() }))
export const mfaActivate = (code: string): Promise<{ recoveryCodes: string[] }> => send('POST', '/v1/auth/mfa/activate', { code }, z.object({ recoveryCodes: z.array(z.string()) }))
export const mfaDisable = (password: string, code: string): Promise<unknown> => currentApi().call(raw()['POST']!('/v1/auth/mfa/disable', { body: { password, code } }) as never, z.unknown())

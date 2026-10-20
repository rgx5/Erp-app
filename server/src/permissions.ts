import { ROLE_PERMISSIONS } from '@/domain/permissions'
import { allCollectionMetas, permList } from '@/replication/registry'

/** Every permission name the server knows: the built-in matrix plus whatever modules registered. */
export function knownPermissions(): string[] {
  const set = new Set<string>()
  for (const list of Object.values(ROLE_PERMISSIONS)) for (const p of list) set.add(p)
  for (const m of allCollectionMetas()) for (const p of [...permList(m.perm), ...permList(m.readPerm ?? m.perm)]) if (p !== 'any') set.add(p)
  return [...set].sort()
}

/** The permissions of a built-in role. */
export const permissionsOfRole = (role: string): string[] => ((ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? []).slice()

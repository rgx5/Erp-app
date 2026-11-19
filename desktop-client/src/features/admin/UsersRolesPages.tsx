import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { AdminUser, Role } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate } from '@/domain/format'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Spinner, TextField } from '@/ui/primitives'
import { PermissionPicker } from './PermissionPicker'
import { useCreateRole, useCreateUser, useRoles, useSetUserRoles, useUpdateRole, useUpdateUser, useUsers } from './queries'

const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)

function RoleBoxes({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="flex flex-col gap-1" role="group" aria-label="Roles">{roles.map((r) => <label key={r.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" aria-label={r.name} checked={value.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} /><span>{r.name}{r.description ? <span className="block text-xs text-muted">{r.description}</span> : null}</span></label>)}</div>
}

export function UsersPage() {
  const me = useSession((s) => s.me)
  const canWrite = can(me?.permissions ?? [], 'users:write')
  const users = useUsers()
  const roles = useRoles()
  const create = useCreateUser(); const update = useUpdateUser(); const setRoles = useSetUserRoles()
  const flash = useFlash()
  const [open, setOpen] = useState<AdminUser | 'new' | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const roleName = (id: string): string => roles.rows.find((r) => r.id === id)?.name ?? ''
  const columns = useMemo<ColumnDef<AdminUser, unknown>[]>(() => [
    { header: 'Name', accessorKey: 'displayName', size: 220 }, { header: 'Email', accessorKey: 'email', size: 280 }, { header: 'Roles', accessorFn: (u) => (u.roleIds ?? []).map(roleName).join(', '), size: 240 },
    { header: 'Two-step sign-in', accessorFn: (u) => (u.mfaEnabled ? 'On' : 'Off'), size: 120 }, { header: 'Last sign-in', accessorFn: (u) => (u.lastLoginAt ? formatDate(u.lastLoginAt.slice(0, 10)) : 'Never'), size: 120 }, { header: 'Status', accessorFn: (u) => (u.status === 'active' ? 'Active' : 'Disabled'), size: 90 },
  ], [roles.rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const person = open && open !== 'new' ? open : null
  const schema = z.object({ email: z.string().trim().toLowerCase().email('A valid email'), displayName: z.string().trim().min(1, 'Required').max(200), password: z.string() })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Users</h1>{canWrite ? <Button onClick={() => { setPicked([]); setProblem(null); setOpen('new') }}><Plus className="size-4" aria-hidden /> Add user</Button> : null}</div>
      {users.error ? <Alert>{users.error.message}</Alert> : null}
      {users.isPending ? <Spinner /> : <DataTable columns={columns} rows={users.rows} rowKey={(u) => u.id} onOpen={(u) => { setPicked(u.roleIds ?? []); setProblem(null); setOpen(u) }} empty="No users." height={480} />}
      {open ? (
        <Drawer title={person ? person.displayName : 'Add a user'} onClose={() => setOpen(null)} width={560}>
          {person ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">{person.email} · two-step sign-in {person.mfaEnabled ? 'on' : 'off'}</p>
              <h3 className="text-sm font-semibold">Roles</h3>
              <RoleBoxes roles={roles.rows} value={picked} onChange={setPicked} />
              {problem ? <Alert>{problem}</Alert> : null}
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Button busy={setRoles.isPending} onClick={async () => { setProblem(null); try { await setRoles.mutateAsync({ id: person.id, roleIds: picked }); flash.show('Roles saved.'); setOpen(null) } catch (e) { setProblem(msg(e, 'Could not save the roles.')) } }}>Save roles</Button>
                  {person.id !== me?.user?.id ? <Button variant="secondary" busy={update.isPending} onClick={async () => { setProblem(null); try { await update.mutateAsync({ id: person.id, version: person.version, body: { status: person.status === 'active' ? 'disabled' : 'active' } }); flash.show(person.status === 'active' ? 'User disabled: they can no longer sign in.' : 'User enabled.'); setOpen(null) } catch (e) { setProblem(msg(e, 'Could not change the status.')) } }}>{person.status === 'active' ? 'Disable user' : 'Enable user'}</Button> : null}
                </div>) : null}
            </div>
          ) : (
            <SimpleForm schema={schema.refine((v) => v.password.length >= 12, { path: ['password'], message: 'At least 12 characters' })} defaults={{ email: '', displayName: '', password: '' }} fields={['email', 'displayName', 'password']} label="Add user"
              submit={async (v) => { try { await create.mutateAsync({ key: crypto.randomUUID(), body: { email: v.email, displayName: v.displayName, password: v.password, roleIds: picked } }); flash.show(`${v.displayName} added. Give them the password; they can change it after signing in.`); setOpen(null) } catch (e) { throw new Error(msg(e, 'Could not add the user.')) } }}>
              {({ register, errors }) => (<><TextField label="Email" error={errors.email?.message as string | undefined} {...register('email')} /><TextField label="Name" error={errors.displayName?.message as string | undefined} {...register('displayName')} /><TextField label="Starting password" type="password" hint="At least 12 characters" error={errors.password?.message as string | undefined} {...register('password')} />
                <div><h3 className="mb-1 text-sm font-semibold">Roles</h3><RoleBoxes roles={roles.rows} value={picked} onChange={setPicked} /></div></>)}
            </SimpleForm>)}
        </Drawer>) : null}
    </div>
  )
}

export function RolesPage() {
  const canWrite = can(useSession((s) => s.me?.permissions ?? []), 'roles:write')
  const roles = useRoles()
  const create = useCreateRole(); const update = useUpdateRole()
  const flash = useFlash()
  const [open, setOpen] = useState<Role | 'new' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [perms, setPerms] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const role = open && open !== 'new' ? open : null
  const mine = useSession((s) => s.me?.permissions ?? [])
  const show = (r: Role | 'new'): void => { setName(r === 'new' ? '' : r.name); setDescription(r === 'new' ? '' : r.description ?? ''); setPerms(r === 'new' ? [] : r.permissions.filter((p) => p !== '*')); setProblem(null); setOpen(r) }
  const columns = useMemo<ColumnDef<Role, unknown>[]>(() => [
    { header: 'Role', accessorKey: 'name', size: 220 }, { header: 'Description', accessorFn: (r) => r.description ?? '', size: 360 }, { header: 'Permissions', accessorFn: (r) => (r.permissions.includes('*') ? 'Everything' : String(r.permissions.length)), size: 110, meta: { align: 'right' } }, { header: 'Kind', accessorFn: (r) => (r.isSystem ? 'Built in' : 'Custom'), size: 90 },
  ], [])
  const locked = role?.isSystem === true || !canWrite
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Roles</h1>{canWrite ? <Button onClick={() => show('new')}><Plus className="size-4" aria-hidden /> New role</Button> : null}</div>
      <p className="max-w-3xl text-sm text-muted">A role is a set of things a person may do. You can only give a role permissions you hold yourself. The Owner role is built in and cannot be changed.</p>
      {roles.error ? <Alert>{roles.error.message}</Alert> : null}
      {roles.isPending ? <Spinner /> : <DataTable columns={columns} rows={roles.rows} rowKey={(r) => r.id} onOpen={show} empty="No roles." height={420} />}
      {open ? (
        <Drawer title={role ? role.name : 'New role'} onClose={() => setOpen(null)} width={720}>
          <div className="flex flex-col gap-4">
            <TextField label="Name" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} /><TextField label="Description (optional)" value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
            {role?.permissions.includes('*') ? <Alert tone="info">The Owner role can do everything.</Alert> : <PermissionPicker value={perms} onChange={setPerms} disabled={locked} limit={mine} />}
            {problem ? <Alert>{problem}</Alert> : null}
            {!locked ? <Button busy={create.isPending || update.isPending} disabled={!name.trim()} onClick={async () => { setProblem(null); try { if (role) await update.mutateAsync({ id: role.id, version: role.version, body: { name: name.trim(), description: description.trim() || null, permissions: perms } }); else await create.mutateAsync({ key: crypto.randomUUID(), body: { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), permissions: perms } }); flash.show(role ? 'Role saved.' : 'Role created.'); setOpen(null) } catch (e) { setProblem(msg(e, 'Could not save the role.')) } }}>{role ? 'Save role' : 'Create role'}</Button> : null}
          </div>
        </Drawer>) : null}
    </div>
  )
}

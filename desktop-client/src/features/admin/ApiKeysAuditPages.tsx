import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { ApiKey, AuditEvent } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate } from '@/domain/format'
import { download, toCsv } from '@/features/masterdata/csv'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { PermissionPicker } from './PermissionPicker'
import { useApiKeys, useAudit, useCreateApiKey, useRevokeApiKey, useUsers } from './queries'

const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)

export function ApiKeysPage() {
  const mine = useSession((s) => s.me?.permissions ?? [])
  const keys = useApiKeys()
  const create = useCreateApiKey(); const revoke = useRevokeApiKey()
  const flash = useFlash()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [perms, setPerms] = useState<string[]>([])
  const [expires, setExpires] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<ApiKey, unknown>[]>(() => [
    { header: 'Name', accessorKey: 'name', size: 220 }, { header: 'Starts with', accessorKey: 'keyPrefix', size: 140 }, { header: 'Permissions', accessorFn: (k) => String(k.permissions.length), size: 100, meta: { align: 'right' } },
    { header: 'Last used', accessorFn: (k) => (k.lastUsedAt ? formatDate(k.lastUsedAt.slice(0, 10)) : 'Never'), size: 110 }, { header: 'Expires', accessorFn: (k) => (k.expiresAt ? formatDate(k.expiresAt.slice(0, 10)) : 'Never'), size: 110 }, { header: 'Status', accessorFn: (k) => (k.revokedAt ? 'Revoked' : 'Active'), size: 90 },
  ], [])
  if (!can(mine, 'api_keys:manage')) return <Alert tone="info">You do not have the right to manage API keys.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">API keys</h1><Button onClick={() => { setName(''); setPerms([]); setExpires(''); setSecret(null); setProblem(null); setAdding(true) }}>New API key</Button></div>
      <p className="max-w-3xl text-sm text-muted">A key lets another program use this business&apos;s data with only the permissions you choose. The key is shown once, when it is made.</p>
      {keys.isPending ? <Spinner /> : <DataTable columns={columns} rows={keys.rows} rowKey={(k) => k.id} onOpen={() => undefined} empty="No API keys." height={360} />}
      <div className="flex flex-col gap-1">{keys.rows.filter((k) => !k.revokedAt).map((k) => <div key={k.id} className="flex items-center justify-between text-sm"><span>{k.name} <span className="text-muted">({k.keyPrefix}…)</span></span><Button variant="ghost" aria-label={`Revoke ${k.name}`} onClick={async () => { try { await revoke.mutateAsync(k.id); flash.show(`${k.name} revoked: it stops working now.`) } catch (e) { flash.show(msg(e, 'Could not revoke.')) } }}>Revoke</Button></div>)}</div>
      {adding ? (
        <Drawer title={secret ? 'Copy your key now' : 'New API key'} onClose={() => setAdding(false)} width={720}>
          {secret ? (
            <div className="flex flex-col gap-3"><Alert tone="info">This is the only time the key is shown. Store it somewhere safe; if it is lost, make a new one and revoke this.</Alert>
              <code className="break-all rounded border border-line bg-canvas p-3 text-sm" aria-label="New API key">{secret}</code>
              <div className="flex gap-2"><Button onClick={() => void navigator.clipboard?.writeText(secret)}>Copy</Button><Button variant="secondary" onClick={() => setAdding(false)}>I have saved it</Button></div></div>
          ) : (
            <div className="flex flex-col gap-4">
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} hint="What it is for, e.g. Accountant export" /><TextField label="Expires on (optional)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              <PermissionPicker value={perms} onChange={setPerms} limit={mine} />
              {problem ? <Alert>{problem}</Alert> : null}
              <Button busy={create.isPending} disabled={!name.trim() || perms.length === 0} onClick={async () => { setProblem(null); try { const k = await create.mutateAsync({ name: name.trim(), permissions: perms, ...(expires ? { expiresAt: `${expires}T23:59:59.000Z` } : {}) }); setSecret(k.key) } catch (e) { setProblem(msg(e, 'Could not create the key.')) } }}>Create key</Button>
            </div>)}
        </Drawer>) : null}
    </div>
  )
}

export function AuditPage() {
  const canRead = can(useSession((s) => s.me?.permissions ?? []), 'audit:read')
  const [entity, setEntity] = useState('')
  const [outcome, setOutcome] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [action, setAction] = useState('')
  const list = useAudit({ ...(entity ? { entityType: entity } : {}), ...(outcome ? { outcome } : {}), ...(action ? { action } : {}), ...(from ? { from: `${from}T00:00:00.000Z` } : {}), ...(to ? { to: `${to}T23:59:59.999Z` } : {}) })
  const users = useUsers(canRead)
  const who = (id: string | null, type: string): string => (id ? users.rows.find((u) => u.id === id)?.displayName ?? (type === 'api_key' ? 'API key' : id.slice(0, 8)) : type)
  const [open, setOpen] = useState<AuditEvent | null>(null)
  const columns = useMemo<ColumnDef<AuditEvent, unknown>[]>(() => [
    { header: 'When', accessorFn: (e) => new Date(e.occurredAt).toLocaleString('en-IN'), size: 170 }, { header: 'Who', accessorFn: (e) => who(e.actorId, e.actorType), size: 160 }, { header: 'Action', accessorKey: 'action', size: 230 },
    { header: 'On', accessorFn: (e) => e.entityType ?? '', size: 160 }, { header: 'Result', accessorFn: (e) => (e.outcome === 'success' ? 'Done' : 'Refused'), size: 80 },
  ], [users.rows]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!canRead) return <Alert tone="info">You do not have the right to read the audit log.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Audit log</h1>
      <p className="max-w-3xl text-sm text-muted">Everything that changed or was refused, newest first. Entries cannot be edited or removed.</p>
      <Toolbar>
        <div className="w-48"><TextField label="Action contains" value={action} onChange={(e) => setAction(e.target.value.trim())} placeholder="e.g. invoice.posted" /></div>
        <div className="w-44"><TextField label="Record type" value={entity} onChange={(e) => setEntity(e.target.value.trim())} placeholder="e.g. sales_invoice" /></div>
        <div className="w-36"><SelectField label="Result" value={outcome} onChange={(e) => setOutcome(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'success', label: 'Done' }, { value: 'failure', label: 'Refused' }]} /></div>
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="secondary" className="self-end" disabled={list.rows.length === 0} onClick={() => download('audit-log.csv', toCsv(['When', 'Who', 'Action', 'Record type', 'Record', 'Result', 'Request', 'IP address'], list.rows.map((e) => [e.occurredAt, who(e.actorId, e.actorType), e.action, e.entityType ?? '', e.entityId ?? '', e.outcome, e.requestId ?? '', e.ipAddress ?? ''])))}>Export CSV</Button>
      </Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(e) => e.id} onOpen={setOpen} empty="Nothing logged for these filters." height={520} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? (
        <Drawer title={open.action} onClose={() => setOpen(null)} width={560}>
          <dl className="flex flex-col gap-1 text-sm" aria-label="Audit entry">{([['When', new Date(open.occurredAt).toLocaleString('en-IN')], ['Who', who(open.actorId, open.actorType)], ['Result', open.outcome === 'success' ? 'Done' : 'Refused'], ['Record type', open.entityType ?? ''], ['Record', open.entityId ?? ''], ['Request', open.requestId ?? ''], ['IP address', open.ipAddress ?? '']] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="break-all text-right">{v}</dd></div>)}</dl>
          <pre className="mt-3 max-h-80 overflow-auto rounded border border-line bg-canvas p-3 text-xs">{JSON.stringify(open.details, null, 2)}</pre>
        </Drawer>) : null}
    </div>
  )
}

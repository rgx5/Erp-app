import type { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { ApprovalPolicy, ApprovalRequest } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useApprovalPolicies, useApprovalRequests, useApprove, useCancelRequest, useCreatePolicy, usePostApproved, useReject, useUpdatePolicy } from './queries'

export const TYPE_LABEL: Record<string, string> = { purchase_order: 'Purchase order', payment: 'Supplier payment', journal: 'Manual journal' }
const statusLabel = (r: ApprovalRequest): string => (r.expired ? 'Expired' : { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', consumed: 'Used' }[r.status] ?? r.status)

function RequestDrawer({ request, onClose }: { request: ApprovalRequest; onClose: () => void }) {
  const me = useSession((s) => s.me)
  const perms = me?.permissions ?? []
  const approve = useApprove()
  const reject = useReject()
  const cancel = useCancelRequest()
  const postApproved = usePostApproved()
  const flash = useFlash()
  const [comment, setComment] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const mine = me?.user?.id === request.requestedBy
  const act = async (fn: () => Promise<unknown>, done: string) => { setProblem(null); try { const r = await fn(); flash.show(typeof r === 'string' ? r : done); onClose() } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not do that.') } }
  const waiting = request.status === 'pending'
  const usable = request.status === 'approved' && !request.expired
  return (
    <Drawer title={`${request.requestNo} · ${TYPE_LABEL[request.documentType] ?? request.documentType}`} onClose={onClose} width={600}>
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-line p-3 text-sm">
          <p className="font-medium">{request.summary}</p>
          <p className="num mt-1 text-lg font-semibold">{formatInr(request.amount)}</p>
          <p className="mt-1 text-xs text-muted">Asked {formatDate(request.requestedAt)}{mine ? ' by you' : ''} · {request.approvalsCount} of {request.requiredApprovals} approval{request.requiredApprovals === 1 ? '' : 's'} · {statusLabel(request)}{request.validUntil && request.status === 'approved' ? ` · usable until ${formatDate(request.validUntil)}` : ''}</p>
        </div>
        {(request.decisions ?? []).length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">{request.decisions?.map((d) => <li key={d.id}><b>{d.decision === 'approve' ? 'Approved' : 'Rejected'}</b> {formatDate(d.decidedAt)}{d.comment ? <span className="text-muted"> · {d.comment}</span> : null}</li>)}</ul>
        ) : null}
        {request.status === 'consumed' ? (
          <Alert tone="info">Used{request.consumedRefType === 'purchase_order' && request.consumedRefId ? <> to create <Link to="/purchasing/orders/$orderId" params={{ orderId: request.consumedRefId }} className="underline">the purchase order</Link></> : ''}.</Alert>
        ) : null}
        {problem ? <Alert>{problem}</Alert> : null}
        {waiting && can(perms, 'approvals:decide') && !mine ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <TextField label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} hint="Required when rejecting." />
            <div className="flex gap-2">
              <Button busy={approve.isPending} onClick={() => void act(() => approve.mutateAsync({ id: request.id, ...(comment.trim() ? { comment: comment.trim() } : {}) }), `${request.requestNo} approved.`)}>Approve</Button>
              <Button variant="secondary" busy={reject.isPending} disabled={!comment.trim()} onClick={() => void act(() => reject.mutateAsync({ id: request.id, comment: comment.trim() }), `${request.requestNo} rejected.`)}>Reject</Button>
            </div>
          </div>
        ) : null}
        {waiting && mine ? <p className="text-sm text-muted">You asked for this, so someone else has to decide it.</p> : null}
        {usable && mine ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <p className="text-sm">Approved. Post it now, exactly as it was approved.</p>
            <Button className="self-start" busy={postApproved.isPending} onClick={() => void act(async () => (await postApproved.mutateAsync(request)).label, 'Posted.')}>Post now</Button>
          </div>
        ) : null}
        {(waiting || usable) && (mine || can(perms, 'approvals:manage')) ? <Button variant="ghost" className="self-start" busy={cancel.isPending} onClick={() => void act(() => cancel.mutateAsync({ id: request.id }), `${request.requestNo} withdrawn.`)}>Withdraw this request</Button> : null}
      </div>
    </Drawer>
  )
}

const policySchema = z.object({ documentType: z.string(), thresholdAmount: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount such as 50000'), requiredApprovals: z.string().regex(/^[1-5]$/, '1 to 5'), validDays: z.string().regex(/^\d{1,2}$/, '1 to 90') })

function Policies({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const list = useApprovalPolicies(companyId)
  const create = useCreatePolicy()
  const update = useUpdatePolicy()
  const [open, setOpen] = useState(false)
  const columns = useMemo<ColumnDef<ApprovalPolicy, unknown>[]>(() => [
    { header: 'For', accessorFn: (p) => TYPE_LABEL[p.documentType] ?? p.documentType, size: 180 }, { header: 'From amount', accessorFn: (p) => formatInr(p.thresholdAmount), size: 140, meta: { align: 'right' } },
    { header: 'Approvals needed', accessorKey: 'requiredApprovals', size: 130, meta: { align: 'right' } }, { header: 'Valid for (days)', accessorKey: 'validDays', size: 130, meta: { align: 'right' } }, { header: 'Status', accessorKey: 'status', size: 90 },
    ...(canManage ? [{ header: '', id: 'toggle', size: 110, cell: ({ row }: { row: { original: ApprovalPolicy } }) => <button type="button" className="text-xs text-brand underline" onClick={() => update.mutate({ id: row.original.id, version: row.original.version, body: { status: row.original.status === 'active' ? 'inactive' : 'active' } })}>{row.original.status === 'active' ? 'Switch off' : 'Switch on'}</button> } as ColumnDef<ApprovalPolicy, unknown>] : []),
  ], [canManage, update])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between"><p className="text-sm text-muted">A document at or above the amount needs that many approvals before it can be posted. The highest amount reached decides.</p>{canManage ? <Button onClick={() => setOpen(true)}>New rule</Button> : null}</div>
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(p) => p.id} empty="No approval rules: nothing needs approval." height={300} />}
      {open ? (
        <Drawer title="New approval rule" onClose={() => setOpen(false)}>
          <SimpleForm schema={policySchema} defaults={{ documentType: 'purchase_order', thresholdAmount: '', requiredApprovals: '1', validDays: '7' }} fields={['documentType', 'thresholdAmount', 'requiredApprovals', 'validDays']} label="Create rule"
            submit={async (v) => { await create.mutateAsync({ companyId, documentType: v.documentType as 'journal', thresholdAmount: v.thresholdAmount, requiredApprovals: Number(v.requiredApprovals), validDays: Number(v.validDays) }); setOpen(false) }}>
            {({ register, errors }) => (
              <>
                <SelectField label="Applies to" options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} {...register('documentType')} />
                <TextField label="From amount" inputMode="decimal" error={errors.thresholdAmount?.message as string | undefined} {...register('thresholdAmount')} hint="Purchase orders: value before tax. Payments: the amount. Journals: total debits." />
                <TextField label="Approvals needed" inputMode="numeric" error={errors.requiredApprovals?.message as string | undefined} {...register('requiredApprovals')} />
                <TextField label="An approval stays valid for (days)" inputMode="numeric" error={errors.validDays?.message as string | undefined} {...register('validDays')} />
              </>
            )}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}

export function ApprovalsPage() {
  const ws = useWorkspace()
  const me = useSession((s) => s.me)
  const perms = me?.permissions ?? []
  const [tab, setTab] = useState<'inbox' | 'mine' | 'rules'>(can(perms, 'approvals:decide') ? 'inbox' : 'mine')
  const [status, setStatus] = useState('pending')
  const list = useApprovalRequests({ companyId: ws.company?.id ?? '', ...(tab === 'inbox' ? (status ? { status } : {}) : {}), mine: tab === 'mine' })
  const [open, setOpen] = useState<ApprovalRequest | null>(null)
  const columns = useMemo<ColumnDef<ApprovalRequest, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'requestNo', size: 120 }, { header: 'For', accessorFn: (r) => TYPE_LABEL[r.documentType] ?? r.documentType, size: 150 }, { header: 'What', accessorKey: 'summary', size: 300 },
    { header: 'Amount', accessorFn: (r) => formatInr(r.amount), size: 130, meta: { align: 'right' } }, { header: 'Approvals', accessorFn: (r) => `${r.approvalsCount} of ${r.requiredApprovals}`, size: 100 },
    { header: 'Asked', accessorFn: (r) => formatDate(r.requestedAt), size: 100 }, { header: 'Status', accessorFn: (r) => statusLabel(r), size: 100 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const tabs = [...(can(perms, 'approvals:decide') ? [['inbox', 'To decide']] : []), ['mine', 'My requests'], ...(can(perms, 'approvals:read') ? [['rules', 'Rules']] : [])] as [typeof tab, string][]
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Approvals</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)} className={`px-3 py-2 text-sm ${tab === key ? 'border-b-2 border-brand font-medium' : 'text-muted'}`}>{label}</button>)}
      </div>
      {tab === 'rules' ? <Policies companyId={ws.company.id} canManage={can(perms, 'approvals:manage')} /> : (
        <>
          {tab === 'inbox' ? <Toolbar><div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'pending', label: 'Waiting for a decision' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'consumed', label: 'Used' }, { value: '', label: 'Everything' }]} /></div></Toolbar> : null}
          {list.error ? <Alert>{list.error.message}</Alert> : null}
          {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(r) => r.id} onOpen={setOpen} empty={tab === 'inbox' ? 'Nothing is waiting for you.' : 'You have not asked for anything.'} height={520} />}
        </>
      )}
      {open ? <RequestDrawer request={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

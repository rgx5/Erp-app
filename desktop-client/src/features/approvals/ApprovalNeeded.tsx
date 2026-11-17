import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import { formatInr } from '@/domain/format'
import { Alert, Button } from '@/ui/primitives'
import { useRequestApproval, type RequestInput } from './queries'

/**
 * Shown when the server answers `approval_required`: explains it, and sends exactly the document on the screen for approval. The
 * approved request is then posted from the Approvals screen (the server checks it is the same document, to the paisa).
 */
export function ApprovalNeeded({ error, request }: { error: unknown; request: RequestInput | null }) {
  const ask = useRequestApproval()
  const [sent, setSent] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const key = useMemo(() => crypto.randomUUID(), [JSON.stringify(request)]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!(error instanceof ApiError) || error.code !== 'approval_required') return null
  const amount = typeof error.extra['amount'] === 'string' ? formatInr(error.extra['amount']) : null
  const needs = typeof error.extra['requiredApprovals'] === 'number' ? error.extra['requiredApprovals'] : 1
  return (
    <Alert tone="info">
      <div className="flex flex-col gap-2">
        <p><b>This needs approval.</b> {amount ? `A document of ${amount} ` : 'This document '}needs {needs} approval{needs === 1 ? '' : 's'} before it can be posted.</p>
        {sent ? <p>Request <b>{sent}</b> was sent. Once it is approved, post it from <Link to="/approvals" className="underline">Approvals</Link>.</p> : (
          <div className="flex items-center gap-3">
            <Button busy={ask.isPending} disabled={!request} onClick={async () => { setProblem(null); try { setSent((await ask.mutateAsync({ body: request as RequestInput, key })).requestNo) } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not send the request.') } }}>Ask for approval</Button>
            <span className="text-xs text-muted">The document is sent exactly as it is on this screen.</span>
          </div>
        )}
        {problem ? <p className="text-bad">{problem}</p> : null}
      </div>
    </Alert>
  )
}

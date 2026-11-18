import { useState } from 'react'
import type { PosShift } from '@/api/schemas'
import { ApiError } from '@/api/errors'
import { formatInr } from '@/domain/format'
import { isValid } from '@/domain/money'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, TextField } from '@/ui/primitives'
import { useCloseShift, useShift } from './queries'

const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }

export function ShiftSummary({ shift }: { shift: PosShift }) {
  const s = shift.summary
  if (!s) return null
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm" aria-label="Shift summary">
      <div className="flex justify-between"><dt className="text-muted">Sales ({s.salesCount})</dt><dd className="num">{formatInr(s.salesTotal)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted">Returns ({s.returnsCount})</dt><dd className="num">{formatInr(s.returnsTotal)}</dd></div>
      {Object.entries(s.paymentsReceived).map(([m, v]) => <div key={m} className="flex justify-between"><dt className="text-muted">Taken by {METHOD[m] ?? m}</dt><dd className="num">{formatInr(v)}</dd></div>)}
      {Object.entries(s.refundsPaid).map(([m, v]) => <div key={m} className="flex justify-between"><dt className="text-muted">Refunded by {METHOD[m] ?? m}</dt><dd className="num">{formatInr(v)}</dd></div>)}
      <div className="flex justify-between"><dt className="text-muted">Cash at opening</dt><dd className="num">{formatInr(s.openingCash)}</dd></div>
      <div className="flex justify-between font-medium"><dt>Cash that should be there</dt><dd className="num">{formatInr(s.expectedCash)}</dd></div>
    </dl>
  )
}

/** Cash-up: count the drawer; the difference from what the shift's cash movements say is posted to cash over/short. */
export function CloseShiftDrawer({ shift, onClose }: { shift: PosShift; onClose: () => void }) {
  const live = useShift(shift.id)
  const close = useCloseShift(shift.id)
  const flash = useFlash()
  const [counted, setCounted] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<PosShift | null>(null)
  const s = live.data ?? shift
  return (
    <Drawer title={`Close ${shift.shiftNo}`} onClose={onClose} width={520}>
      <div className="flex flex-col gap-4">
        <ShiftSummary shift={s} />
        {done ? (
          <Alert tone="info"><span aria-label="Cash-up result">Closed. Expected {formatInr(done.expectedCash ?? '0')}, counted {formatInr(done.countedCash ?? '0')}, {Number(done.variance) === 0 ? 'no difference.' : `difference ${formatInr(done.variance ?? '0')} (posted to cash over/short).`}</span></Alert>
        ) : (
          <>
            <TextField label="Cash counted in the drawer" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} hint="Count the drawer and enter the total" />
            {problem ? <Alert>{problem}</Alert> : null}
            <Button busy={close.isPending} disabled={!isValid(counted) || counted === ''} onClick={async () => { setProblem(null); try { const r = await close.mutateAsync({ countedCash: counted }); setDone(r); flash.show(`${r.shiftNo} closed.`) } catch (e) { setProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not close the shift.') } }}>Close shift</Button>
          </>
        )}
        {done ? <Button variant="secondary" onClick={onClose}>Done</Button> : null}
      </div>
    </Drawer>
  )
}

import { useState } from 'react'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, SelectField, TextField } from '@/ui/primitives'

/** Losing a lead needs a reason, so the reports can say why sales are missed. */
export function LostDialog({ reasons, name, onConfirm, onClose }: { reasons: string[]; name: string; onConfirm: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const [pick, setPick] = useState(reasons[0] ?? 'Other'); const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null)
  const reason = pick === '__other' ? other.trim() : pick
  return (
    <Drawer title={`Mark ${name} as lost`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SelectField label="Why was it lost?" value={pick} onChange={(e) => setPick(e.target.value)} options={[...reasons.map((r) => ({ value: r, label: r })), { value: '__other', label: 'Something else…' }]} />
        {pick === '__other' ? <TextField label="Reason" value={other} onChange={(e) => setOther(e.target.value)} /> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={busy} disabled={!reason} onClick={async () => { setBusy(true); setProblem(null); try { await onConfirm(reason); onClose() } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }}>Mark as lost</Button>
      </div>
    </Drawer>
  )
}

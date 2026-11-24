import { Download } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { currentApi } from '@/auth/session'
import { todayIso } from '@/domain/format'
import { useSession } from '@/auth/session'
import { Alert, Button, Card } from '@/ui/primitives'
import { verifyBackupFile, type BackupCheck } from './exportVerify'

/** A copy of all the business's records in one file, kept by the owner: for peace of mind, an accountant, or moving to another system. */
export function ExportPage() {
  const business = useSession((x) => x.tenant)
  const [check, setCheck] = useState<BackupCheck | null>(null)
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null)
  async function run() {
    setBusy(true); setProblem(null); setDone(null)
    try {
      const api = currentApi()
      const data = await api.call(api.raw.GET('/v1/reports/export'), z.looseObject({ tables: z.record(z.string(), z.array(z.unknown())) }))
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `onesync-data-${todayIso()}.json`; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0)
      setDone(`Saved ${rows.toLocaleString('en-IN')} records from ${Object.keys(data.tables).length} lists.`)
    } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not export your data.') } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Data export</h1>
      <Card title="Download all your data">
        <div className="flex max-w-2xl flex-col gap-3 text-sm">
          <p>Saves every record in your business (items, customers, invoices, stock, accounts, payroll and so on) in one file you keep. Passwords, sign-in sessions and keys are never included.</p>
          <p className="text-muted">This is a copy for you to keep or hand to your accountant. It is not a backup you can restore from inside the app; backups of the server itself are taken by whoever runs it. Each export is written to the audit log.</p>
          {problem ? <Alert>{problem}</Alert> : null}
          {done ? <Alert tone="info">{done}</Alert> : null}
          <Button className="self-start" busy={busy} onClick={() => void run()}><Download className="size-4" aria-hidden /> Download my data</Button>
        </div>
      </Card>
      <Card title="Check a data file">
        <div className="flex max-w-2xl flex-col gap-3 text-sm">
          <p>Before you rely on a saved file, check it. This confirms it is whole and has not been changed since it was saved.</p>
          <input type="file" accept="application/json,.json" aria-label="Choose a data file to check" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setCheck(null); setCheck(await verifyBackupFile(await f.text(), business)) }} />
          {check ? <Alert tone={check.ok ? 'info' : 'error'}>
            <div className="flex flex-col gap-1"><b>{check.message}</b>
              {check.ok ? <>
                <span>Saved {check.exportedAt ? new Date(check.exportedAt).toLocaleString('en-IN') : ''} · {check.records?.toLocaleString('en-IN')} records in {check.tables} lists{check.business ? (check.business === 'this' ? ' · from this business' : ' · from a different business') : ''}.</span>
                {check.top?.length ? <span>{check.top.map((t) => `${t.name}: ${t.count.toLocaleString('en-IN')}`).join(' · ')}</span> : null}
              </> : null}</div></Alert> : null}
          <p className="text-xs text-muted">Putting a file back is done by whoever runs your server, into a new empty business. It brings back every record and keeps sign-in locked until a password is set.</p>
        </div>
      </Card>
    </div>
  )
}

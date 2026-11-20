import { Download } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { currentApi } from '@/auth/session'
import { todayIso } from '@/domain/format'
import { Alert, Button, Card } from '@/ui/primitives'

/** A copy of all the business's records in one file, kept by the owner: for peace of mind, an accountant, or moving to another system. */
export function ExportPage() {
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
    </div>
  )
}

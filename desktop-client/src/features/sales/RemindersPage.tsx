import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { useRetailSettings } from '@/features/retail/queries'
import { whatsappUrl } from '@/features/pos/share'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Spinner } from '@/ui/primitives'
import { useAgeing } from './queries'
import { useLatestReminders, useRecordReminder } from './reminderQueries'
import { DEFAULT_TEMPLATE, loadTemplate, oldestOverdue, overdueOf, reminderText, saveTemplate } from './reminderText'

const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'email', call: 'a call', copied: 'copied text' }

/** Who is overdue, what to say to them, and a one-click WhatsApp message to send from your own phone number. Each reminder is logged. */
export function RemindersPage() {
  const ws = useWorkspace(); const flash = useFlash()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'receivables:post')
  const ageing = useAgeing(ws.company?.id, todayIso())
  const latest = useLatestReminders(ws.company?.id)
  const retail = useRetailSettings(ws.company?.id)
  const record = useRecordReminder()
  const [template, setTemplate] = useState(loadTemplate)
  const [problem, setProblem] = useState<string | null>(null)
  const overdue = useMemo(() => (ageing.data?.customers ?? []).filter((c) => overdueOf(c) > 0).sort((a, b) => overdueOf(b) - overdueOf(a)), [ageing.data])
  const parties = usePartiesById(overdue.map((c) => c.customerId))
  if (ws.loading || ageing.isPending) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const company = ws.company
  const shop = company.tradeName || company.legalName
  const textFor = (c: (typeof overdue)[number]): string => reminderText(template, { name: parties.data?.get(c.customerId)?.tradeName || c.customerName, shop, amount: formatInr(String(overdueOf(c))), oldest: oldestOverdue(c), upiId: retail.data?.upiId ?? null })
  const log = async (c: (typeof overdue)[number], channel: 'whatsapp' | 'call' | 'copied', message: string) => {
    try { await record.mutateAsync({ body: { companyId: company.id, customerId: c.customerId, channel, amountDue: String(overdueOf(c).toFixed(2)), message } }) } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not record the reminder.') }
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Payment reminders</h1>
      <p className="text-sm text-muted">Customers with overdue invoices. Choose WhatsApp to open a ready-written message in your own WhatsApp; you press send. Every reminder is noted so nobody is chased twice in a day.</p>
      <details className="rounded-lg border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-medium">Message wording</summary>
        <div className="mt-2 flex flex-col gap-2">
          <textarea aria-label="Reminder message" className="min-h-24 w-full rounded border border-line bg-surface p-2 text-sm" value={template} onChange={(e) => { setTemplate(e.target.value); saveTemplate(e.target.value) }} />
          <p className="text-xs text-muted">You can use {'{name}'}, {'{shop}'}, {'{amount}'}, {'{oldest}'} and {'{upi}'}. <button type="button" className="underline" onClick={() => { setTemplate(DEFAULT_TEMPLATE); saveTemplate(DEFAULT_TEMPLATE) }}>Use the standard wording</button></p>
        </div>
      </details>
      {problem ? <Alert>{problem}</Alert> : null}
      <div className="overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" aria-label="Overdue customers">
          <thead className="bg-sunken text-left"><tr><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Overdue</th><th className="px-3 py-2">Oldest</th><th className="px-3 py-2">Last reminder</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{overdue.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nobody is overdue.</td></tr> : overdue.map((c) => {
            const phone = parties.data?.get(c.customerId)?.phone ?? ''
            const link = phone ? whatsappUrl(phone, textFor(c)) : null
            const last = latest.data?.get(c.customerId)
            return (
              <tr key={c.customerId} className="border-t border-line">
                <td className="px-3 py-2">{c.customerName}<div className="text-xs text-muted">{phone || 'No phone number'}</div></td>
                <td className="num px-3 py-2 text-right">{formatInr(String(overdueOf(c)))}</td>
                <td className="px-3 py-2">{oldestOverdue(c)}</td>
                <td className="px-3 py-2 text-xs text-muted">{last ? `${formatDate(last.sentAt.slice(0, 10))} by ${CHANNEL[last.channel] ?? last.channel}${last.sentBy ? `, ${last.sentBy}` : ''}` : 'Never'}</td>
                <td className="px-3 py-2"><div className="flex justify-end gap-1.5">
                  <Button variant="secondary" disabled={!link || !canPost} title={link ? undefined : 'Add a mobile number to this customer first'} onClick={() => { if (link) { window.open(link, '_blank', 'noopener'); void log(c, 'whatsapp', textFor(c)) } }}>WhatsApp</Button>
                  <Button variant="ghost" disabled={!canPost} onClick={async () => { try { await navigator.clipboard.writeText(textFor(c)); flash.show('Message copied.') } catch { /* clipboard not allowed: the reminder is still noted */ } void log(c, 'copied', textFor(c)) }}>Copy text</Button>
                  <Button variant="ghost" disabled={!canPost} onClick={() => void log(c, 'call', `Called ${c.customerName}`).then(() => flash.show('Noted.'))}>Called</Button>
                </div></td>
              </tr>)
          })}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Sending by SMS or email directly from the software needs a messaging provider and is not set up yet.</p>
    </div>
  )
}

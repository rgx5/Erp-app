import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { ask } from '@/ui/overlays'
import { useCan } from '@/data/store'
import { outstandingFor, advanceStandings } from '@/modules/hr/logic/advances'
import { balancesFor } from '@/modules/hr/logic/leave'
import { employeeMonth } from '@/modules/hr/logic/select'
import { hrSettings } from '@/modules/hr/logic/settings'
import { livePayslips } from '@/modules/hr/logic/slips'
import { labelYM, labelYMD, ymOf, ymdOf } from '@/modules/hr/logic/ymd'
import { deleteEmployeeDoc, exitEmployee, reactivateEmployee, saveEmployeeDoc, toggleOnboarding } from '@/modules/hr/ops'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import type { DocKind } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Avatar, Badge, Card, Chip, Group } from '@/ui/primitives'
import { KV, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, FilePlus, Pencil, Trash, WalletCards } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const KINDS: Array<{ value: DocKind; label: string }> = [
  { value: 'aadhaar', label: 'Aadhaar' }, { value: 'pan', label: 'PAN' }, { value: 'passport', label: 'Passport' }, { value: 'licence', label: 'Licence' },
  { value: 'offer', label: 'Offer letter' }, { value: 'contract', label: 'Contract' }, { value: 'certificate', label: 'Certificate' }, { value: 'other', label: 'Other' },
]

/** One person: profile, this month, leave, documents, joining checklist, and (for payroll) pay and payslips. */
export default function EmployeePage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('hr')
  const canPay = useCan('payroll')
  const { data, idx, now } = useHr()
  const e = data.employees?.[id]
  const [docOpen, setDocOpen] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [exitDate, setExitDate] = useState(ymdOf(now))
  const [kind, setKind] = useState<DocKind>('aadhaar')
  const [title, setTitle] = useState('')
  const [number, setNumber] = useState('')
  const [issued, setIssued] = useState('')
  const [expires, setExpires] = useState('')
  const month = ymOf(now)
  const m = useMemo(() => (e ? employeeMonth(data, idx, e, month, now) : null), [data, idx, e, month, now])
  const balances = useMemo(() => (e ? balancesFor(data, idx, e, ymdOf(now), hrSettings(data).leaveYearStartMonth) : []), [data, idx, e, now])
  const docs = Object.values(data.employeeDocs ?? {}).filter((d) => d.employeeId === id)
  const slips = useMemo(() => livePayslips(data).filter((p) => p.employeeId === id).slice(0, 6), [data, id])

  if (!can) return <Denied title="Employee" who="The staff list is for the owner and managers." />
  if (!e || !m) return <Denied title="Not found" who="This employee is no longer here." />
  const pay = data.employeePay?.[id]
  const owed = outstandingFor(advanceStandings(data), id)
  const userName = e.userId ? data.users[e.userId]?.name : undefined
  const today = ymdOf(now)

  function addDoc() {
    const r = act((s, ctx) => saveEmployeeDoc(s, { employeeId: id, kind, title: title || KINDS.find((k) => k.value === kind)!.label, number, issuedOn: issued || undefined, expiresOn: expires || undefined, note: '' }, undefined, ctx), 'Document saved')
    if (r) { setDocOpen(false); setTitle(''); setNumber(''); setIssued(''); setExpires('') }
  }

  return (
    <Screen title={e.name} subtitle={[e.code, e.designation].filter(Boolean).join(' · ')} back right={<Button label="Edit" size="sm" kind="soft" icon={<Pencil size={16} color={c.primary} />} onPress={() => router.push({ pathname: '/m/hr/employees/edit', params: { id } } as never)} />}>
      <View style={{ gap: 16, paddingBottom: 28 }}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={e.name} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Badge tone={e.active ? 'success' : 'default'}>{e.active ? 'On the staff' : `Left ${e.exitDate ? labelYMD(e.exitDate) : ''}`}</Badge>
              {userName ? <Badge tone="primary">Signs in as {userName}</Badge> : null}
            </View>
            <T v="caption" tone="mute">Joined {labelYMD(e.joinDate)}{e.department ? ` · ${e.department}` : ''}</T>
            {e.phone ? <T v="caption" tone="mute">{e.phone}</T> : null}
          </View>
        </Card>

        <Section title={`This month · ${labelYM(month)}`} style={{ marginTop: 0 }} action="Full month" onAction={() => router.push({ pathname: '/m/hr/attendance/month', params: { employeeId: id } } as never)}>
          <Card>
            <KV k="Days worked" v={String(m.summary.presentDays)} />
            <KV k="Paid leave" v={String(m.summary.paidLeaveDays)} />
            <KV k="Loss of pay days" v={String(m.summary.lopDays)} tone={m.summary.lopDays ? 'warning' : undefined} />
            <KV k="Late" v={String(m.summary.lateCount)} />
          </Card>
        </Section>

        {balances.length ? (
          <Section title="Leave left" style={{ marginTop: 0 }}>
            <Card>{balances.map((b) => <KV key={b.type.id} k={b.type.name} v={b.balance.unlimited ? `${b.balance.taken} taken` : `${b.balance.balance} days`} sub={b.balance.pending ? `${b.balance.pending} waiting for approval` : undefined} />)}</Card>
          </Section>
        ) : null}

        <Section title="Documents" action="Add" onAction={() => setDocOpen(true)} style={{ marginTop: 0 }}>
          {docs.length ? (
            <Group>
              {docs.map((d) => (
                <ListRow key={d.id} icon={<FilePlus size={18} color={c.primary} />} title={d.title || d.kind} subtitle={[d.number, d.expiresOn ? `${d.expiresOn < today ? 'Expired' : 'Expires'} ${labelYMD(d.expiresOn)}` : ''].filter(Boolean).join(' · ')}
                  badge={d.expiresOn && d.expiresOn < today ? <Badge tone="danger">Expired</Badge> : undefined}
                  right={<Trash size={18} color={c.inkMute} />} onPress={async () => { if (await ask({ title: 'Delete this document?', confirm: 'Delete', cancel: 'Keep' })) act((s, ctx) => deleteEmployeeDoc(s, d.id, ctx), 'Deleted') }} chevron={false} />
              ))}
            </Group>
          ) : <T tone="mute">No documents yet. Keep Aadhaar, PAN, the offer letter and licence numbers here, with expiry dates.</T>}
        </Section>

        {e.onboarding?.length ? (
          <Section title="Joining checklist" style={{ marginTop: 0 }}>
            <Group>
              {e.onboarding.map((o, i) => <ListRow key={o.label} dense icon={<Check size={18} color={o.done ? c.success : c.inkMute} />} iconTone={o.done ? 'success' : 'default'} title={o.label} onPress={() => act((s, ctx) => toggleOnboarding(s, id, i, ctx))} chevron={false} />)}
            </Group>
          </Section>
        ) : null}

        {canPay ? (
          <Section title="Pay" action={pay ? 'Change' : 'Set up'} onAction={() => router.push({ pathname: '/m/hr/employees/pay', params: { id } } as never)} style={{ marginTop: 0 }}>
            <Card>
              {pay ? (
                <>
                  <KV k={pay.payType === 'monthly' ? 'Basic per month' : pay.payType === 'daily' ? 'Per day' : 'Per hour'} v={inr(pay.basic, 0)} />
                  {pay.allowances.map((a) => <KV key={a.name} k={a.name} v={inr(a.amount, 0)} />)}
                  <KV k="PF · ESI · PT · TDS" v={[pay.pf && 'PF', pay.esi && 'ESI', pay.pt && 'PT', pay.tds && 'TDS'].filter(Boolean).join(' · ') || 'None'} />
                  <KV k="Paid to" v={pay.bank.account ? `A/c …${pay.bank.account.slice(-4)}` : pay.bank.upi || 'No bank details'} tone={pay.bank.account || pay.bank.upi ? undefined : 'warning'} />
                  {owed > 0 ? <KV k="Owes the business" v={inr(owed, 0)} tone="warning" /> : null}
                </>
              ) : <T tone="mute">No pay terms yet. Set them to include this person in payroll.</T>}
            </Card>
            {slips.length ? (
              <Group>
                {slips.map((p) => <ListRow key={p.id} icon={<WalletCards size={18} color={c.primary} />} title={labelYM(p.month)} subtitle={p.no} value={inr(p.net, 0)} onPress={() => router.push({ pathname: '/m/hr/payroll/[id]', params: { id: p.id } } as never)} />)}
              </Group>
            ) : null}
          </Section>
        ) : null}

        <View style={{ gap: 10 }}>
          {e.active ? <Button label="Mark as left" kind="outline" block onPress={() => setExitOpen(true)} /> : <Button label="Back on the staff" kind="outline" block onPress={() => act((s, ctx) => reactivateEmployee(s, id, ctx), 'Back on the staff')} />}
        </View>
      </View>

      <Sheet visible={docOpen} onClose={() => setDocOpen(false)} title="Add a document" footer={<View style={{ padding: 16 }}><Button label="Save document" size="lg" block onPress={addDoc} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{KINDS.map((k) => <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />)}</View>
          <Field label="Title (optional)" value={title} onChangeText={setTitle} />
          <Field label="Number" value={number} onChangeText={setNumber} autoCapitalize="characters" />
          <Field label="Issued on (optional)" value={issued} onChangeText={setIssued} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Field label="Expires on (optional)" value={expires} onChangeText={setExpires} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        </View>
      </Sheet>
      <Sheet visible={exitOpen} onClose={() => setExitOpen(false)} title="Last working day" subtitle="Their pay stops after this day. Settle any advance first."
        footer={<View style={{ padding: 16 }}><Button label="Mark as left" kind="danger" size="lg" block onPress={() => { if (act((s, ctx) => exitEmployee(s, id, exitDate, ctx), 'Marked as left')) setExitOpen(false) }} /></View>}>
        <Field label="Last day" value={exitDate} onChangeText={setExitDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      </Sheet>
    </Screen>
  )
}

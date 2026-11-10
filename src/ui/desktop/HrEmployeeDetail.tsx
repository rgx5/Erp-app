import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import type { DayInfo, MonthSummary } from '@/modules/hr/logic/attendance'
import type { LeaveBalance } from '@/modules/hr/logic/leave'
import { labelYM, labelYMD } from '@/modules/hr/logic/ymd'
import type { Employee, EmployeeDoc, EmployeePay, LeaveType, Payslip } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Check, FilePlus, Pencil, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { KV } from '@/ui/blocks'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

const KINDS: Array<{ value: EmployeeDoc['kind']; label: string }> = [
  { value: 'aadhaar', label: 'Aadhaar' }, { value: 'pan', label: 'PAN' }, { value: 'passport', label: 'Passport' }, { value: 'licence', label: 'Licence' },
  { value: 'offer', label: 'Offer letter' }, { value: 'contract', label: 'Contract' }, { value: 'certificate', label: 'Certificate' }, { value: 'other', label: 'Other' },
]

export interface DesktopEmployeeDetailProps {
  e: Employee
  m: { sheet: DayInfo[]; summary: MonthSummary }
  balances: Array<{ type: LeaveType; balance: LeaveBalance }>
  docs: EmployeeDoc[]
  slips: Payslip[]
  pay: EmployeePay | undefined
  owed: number
  userName: string | undefined
  month: string
  canPay: boolean
  today: string
  docOpen: boolean; setDocOpen: (v: boolean) => void
  kind: EmployeeDoc['kind']; setKind: (v: EmployeeDoc['kind']) => void
  title: string; setTitle: (v: string) => void
  number: string; setNumber: (v: string) => void
  issued: string; setIssued: (v: string) => void
  expires: string; setExpires: (v: string) => void
  onAddDoc: () => void
  onDeleteDoc: (id: string) => void
  exitOpen: boolean; setExitOpen: (v: boolean) => void
  exitDate: string; setExitDate: (v: string) => void
  onExit: () => void
  onReactivate: () => void
  onToggleOnboarding: (i: number) => void
  onEdit: () => void
  onOpenPay: () => void
  onOpenSlip: (id: string) => void
  onOpenFullMonth: () => void
}

type DocRow = EmployeeDoc & { id: string }

/**
 * The desktop employee screen: a toolbar with Edit and Mark-as-left visible, a KPI strip for this month, a dense
 * grid of documents, and a side panel for the profile, leave left, the joining checklist and pay — instead of the
 * phone's stack of cards. Every figure (`m`, `balances`, `docs`, `slips`, `pay`, `owed`) and every handler is passed
 * down from `src/app/m/hr/employees/[id].tsx` exactly as it computes and calls them; this file only lays the same
 * data out as a grid + side panel, matching `DesktopPurchaseDetail`.
 */
export function DesktopEmployeeDetail(p: DesktopEmployeeDetailProps) {
  const { c } = useTheme()
  const { e, m } = p

  const docColumns: Array<Column<DocRow>> = [
    { key: 'title', label: 'Document', sortValue: (r) => r.title || r.kind, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.title || KINDS.find((k) => k.value === r.kind)?.label || r.kind}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.number || '—'}</T>
      </View>
    ) },
    { key: 'expires', label: 'Expires', width: 150, sortValue: (r) => r.expiresOn ?? '', render: (r) => (
      r.expiresOn ? (r.expiresOn < p.today ? <Pill tone="danger" label={`Expired ${labelYMD(r.expiresOn)}`} /> : cellText(labelYMD(r.expiresOn))) : cellText('—')
    ) },
    { key: 'del', label: '', width: 50, render: (r) => (
      <Pressable onPress={() => p.onDeleteDoc(r.id)}><Trash size={16} color={c.inkMute} /></Pressable>
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={e.name}
          subtitle={[e.code, e.designation].filter(Boolean).join(' · ')}
          right={<DeskButton label="Edit" icon={<Pencil size={14} color={c.ink} />} onPress={p.onEdit} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Days worked" value={String(m.summary.presentDays)} delta={`${labelYM(p.month)}`} />
        <KpiTile label="Paid leave" value={String(m.summary.paidLeaveDays)} />
        <KpiTile label="Loss of pay" value={String(m.summary.lopDays)} tone={m.summary.lopDays ? 'warning' : 'default'} />
        <KpiTile label="Late" value={String(m.summary.lateCount)} />
        {p.canPay && p.pay ? <KpiTile label="Pay" value={inr(p.pay.basic, 0)} tone="primary" delta={p.pay.payType === 'monthly' ? 'per month' : p.pay.payType === 'daily' ? 'per day' : 'per hour'} onPress={p.onOpenPay} /> : null}
      </KpiStrip>

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 10 }}>
            <T style={[dtext.label, { color: c.inkMute }]}>Documents</T>
            <DeskButton label="Add" icon={<FilePlus size={14} color={c.ink} />} onPress={() => p.setDocOpen(true)} />
          </View>
          <DataTable rows={p.docs as DocRow[]} columns={docColumns} emptyLabel="No documents yet" />
          {p.slips.length ? (
            <>
              <View style={{ paddingHorizontal: 14, paddingTop: 14 }}><T style={[dtext.label, { color: c.inkMute }]}>Recent payslips</T></View>
              <DataTable
                rows={p.slips.map((s) => ({ id: s.id, label: labelYM(s.month), no: s.no, net: s.net }))}
                columns={[
                  { key: 'label', label: 'Month', render: (r) => cellText(r.label, true) },
                  { key: 'no', label: 'No.', render: (r) => cellText(r.no) },
                  { key: 'net', label: 'Net', width: 110, align: 'right', render: (r) => cellNum(inr(r.net, 0), true) },
                ]}
                onRowPress={(r) => p.onOpenSlip(r.id)}
              />
            </>
          ) : null}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pill tone={e.active ? 'success' : 'default'} label={e.active ? 'On the staff' : `Left ${e.exitDate ? labelYMD(e.exitDate) : ''}`} />
              {p.userName ? <Pill tone="primary" label={`Signs in as ${p.userName}`} /> : null}
            </View>
            <T style={[dtext.tiny, { color: c.inkMute }]}>Joined {labelYMD(e.joinDate)}{e.department ? ` · ${e.department}` : ''}</T>
            {e.phone ? <T style={[dtext.tiny, { color: c.inkMute }]}>{e.phone}</T> : null}
            <DeskButton label="Full month" onPress={p.onOpenFullMonth} />
          </View>

          {p.balances.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Leave left</T>
              {p.balances.map((b) => <KV key={b.type.id} k={b.type.name} v={b.balance.unlimited ? `${b.balance.taken} taken` : `${b.balance.balance} days`} sub={b.balance.pending ? `${b.balance.pending} waiting for approval` : undefined} />)}
            </View>
          ) : null}

          {e.onboarding?.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 8 }}>
              <T style={[dtext.label, { color: c.inkMute }]}>Joining checklist</T>
              {e.onboarding.map((o, i) => (
                <Pressable key={o.label} onPress={() => p.onToggleOnboarding(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Check size={16} color={o.done ? c.success : c.inkMute} />
                  <T style={dtext.cell}>{o.label}</T>
                </Pressable>
              ))}
            </View>
          ) : null}

          {p.canPay ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <T style={[dtext.label, { color: c.inkMute }]}>Pay</T>
                <DeskButton label={p.pay ? 'Change' : 'Set up'} onPress={p.onOpenPay} />
              </View>
              {p.pay ? (
                <>
                  <KV k={p.pay.payType === 'monthly' ? 'Basic per month' : p.pay.payType === 'daily' ? 'Per day' : 'Per hour'} v={inr(p.pay.basic, 0)} />
                  {p.pay.allowances.map((a) => <KV key={a.name} k={a.name} v={inr(a.amount, 0)} />)}
                  <KV k="PF · ESI · PT · TDS" v={[p.pay.pf && 'PF', p.pay.esi && 'ESI', p.pay.pt && 'PT', p.pay.tds && 'TDS'].filter(Boolean).join(' · ') || 'None'} />
                  <KV k="Paid to" v={p.pay.bank.account ? `A/c …${p.pay.bank.account.slice(-4)}` : p.pay.bank.upi || 'No bank details'} tone={p.pay.bank.account || p.pay.bank.upi ? undefined : 'warning'} />
                  {p.owed > 0 ? <KV k="Owes the business" v={inr(p.owed, 0)} tone="warning" /> : null}
                </>
              ) : <T tone="mute">No pay terms yet.</T>}
            </View>
          ) : null}

          {e.active ? <DeskButton label="Mark as left" onPress={() => p.setExitOpen(true)} /> : <DeskButton label="Back on the staff" tone="primary" onPress={p.onReactivate} />}
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.docOpen} onClose={() => p.setDocOpen(false)} title="Add a document" footer={<View style={{ padding: 16 }}><Button label="Save document" size="lg" block onPress={p.onAddDoc} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{KINDS.map((k) => <Chip key={k.value} label={k.label} selected={p.kind === k.value} onPress={() => p.setKind(k.value)} />)}</View>
          <Field label="Title (optional)" value={p.title} onChangeText={p.setTitle} />
          <Field label="Number" value={p.number} onChangeText={p.setNumber} autoCapitalize="characters" />
          <Field label="Issued on (optional)" value={p.issued} onChangeText={p.setIssued} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Field label="Expires on (optional)" value={p.expires} onChangeText={p.setExpires} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        </View>
      </Sheet>
      <Sheet visible={p.exitOpen} onClose={() => p.setExitOpen(false)} title="Last working day" subtitle="Their pay stops after this day. Settle any advance first."
        footer={<View style={{ padding: 16 }}><Button label="Mark as left" kind="danger" size="lg" block onPress={p.onExit} /></View>}>
        <Field label="Last day" value={p.exitDate} onChangeText={p.setExitDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      </Sheet>
    </DeskPage>
  )
}

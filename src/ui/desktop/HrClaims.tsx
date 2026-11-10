import React from 'react'
import { View } from 'react-native'
import { inr } from '@/domain/money'
import { labelYMD } from '@/modules/hr/logic/ymd'
import { CLAIM_LABEL, type ClaimRow } from '@/modules/hr/logic/claims'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, dtext, type Column } from './kit'

const MODE_OPTIONS: Array<{ value: 'cash' | 'bank' | 'upi'; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]
type Row = { id: string; name: string; meta: string; description: string; amount: number; approved: number; status: ClaimRow['status']; note?: string }

export interface DesktopClaimsProps {
  isHr: boolean
  canPay: boolean
  shown: ClaimRow[]
  employeeName: (id: string) => string
  toPay: number
  filter: 'open' | 'all'; setFilter: (v: 'open' | 'all') => void
  deciding: ClaimRow | null; setDeciding: (v: ClaimRow | null) => void
  amount: string; setAmount: (v: string) => void
  note: string; setNote: (v: string) => void
  paying: ClaimRow | null; setPaying: (v: ClaimRow | null) => void
  mode: 'cash' | 'bank' | 'upi'; setMode: (v: 'cash' | 'bank' | 'upi') => void
  onNew: () => void
  onOpenReview: (r: ClaimRow) => void
  onReject: () => void
  onApprove: () => void
  onOpenPay: (r: ClaimRow) => void
  onConfirmPay: () => void
  onCancel: (id: string) => void
}

/** The desktop expense-claims screen: a KPI for what's owed back, Open/All toggle, and a dense grid — review and
 * pay-back happen in the same `Sheet`s the phone screen uses. */
export function DesktopClaims(p: DesktopClaimsProps) {
  const { c } = useTheme()

  const rows: Row[] = p.shown.map((r) => ({
    id: r.claim.id, name: p.employeeName(r.claim.employeeId), meta: `${r.claim.no} · ${r.claim.category} · ${labelYMD(r.claim.date)}${r.claim.ref ? ` · ${r.claim.ref}` : ''}`,
    description: r.claim.description, amount: r.claim.amount, approved: r.approved, status: r.status, note: r.decision?.note,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Employee', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.meta}</T>
      </View>
    ) },
    { key: 'description', label: 'What for', render: (r) => <T style={dtext.cell} numberOfLines={2}>{r.description}</T> },
    { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => <Pill tone={r.status === 'paid' ? 'success' : r.status === 'approved' ? 'primary' : r.status === 'pending' ? 'warning' : 'default'} label={CLAIM_LABEL[r.status]} /> },
    { key: 'amount', label: 'Amount', width: 110, align: 'right', sortValue: (r) => r.amount, render: (r) => cellNum(inr(r.amount, 0), true) },
    { key: 'actions', label: '', width: 220, render: (r) => {
      const raw = p.shown.find((x) => x.claim.id === r.id)!
      return (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {p.isHr && r.status === 'pending' ? <DeskButton label="Review" tone="primary" onPress={() => p.onOpenReview(raw)} /> : null}
          {p.canPay && r.status === 'approved' ? <DeskButton label={`Pay back ${inr(r.approved, 0)}`} tone="primary" onPress={() => p.onOpenPay(raw)} /> : null}
          {p.isHr && (r.status === 'pending' || r.status === 'approved') ? <DeskButton label="Cancel" onPress={() => p.onCancel(r.id)} /> : null}
        </View>
      )
    } },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Expense claims"
          right={<DeskButton label="Claim" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onNew} />}
        />
      }
    >
      {p.isHr ? (
        <KpiStrip>
          <KpiTile label="To pay back" value={inr(p.toPay, 0)} tone="warning" />
        </KpiStrip>
      ) : null}

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented<'open' | 'all'> value={p.filter} onChange={p.setFilter} options={[{ id: 'open', label: 'Open' }, { id: 'all', label: 'All' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No claims" />
      </View>

      <Sheet visible={!!p.deciding} onClose={() => p.setDeciding(null)} title="Review claim" subtitle={p.deciding ? `${p.deciding.claim.no} · ${inr(p.deciding.claim.amount, 0)}` : undefined}
        footer={(
          <View style={{ padding: 16, flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Reject" kind="outline" block onPress={p.onReject} /></View>
            <View style={{ flex: 1 }}><Button label="Approve" block onPress={p.onApprove} /></View>
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <MoneyField label="Amount to approve" value={p.amount} onChange={p.setAmount} hint="Approve less than claimed if part of it is not allowed" />
          <Field label="Note (needed to reject)" value={p.note} onChangeText={p.setNote} />
        </View>
      </Sheet>
      <Sheet visible={!!p.paying} onClose={() => p.setPaying(null)} title="Pay back" subtitle={p.paying ? inr(p.paying.approved, 0) : undefined}
        footer={<View style={{ padding: 16 }}><Button label="Mark as paid" size="lg" block onPress={p.onConfirmPay} /></View>}>
        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 12 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}</View>
      </Sheet>
    </DeskPage>
  )
}

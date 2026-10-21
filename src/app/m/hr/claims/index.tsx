import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { CLAIM_LABEL, claimRows, claimsToPay, type ClaimRow } from '@/modules/hr/logic/claims'
import { labelYMD } from '@/modules/hr/logic/ymd'
import { cancelClaim, decideClaim, reimburseClaim } from '@/modules/hr/payrollOps'
import { act, Denied, MODE_OPTIONS, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Receipt } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Expense claims: staff submit, a manager approves (for all or part), and the business pays it back. */
export default function Claims() {
  const { c } = useTheme()
  const router = useRouter()
  const isHr = useCan('hr')
  const canPay = useCan('payroll')
  const isSelf = useCan('hrSelf')
  const { data, me } = useHr()
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [deciding, setDeciding] = useState<ClaimRow | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [paying, setPaying] = useState<ClaimRow | null>(null)
  const [mode, setMode] = useState<'cash' | 'bank' | 'upi'>('cash')
  const all = useMemo(() => claimRows(data).filter((r) => isHr || r.claim.employeeId === me?.id), [data, isHr, me?.id])
  const shown = all.filter((r) => filter === 'all' || r.status === 'pending' || r.status === 'approved')

  if (!isHr && !isSelf) return <Denied title="Expense claims" who="Claims are for staff and managers." />
  const tone = (s: ClaimRow['status']) => (s === 'paid' ? 'success' : s === 'approved' ? 'primary' : s === 'pending' ? 'warning' : 'default') as 'success' | 'primary' | 'warning' | 'default'

  return (
    <Screen title="Expense claims" back right={<Button label="Claim" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => router.push('/m/hr/claims/new')} />}>
      <View style={{ gap: 12, paddingBottom: 28 }}>
        {isHr ? <View style={{ flexDirection: 'row' }}><StatTile label="To pay back" value={inr(claimsToPay(all), 0)} icon={<Receipt size={18} color={c.warning} />} tone="warning" /></View> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}><Chip label="Open" selected={filter === 'open'} onPress={() => setFilter('open')} /><Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} /></View>
        {shown.length ? shown.map((r) => (
          <Card key={r.claim.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{data.employees?.[r.claim.employeeId]?.name ?? 'Former staff'}</T>
              <T v="num">{inr(r.claim.amount, 0)}</T>
            </View>
            <T v="caption" tone="mute">{r.claim.no} · {r.claim.category} · {labelYMD(r.claim.date)}{r.claim.ref ? ` · ${r.claim.ref}` : ''}</T>
            <T>{r.claim.description}</T>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Badge tone={tone(r.status)}>{CLAIM_LABEL[r.status]}</Badge>
              {r.approved && r.approved !== r.claim.amount ? <T v="caption" tone="mute">approved {inr(r.approved, 0)}</T> : null}
            </View>
            {r.decision?.note ? <T v="caption" tone="mute">“{r.decision.note}”</T> : null}
            {isHr && r.status === 'pending' ? <Button label="Review" block onPress={() => { setDeciding(r); setAmount(String(r.claim.amount)); setNote('') }} /> : null}
            {canPay && r.status === 'approved' ? <Button label={`Pay back ${inr(r.approved, 0)}`} block onPress={() => setPaying(r)} /> : null}
            {isHr && (r.status === 'pending' || r.status === 'approved') ? <Button label="Cancel claim" kind="ghost" size="sm" onPress={() => act((s, ctx) => cancelClaim(s, r.claim.id, ctx), 'Cancelled')} /> : null}
          </Card>
        )) : <EmptyState icon={<Receipt size={26} color={c.primary} />} title="No claims" hint="Staff claim money they spent for the business (travel, food, repairs). You approve it, then pay it back." action="Make a claim" onAction={() => router.push('/m/hr/claims/new')} />}
      </View>

      <Sheet visible={!!deciding} onClose={() => setDeciding(null)} title="Review claim" subtitle={deciding ? `${deciding.claim.no} · ${inr(deciding.claim.amount, 0)}` : undefined}
        footer={(
          <View style={{ padding: 16, flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Reject" kind="outline" block onPress={() => { if (deciding && act((s, ctx) => decideClaim(s, deciding.claim.id, 'rejected', undefined, note, ctx), 'Rejected')) setDeciding(null) }} /></View>
            <View style={{ flex: 1 }}><Button label="Approve" block onPress={() => { if (deciding && act((s, ctx) => decideClaim(s, deciding.claim.id, 'approved', Number(amount), note, ctx), 'Approved')) setDeciding(null) }} /></View>
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <MoneyField label="Amount to approve" value={amount} onChange={setAmount} hint="Approve less than claimed if part of it is not allowed" />
          <Field label="Note (needed to reject)" value={note} onChangeText={setNote} />
        </View>
      </Sheet>
      <Sheet visible={!!paying} onClose={() => setPaying(null)} title="Pay back" subtitle={paying ? inr(paying.approved, 0) : undefined}
        footer={<View style={{ padding: 16 }}><Button label="Mark as paid" size="lg" block onPress={() => { if (paying && act((s, ctx) => reimburseClaim(s, paying.claim.id, { mode }, ctx), 'Paid back')) setPaying(null) }} /></View>}>
        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 12 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}</View>
      </Sheet>
    </Screen>
  )
}

import React, { useMemo } from 'react'
import { useRouter } from 'expo-router'
import type { Bill, Customer } from '@/domain/types'
import { onAccountOf } from '@/domain/checkout'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp } from '@/data/store'
import { Section, ListRow } from '@/ui/blocks'
import { Badge, Card } from '@/ui/primitives'
import { HandCoins } from '@/ui/icons'
import { creditStatus, receivables } from '../logic'

/** On a customer's page: what they owe, and a way into their account (collect, statement, reminder). */
export function CustomerCreditPanel({ customer }: { customer: Customer }) {
  const router = useRouter()
  const data = useApp((s) => s.data)
  const st = useMemo(() => creditStatus(data, customer.id, Date.now()), [data, customer.id])
  const hasTerms = !!data.customerTerms?.[customer.id]
  if (!st.owed && !hasTerms) return null
  return (
    <Section title="Credit account" style={{ marginTop: 6 }}>
      <Card padded={false}>
        <ListRow icon={<HandCoins size={20} color="#fff" />} title={st.owed > 0 ? `Owes ${inr(st.owed, 0)}` : st.owed < 0 ? `${inr(-st.owed, 0)} in advance` : 'Nothing owed'}
          subtitle={st.blocked ? 'Not allowed to buy on account' : st.limit > 0 ? `Limit ${inr(st.limit, 0)} · ${st.creditDays} days to pay` : `${st.creditDays} days to pay`}
          badge={st.overdue > 0 ? <Badge tone="danger">{inr(st.overdue, 0)} overdue</Badge> : undefined}
          onPress={() => router.push({ pathname: '/m/credit/customer/[id]', params: { id: customer.id } })} />
      </Card>
    </Section>
  )
}

/** On a bill: how much of it went on account, what is still owed and by when. */
export function BillCreditPanel({ bill }: { bill: Bill }) {
  const router = useRouter()
  const data = useApp((s) => s.data)
  const due = onAccountOf(bill.payments)
  const row = useMemo(() => (due > 0 && bill.customerId ? receivables(data).byCustomer[bill.customerId]?.bills.find((b) => b.billId === bill.id) : undefined), [data, bill.id, bill.customerId, due])
  if (!(due > 0) || !bill.customerId || !row) return null
  return (
    <Section title="On account" style={{ marginTop: 6 }}>
      <Card padded={false}>
        <ListRow icon={<HandCoins size={20} color="#fff" />} title={row.outstanding > 0 ? `${inr(row.outstanding, 0)} still owed` : 'Settled'} subtitle={`${inr(due, 0)} put on account · due ${fmtDayShort(row.dueDate)}`}
          badge={row.outstanding > 0 && row.dueDate < Date.now() ? <Badge tone="danger">Overdue</Badge> : undefined}
          onPress={() => router.push({ pathname: '/m/credit/customer/[id]', params: { id: bill.customerId! } })} />
      </Card>
    </Section>
  )
}

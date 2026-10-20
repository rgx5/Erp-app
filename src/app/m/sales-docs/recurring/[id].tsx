import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { linkOf } from '@/modules/sales-docs/billhook'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { FREQUENCY_LABEL, PERIODS_PER_YEAR, periodsDue, scheduleAhead } from '@/modules/sales-docs/logic/subscriptions'
import { deleteSubscription, generateInvoices, setSubscriptionActive } from '@/modules/sales-docs/ops'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pause, Pencil, Play, Receipt, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One recurring plan or AMC: what it bills, the dates ahead, and the invoices it has made. */
export default function PlanPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('salesDocs')
  const store = useStore()
  const sub = useList('subscriptions').find((x) => x.id === id)
  const customers = useList('customers')
  const bills = useList('bills')

  if (!can) return <Screen title="Plan" back><T tone="mute">Recurring billing is for the owner and managers.</T></Screen>
  if (!sub) return <Screen title="Not found" back><T tone="mute">This plan is no longer here.</T></Screen>
  const now = Date.now()
  const customer = customers.find((x) => x.id === sub.customerId)
  const each = docTotal(sub.items, 'amt', 0, store)
  const due = periodsDue(sub, now)
  const made = bills.filter((b) => linkOf(b).subscriptionId === sub.id).sort((a, b) => b.date - a.date)

  function generate() {
    try {
      const r = perform((s, ctx) => generateInvoices(s, sub!.id, undefined, ctx))
      toast(`${r.bills.length} invoice${r.bills.length === 1 ? '' : 's'} made`, 'ok')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not make the invoices', 'err') }
  }
  function toggle() {
    try { perform((s, ctx) => setSubscriptionActive(s, sub!.id, !sub!.active, ctx)); toast(sub!.active ? 'Paused' : 'Resumed', 'ok') }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not change the plan', 'err') }
  }
  async function remove() {
    if (!(await ask({ title: `Delete ${sub!.no}?`, confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteSubscription(s, sub!.id, ctx)); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }

  return (
    <Screen title={sub.no} subtitle={customer?.name ?? 'Customer'} back
      footer={due.length ? <Button label={`Make ${due.length} invoice${due.length === 1 ? '' : 's'} · ${inr(each * due.length, 0)}`} size="lg" block icon={<Receipt size={18} color={c.onPrimary} />} onPress={generate} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Badge tone={sub.kind === 'amc' ? 'accent' : 'primary'}>{sub.kind === 'amc' ? 'AMC' : 'Subscription'}</Badge>
          <Badge tone={sub.active ? 'success' : 'default'}>{sub.active ? 'Active' : 'Paused or ended'}</Badge>
        </View>
        {due.length ? <Notice tone="warning" title={`${due.length} invoice${due.length === 1 ? ' is' : 's are'} due`} body="Stock is taken out and the customer is billed like any other sale." /> : null}
        <Card>
          <KV k="Each invoice" v={inr(each)} strong />
          <KV k="Repeats" v={FREQUENCY_LABEL[sub.frequency]} />
          <KV k="Worth per year" v={inr(each * PERIODS_PER_YEAR[sub.frequency], 0)} />
          <KV k="Next invoice" v={fmtDate(sub.nextDate)} />
          {sub.endDate ? <KV k="Ends" v={fmtDate(sub.endDate)} /> : null}
          <KV k="Settled" v={sub.payMode === 'due' ? 'On account' : sub.payMode.toUpperCase()} />
          <KV k="Invoices made" v={String(sub.billCount)} />
        </Card>
        {sub.coverage ? <Card><T v="label" tone="soft">COVERED</T><T>{sub.coverage}</T></Card> : null}

        <Section title="Each invoice" style={{ marginTop: 6 }}>
          <Card padded={false}>
            {sub.items.map((l, i) => (
              <View key={l.variantId} style={{ padding: 14, flexDirection: 'row', gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{l.name} × {l.qty}</T>
                <T v="num">{inr(l.price * l.qty, 0)}</T>
              </View>
            ))}
          </Card>
        </Section>

        {sub.active ? (
          <Section title="Coming up" style={{ marginTop: 6 }}>
            <Card>{scheduleAhead(sub, 6).map((d, i) => <KV key={i} k={fmtDate(d)} v={d <= now ? 'Due' : ''} tone="warning" />)}</Card>
          </Section>
        ) : null}

        {made.length ? (
          <Section title="Invoices made" style={{ marginTop: 6 }}>
            <Card padded={false}>
              {made.slice(0, 12).map((b, i) => (
                <View key={b.id} style={{ padding: 14, flexDirection: 'row', gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <T v="bodyStrong" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/bills/[id]', params: { id: b.id } })}>{b.no}</T>
                  <T v="caption" tone="mute">{fmtDate(b.date)}</T>
                  <T v="num">{inr(b.total, 0)}</T>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        <View style={{ gap: 10, marginTop: 4 }}>
          <Button label="Edit plan" kind="outline" block icon={<Pencil size={18} color={c.ink} />} onPress={() => router.push({ pathname: '/m/sales-docs/recurring/new', params: { id: sub.id } })} />
          <Button label={sub.active ? 'Pause' : 'Resume'} kind="outline" block icon={sub.active ? <Pause size={18} color={c.ink} /> : <Play size={18} color={c.ink} />} onPress={toggle} />
          {sub.billCount === 0 ? <Button label="Delete plan" kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={remove} /> : null}
        </View>
      </View>
    </Screen>
  )
}

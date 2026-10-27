import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError, type OpCtx } from '@/data/ops'
import type { Changes, DataState } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { JOB_KIND_LABEL, JOB_LABEL, materialOutstanding } from '@/modules/manufacturing/jobs'
import { cancelJob, deliverJob, linkJobToRecipe, receiveCustomerMaterial, setJobStage, settleCustomerMaterial } from '@/modules/manufacturing/ops'
import { Button } from '@/ui/Button'
import { Field, NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Tap } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One customer job: stages, the customer's material, the work order behind it, and handing it over. */
export default function JobScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pos')
  const canFloor = useCan('inventory')
  const data = useApp((s) => s.data)
  const recipes = useList('recipes').filter((r) => r.active)
  const j = data.jobOrders[id]
  const [matSheet, setMatSheet] = useState(false)
  const [desc, setDesc] = useState('')
  const [unit, setUnit] = useState('m')
  const [qty, setQty] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [settle, setSettle] = useState<{ id: string; kind: 'use' | 'return'; qty: string } | null>(null)

  if (!can) return <Screen title="Job" back><T tone="mute">Customer jobs are taken at the counter.</T></Screen>
  if (!j) return <Screen title="Job" back><T tone="mute">This job is not here any more.</T></Screen>
  const wo = j.workOrderId ? data.workOrders[j.workOrderId] : undefined
  const finished = j.status === 'delivered' || j.status === 'cancelled'

  const run = (fn: (s: DataState, ctx: OpCtx) => { changes: Changes }, ok: string, after?: () => void) => {
    try { perform(fn); toast(ok, 'ok'); after?.() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not do that', 'err') }
  }

  return (
    <Screen title={j.no} subtitle={JOB_KIND_LABEL[j.kind]} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <T v="h2" style={{ flex: 1 }}>{j.title}</T>
            <Badge tone={j.status === 'ready' ? 'success' : j.status === 'cancelled' ? 'danger' : 'primary'}>{JOB_LABEL[j.status]}</Badge>
          </View>
          <T v="caption" tone="mute">{data.customers[j.customerId]?.name ?? 'Customer'} · {j.qty} to make{j.dueDate ? ` · due ${fmtDayShort(j.dueDate)}` : ''}{j.charge ? ` · ${inr(j.charge)}` : ''}</T>
          {j.salesOrderId ? <T v="caption" tone="mute">Sales order {j.salesOrderId}</T> : null}
        </Card>

        {j.measurements.length ? <Section title="Measurements"><Card style={{ gap: 4 }}>{j.measurements.map((m, i) => <KV key={i} k={m.label} v={m.value} />)}</Card></Section> : null}

        {j.stages.length ? (
          <Section title="Stages">
            {j.stages.map((s, i) => (
              <Tap key={i} disabled={finished} onPress={() => run((st, ctx) => setJobStage(st, j.id, i, !s.doneAt, ctx), s.doneAt ? 'Reopened' : 'Stage done')}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: s.doneAt ? c.success : c.line }}>{s.doneAt ? <Check size={14} color="#fff" /> : null}</View>
                  <T v="bodyStrong" style={{ flex: 1 }}>{s.name}</T>
                  {s.doneAt ? <T v="caption" tone="mute">{fmtDayShort(s.doneAt)}</T> : null}
                </Card>
              </Tap>
            ))}
          </Section>
        ) : null}

        <Section title="Work order">
          {wo ? (
            <Tap onPress={() => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: wo.id } } as never)}><Card><T v="bodyStrong">{wo.no} · {wo.status.replace('_', ' ')}</T><T v="caption" tone="mute">Open it to issue material and receive the work</T></Card></Tap>
          ) : canFloor && !finished && recipes.length ? (
            <View style={{ gap: 10 }}>
              <Select<string> label="Make it from a recipe" value={recipeId} placeholder="Choose a recipe" options={recipes.map((r) => ({ value: r.id, label: r.name, sub: r.code }))} onChange={setRecipeId} />
              <Button label="Create the work order" kind="soft" block onPress={() => run((s, ctx) => linkJobToRecipe(s, j.id, recipeId, ctx), 'Work order created')} />
            </View>
          ) : <T tone="mute">No work order. The stages above track the job.</T>}
        </Section>

        {j.kind === 'job_work' || j.materials.length ? (
          <Section title="Customer’s material" action={finished ? undefined : 'Received'} onAction={() => setMatSheet(true)}>
            {j.materials.map((m) => (
              <Card key={m.id} style={{ gap: 6 }}>
                <KV k={m.description} v={`${materialOutstanding(m)} ${m.unit} with us`} sub={`Received ${m.received} · used ${m.used} · returned ${m.returned}`} />
                {!finished && materialOutstanding(m) > 0 ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button label="Used" kind="soft" onPress={() => setSettle({ id: m.id, kind: 'use', qty: String(materialOutstanding(m)) })} />
                    <Button label="Give back" kind="soft" onPress={() => setSettle({ id: m.id, kind: 'return', qty: String(materialOutstanding(m)) })} />
                  </View>
                ) : null}
              </Card>
            ))}
            {!j.materials.length ? <T tone="mute">Nothing received yet.</T> : null}
          </Section>
        ) : null}

        {j.status === 'ready' ? <Button label="Hand over to the customer" size="lg" block onPress={() => run((s, ctx) => deliverJob(s, j.id, {}, ctx), 'Delivered')} /> : null}
        {!finished ? <Button label="Cancel job" kind="danger" block onPress={async () => { if (await ask({ title: 'Cancel this job?', confirm: 'Cancel job', cancel: 'Keep' })) run((s, ctx) => cancelJob(s, j.id, ctx), 'Cancelled') }} /> : null}
      </View>

      <Sheet visible={matSheet} onClose={() => setMatSheet(false)} title="Material received" footer={<Button label="Save" size="lg" block onPress={() => run((s, ctx) => receiveCustomerMaterial(s, j.id, { description: desc, unit, qty: Number(qty) || 0 }, ctx), 'Recorded', () => { setMatSheet(false); setDesc(''); setQty('') })} />}>
        <View style={{ gap: 12 }}>
          <Field label="What" value={desc} onChangeText={setDesc} placeholder="e.g. Cotton cloth" />
          <Field label="Unit" value={unit} onChangeText={setUnit} />
          <NumberField label="How much" value={qty} onChange={setQty} decimals />
        </View>
      </Sheet>
      <Sheet visible={!!settle} onClose={() => setSettle(null)} title={settle?.kind === 'use' ? 'Material used up' : 'Give material back'}
        footer={<Button label="Save" size="lg" block onPress={() => settle && run((s, ctx) => settleCustomerMaterial(s, j.id, settle.id, settle.kind, Number(settle.qty) || 0, ctx), 'Recorded', () => setSettle(null))} />}>
        {settle ? <NumberField label="How much" value={settle.qty} onChange={(t) => setSettle({ ...settle, qty: t })} decimals /> : null}
      </Sheet>
    </Screen>
  )
}

import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { JOB_KIND_LABEL, JOB_LABEL, materialOutstanding } from '@/modules/manufacturing/jobs'
import type { DataState } from '@/data/state'
import type { JobOrder, Recipe, WorkOrder } from '@/modules/manufacturing/types'
import { Field, NumberField, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Pill, Toolbar, dtext } from './kit'

type Settle = { id: string; kind: 'use' | 'return'; qty: string } | null

export interface DesktopJobDetailProps {
  j: JobOrder
  data: DataState
  wo: WorkOrder | undefined
  canFloor: boolean
  recipes: Recipe[]
  recipeId: string
  setRecipeId: (v: string) => void
  finished: boolean
  matSheet: boolean
  setMatSheet: (v: boolean) => void
  desc: string
  setDesc: (v: string) => void
  unit: string
  setUnit: (v: string) => void
  qty: string
  setQty: (v: string) => void
  settle: Settle
  setSettle: (v: Settle) => void
  onToggleStage: (i: number, done: boolean) => void
  onLinkRecipe: () => void
  onOpenWorkOrder: () => void
  onSaveMaterial: () => void
  onSettle: () => void
  onDeliver: () => void
  onCancel: () => void
}

/**
 * The desktop job screen: a status side panel of stages, measurements, the work order link and the customer's
 * material, under a toolbar with "Hand over" as the primary action. Every handler comes from
 * `src/app/m/manufacturing/jobs/[id].tsx` unchanged.
 */
export function DesktopJobDetail(p: DesktopJobDetailProps) {
  const { c } = useTheme()
  const { j, data, wo, finished } = p

  return (
    <DeskPage
      toolbar={<Toolbar title={j.no} subtitle={JOB_KIND_LABEL[j.kind]} right={j.status === 'ready' ? <DeskButton label="Hand over to the customer" tone="primary" onPress={p.onDeliver} /> : undefined} />}
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T style={[dtext.title, { flex: 1 }]} numberOfLines={2}>{j.title}</T>
              <Pill tone={j.status === 'ready' ? 'success' : j.status === 'cancelled' ? 'danger' : 'primary'} label={JOB_LABEL[j.status]} />
            </View>
            <T style={[dtext.tiny, { color: c.inkMute }]}>{data.customers[j.customerId]?.name ?? 'Customer'} · {j.qty} to make{j.dueDate ? ` · due ${fmtDayShort(j.dueDate)}` : ''}{j.charge ? ` · ${inr(j.charge)}` : ''}</T>
            {j.salesOrderId ? <T style={[dtext.tiny, { color: c.inkMute }]}>Sales order {j.salesOrderId}</T> : null}
          </View>

          {j.measurements.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Measurements</T>
              {j.measurements.map((m, i) => <KV key={i} k={m.label} v={m.value} />)}
            </View>
          ) : null}

          {j.stages.length ? (
            <View style={{ gap: 8 }}>
              <T style={dtext.label}>Stages</T>
              {j.stages.map((s, i) => (
                <Pressable key={i} disabled={finished} onPress={() => p.onToggleStage(i, !s.doneAt)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: s.doneAt ? c.success : c.line }}>{s.doneAt ? <Check size={13} color="#fff" /> : null}</View>
                  <T style={[dtext.cellStrong, { flex: 1 }]}>{s.name}</T>
                  {s.doneAt ? <T style={[dtext.tiny, { color: c.inkMute }]}>{fmtDayShort(s.doneAt)}</T> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 10 }}>
            <T style={dtext.label}>Work order</T>
            {wo ? (
              <Pressable onPress={p.onOpenWorkOrder}>
                <T style={dtext.cellStrong}>{wo.no} · {wo.status.replace('_', ' ')}</T>
                <T style={[dtext.tiny, { color: c.inkMute }]}>Open it to issue material and receive the work</T>
              </Pressable>
            ) : p.canFloor && !finished && p.recipes.length ? (
              <View style={{ gap: 10 }}>
                <Select<string> label="Make it from a recipe" value={p.recipeId} placeholder="Choose a recipe" options={p.recipes.map((r) => ({ value: r.id, label: r.name, sub: r.code }))} onChange={p.setRecipeId} />
                <DeskButton label="Create the work order" onPress={p.onLinkRecipe} />
              </View>
            ) : <T style={[dtext.cell, { color: c.inkMute }]}>No work order. The stages above track the job.</T>}
          </View>

          {j.kind === 'job_work' || j.materials.length ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <T style={[dtext.label, { flex: 1 }]}>Customer’s material</T>
                {!finished ? <DeskButton label="Received" onPress={() => p.setMatSheet(true)} /> : null}
              </View>
              {j.materials.map((m) => (
                <View key={m.id} style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 8 }}>
                  <KV k={m.description} v={`${materialOutstanding(m)} ${m.unit} with us`} sub={`Received ${m.received} · used ${m.used} · returned ${m.returned}`} />
                  {!finished && materialOutstanding(m) > 0 ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <DeskButton label="Used" onPress={() => p.setSettle({ id: m.id, kind: 'use', qty: String(materialOutstanding(m)) })} />
                      <DeskButton label="Give back" onPress={() => p.setSettle({ id: m.id, kind: 'return', qty: String(materialOutstanding(m)) })} />
                    </View>
                  ) : null}
                </View>
              ))}
              {!j.materials.length ? <T style={[dtext.cell, { color: c.inkMute }]}>Nothing received yet.</T> : null}
            </View>
          ) : null}

          {!finished ? <DeskButton label="Cancel job" tone="danger" onPress={p.onCancel} /> : null}
        </View>
      </ScrollView>

      <Sheet visible={p.matSheet} onClose={() => p.setMatSheet(false)} title="Material received" footer={<DeskButton label="Save" tone="primary" onPress={p.onSaveMaterial} />}>
        <View style={{ gap: 12 }}>
          <Field label="What" value={p.desc} onChangeText={p.setDesc} placeholder="e.g. Cotton cloth" />
          <Field label="Unit" value={p.unit} onChangeText={p.setUnit} />
          <NumberField label="How much" value={p.qty} onChange={p.setQty} decimals />
        </View>
      </Sheet>
      <Sheet visible={!!p.settle} onClose={() => p.setSettle(null)} title={p.settle?.kind === 'use' ? 'Material used up' : 'Give material back'} footer={<DeskButton label="Save" tone="primary" onPress={p.onSettle} />}>
        {p.settle ? <NumberField label="How much" value={p.settle.qty} onChange={(t) => p.setSettle({ ...p.settle!, qty: t })} decimals /> : null}
      </Sheet>
    </DeskPage>
  )
}

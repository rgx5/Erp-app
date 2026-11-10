import React from 'react'
import { Pressable, View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr } from '@/domain/money'
import { fmtQty, fmtQtyUnit, qtyStep, rulesOfBillItem, round3 } from '@/domain/qty'
import type { Bill, BillItem } from '@/domain/types'
import type { ReturnPlan } from '@/domain/returns'
import { Select } from '@/ui/Inputs'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Toolbar } from './kit'

export interface DesktopReturnOnAccountProps {
  bill: Bill
  owed: number
  qty: Record<string, number>
  setQty: (q: Record<string, number>) => void
  reason: string; setReason: (v: string) => void
  reasonOptions: string[]
  plan: ReturnPlan | null
  against: number
  onSave: () => void
}

/** The desktop return-against-a-bill form: the KPI strip, the quantity steppers for each line, and the same cash/account breakdown, in the centred shell. */
export function DesktopReturnOnAccount(p: DesktopReturnOnAccountProps) {
  const { c } = useTheme()
  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Return goods"
          subtitle={`Against ${p.bill.no}`}
          right={<DeskButton label={p.plan ? `Return · ${inr(p.plan.total, 0)}` : 'Choose what is coming back'} tone="primary" disabled={!p.plan} onPress={p.onSave} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Still owed on this bill" value={inr(p.owed, 0)} tone="primary" />
        {p.plan ? <KpiTile label="Return value" value={inr(p.plan.total, 2)} /> : null}
      </KpiStrip>

      <View style={{ flex: 1, alignItems: 'center', paddingTop: 10 }}>
        <View style={{ width: '100%', maxWidth: 640, gap: 16, paddingHorizontal: 20, paddingBottom: 24 }}>
          <Notice tone="primary" title={`${inr(p.owed, 0)} is still owed on this bill`} body="The return comes off that first." />

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            {p.bill.items.map((it: BillItem, i: number) => {
              const left = round3(it.qty - it.returnedQty)
              const r = rulesOfBillItem(it)
              const step = qtyStep(r)
              const q = p.qty[it.variantId] ?? 0
              return (
                <View key={it.variantId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, paddingHorizontal: 14, opacity: left <= 0 ? 0.45 : 1, backgroundColor: i % 2 ? c.surfaceAlt : 'transparent', borderBottomWidth: i < p.bill.items.length - 1 ? 1 : 0, borderBottomColor: c.line }}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <T style={dtext.cellStrong} numberOfLines={1}>{it.name}</T>
                    <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[variantLabel(it.size, it.color), left > 0 ? `${fmtQtyUnit(left, r)} to return` : 'All returned'].filter(Boolean).join(' · ')}</T>
                  </View>
                  {left > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Pressable onPress={() => p.setQty({ ...p.qty, [it.variantId]: Math.max(0, round3(q - step)) })} style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><T style={dtext.cellStrong}>−</T></Pressable>
                      <T style={[dtext.numStrong, { minWidth: 36, textAlign: 'center' }]}>{fmtQty(q)}</T>
                      <Pressable onPress={() => p.setQty({ ...p.qty, [it.variantId]: Math.min(left, round3(q + step)) })} style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><T style={[dtext.cellStrong, { color: c.primary }]}>+</T></Pressable>
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>

          <Select label="Reason" value={p.reason} options={p.reasonOptions.map((x) => ({ value: x, label: x }))} onChange={p.setReason} />

          {p.plan ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <KV k="Value of the goods" v={inr(p.plan.total, 2)} strong />
              <KV k="Taken off what is owed" v={inr(p.against, 2)} tone="success" />
              {p.plan.total - p.against > 0 ? <KV k="Handed back in cash" v={inr(Math.round((p.plan.total - p.against) * 100) / 100, 2)} /> : null}
            </View>
          ) : null}
        </View>
      </View>
    </DeskPage>
  )
}

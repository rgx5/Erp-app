import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { saveItemRule } from '@/modules/warehouse/ops'
import { useData } from '@/modules/warehouse/ui/common'
import { NumberField, SearchBar, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** Which items need a batch number and expiry, or a serial number and warranty, when they come in and go out. */
export default function Tracking() {
  const can = useCan('warehouse')
  const data = useData()
  const products = useList('products')
  const [q, setQ] = useState('')
  const rows = useMemo(() => products.filter((p) => p.active !== false && p.trackStock !== false && (!q.trim() || `${p.name} ${p.styleCode}`.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60), [products, q])
  if (!can) return <Screen title="Tracking rules" back><T tone="mute">Tracking rules are for the owner and managers.</T></Screen>
  const set = (id: string, patch: Parameters<typeof saveItemRule>[2]) => {
    try { perform((s, ctx) => saveItemRule(s, id, patch, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  return (
    <Screen title="Tracking rules" subtitle="Batch, expiry, serial number, warranty" back>
      <View style={{ gap: 12, paddingBottom: 20 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search item" />
        {rows.map((p) => {
          const r = data.itemRules[p.id]
          return (
            <Card key={p.id} padded={false}>
              <View style={{ padding: 14, paddingBottom: 0 }}><T v="bodyStrong" numberOfLines={1}>{p.name}</T><T v="caption" tone="mute">{p.styleCode}</T></View>
              <SwitchRow title="Batch and expiry" value={!!r?.trackBatch} onChange={(v) => set(p.id, { trackBatch: v })} />
              <SwitchRow title="Serial / IMEI number" value={!!r?.trackSerial} onChange={(v) => set(p.id, { trackSerial: v })} />
              {r?.trackSerial || r?.warrantyMonths ? <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}><NumberField label="Warranty (months)" value={r?.warrantyMonths ? String(r.warrantyMonths) : ''} onChange={(v) => set(p.id, { warrantyMonths: Math.max(0, Math.floor(Number(v) || 0)) })} /></View> : null}
            </Card>
          )
        })}
      </View>
    </Screen>
  )
}

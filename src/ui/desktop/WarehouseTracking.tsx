import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { saveItemRule } from '@/modules/warehouse/ops'
import { useData } from '@/modules/warehouse/ui/common'
import { NumberField, SearchBar, SwitchRow } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { DeskPage, Toolbar } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

/**
 * The desktop Tracking-rules screen: the same per-item `Card` of switches the phone screen uses, just centred in
 * a settings-style column (`DesktopSettingsPage`'s shell) instead of a full-width scroll — it is a set of toggles
 * per item, not a browsable record list, so a dense grid would not fit it the way it fits a document list. Reads
 * its own data the same way the phone screen does; `saveItemRule` is the exact same write.
 */
export function DesktopWarehouseTracking() {
  const can = useCan('warehouse')
  const data = useData()
  const products = useList('products')
  const [q, setQ] = useState('')
  const rows = useMemo(() => products.filter((p) => p.active !== false && p.trackStock !== false && (!q.trim() || `${p.name} ${p.styleCode}`.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100), [products, q])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Tracking rules" />}>
        <View style={{ padding: 20 }}><T tone="mute">Tracking rules are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const set = (id: string, patch: Parameters<typeof saveItemRule>[2]) => {
    try { perform((s, ctx) => saveItemRule(s, id, patch, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <DesktopSettingsPage title="Tracking rules" subtitle="Batch, expiry, serial number, warranty" maxWidth={820}>
      <View style={{ gap: 12 }}>
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
    </DesktopSettingsPage>
  )
}

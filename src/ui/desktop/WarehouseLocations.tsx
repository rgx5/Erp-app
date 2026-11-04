import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr0 } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { saveLocation } from '@/modules/warehouse/ops'
import { locationSummary } from '@/modules/warehouse/logic'
import type { LocationType } from '@/modules/warehouse/types'
import { LocationSheet } from '@/modules/warehouse/ui/LocationSheet'
import { useData } from '@/modules/warehouse/ui/common'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

const TYPE: Record<LocationType, string> = { warehouse: 'Godown', shelf: 'Shelf', counter: 'Counter' }

/**
 * The desktop Locations screen: a KPI strip (how many places, what they hold at cost) and a dense grid instead of
 * the phone's card list. Reads the exact same `locationSummary` the phone screen computes; this file only lays
 * the same rows out as a grid, and reuses `LocationSheet` unchanged for adding a place.
 */
export function DesktopLocations() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const [adding, setAdding] = useState(false)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Locations" />}>
        <View style={{ padding: 20 }}><T tone="mute">Locations are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows = locationSummary(data)
  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const totalUnits = rows.reduce((s, r) => s + r.units, 0)

  function create(d: { name: string; type: LocationType; parentId?: string }) {
    try { perform((s, ctx) => saveLocation(s, d, undefined, ctx)); toast(`${d.name} added`, 'ok'); setAdding(false) }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  const columns: Array<Column<typeof rows[number] & { id: string }>> = [
    { key: 'name', label: 'Location', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'type', label: 'Kind', width: 120, sortValue: (r) => r.type, render: (r) => <Pill label={r.locationId === 'main' ? 'Built in' : TYPE[r.type as LocationType] ?? r.type} /> },
    { key: 'items', label: 'Items', width: 90, align: 'right', sortValue: (r) => r.items, render: (r) => cellNum(String(r.items)) },
    { key: 'units', label: 'Units', width: 100, align: 'right', sortValue: (r) => r.units, render: (r) => cellNum(String(r.units)) },
    { key: 'value', label: 'Value at cost', width: 140, align: 'right', sortValue: (r) => r.value, render: (r) => cellNum(inr0(r.value), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Locations"
          subtitle="Where your stock sits"
          right={<DeskButton label="Add location" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => setAdding(true)} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Places" value={String(rows.length)} delta={`${rows.filter((r) => r.locationId !== 'main').length} set up`} />
        <KpiTile label="Stock at cost" value={inr0(totalValue)} tone="primary" delta={`${totalUnits} units in all`} />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows.map((r) => ({ ...r, id: r.locationId }))}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/warehouse/locations/[id]', params: { id: r.locationId } })}
          emptyLabel="No locations yet"
        />
      </View>

      <LocationSheet visible={adding} onClose={() => setAdding(false)} onSave={create} />
    </DeskPage>
  )
}

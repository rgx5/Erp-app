import React from 'react'
import { View } from 'react-native'
import type { HrTable } from '@/modules/hr/logic/reports'
import type { Tone } from '@/ui/theme'
import { useTheme } from '@/ui/theme'
import { DataTable, cellNum, cellText, dtext, type Column } from './kit'
import { T } from '@/ui/Text'

/**
 * Turns the generic `HrTable` every people report already builds (`src/modules/hr/logic/reports.ts`) into a
 * `DataTable`, so every report under `m/hr/reports/[kind]` (and the attendance month sheet) reads as a dense grid on
 * desktop without any report re-deriving its own rows — the table's `columns`/`rows`/`bold` come from the phone
 * screen exactly as computed.
 */
export function HrTableGrid({ table }: { table: HrTable }) {
  const { c } = useTheme()
  if (!table.rows.length) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
        <T style={[dtext.cell, { color: c.inkMute }]}>Nothing to show</T>
      </View>
    )
  }
  const bold = new Set(table.bold ?? [])
  type Row = { id: string; cells: Array<string | number> }
  const rows: Row[] = table.rows.map((r, i) => ({ id: String(i), cells: r.map((v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)) }))
  const columns: Array<Column<Row>> = table.columns.map((col, ci) => ({
    key: String(ci),
    label: col.label,
    align: col.align,
    width: ci === 0 ? 220 : undefined,
    render: (r) => {
      const v = r.cells[ci]
      const strong = bold.has(Number(r.id))
      return col.align === 'right' ? cellNum(String(v), strong) : cellText(v, strong)
    },
  }))
  return <DataTable rows={rows} columns={columns} emptyLabel="Nothing to show" />
}

/** The tone an attendance status pill should take, shared by every desktop attendance grid. */
export function attendanceTone(status: string): Tone {
  if (status === 'present') return 'success'
  if (status === 'half' || status === 'leave') return 'warning'
  if (status === 'absent' || status === 'unmarked') return 'danger'
  return 'default'
}

import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toCsv, csvFileName } from '@/domain/csv'
import { toInputDate } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { exportRows, previewImport, templateRows, type ImportAction } from '@/modules/catalog/import'
import { importItems, postOpeningStock } from '@/modules/catalog/ops'
import { kindOfFile, readTable, toXlsx, XLSX_MIME } from '@/modules/catalog/sheet'
import type { CustomFieldDef } from '@/modules/catalog/types'
import { pickFile, readBytes, readText, shareBytes } from '@/modules/catalog/ui/files'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, FileSpreadsheet, Upload } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, dtext, type Column } from './kit'

const TONE: Record<ImportAction, Tone> = { create: 'success', update: 'primary', same: 'default', error: 'danger' }
const WORD: Record<ImportAction, string> = { create: 'New', update: 'Update', same: 'No change', error: 'Refused' }
type Row = { id: string; title: string; subtitle: string; line: number; action: ImportAction }

/**
 * The desktop Import & export screen: a KPI strip for the preview counts, a result filter and a dense sortable
 * grid of every row instead of the phone's scrolling list. Every row comes from the same `previewImport` the
 * phone `m/catalog/bulk.tsx` calls; importing still goes through `importItems`/`postOpeningStock` unchanged.
 */
export function DesktopBulkItems() {
  const { c } = useTheme()
  const can = useCan('inventory')
  const data = useApp((s) => s.data)
  const defs: CustomFieldDef[] = useList('customFields')
  const [table, setTable] = useState<string[][] | null>(null)
  const [file, setFile] = useState('')
  const [filter, setFilter] = useState<'' | ImportAction>('')
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => (table ? previewImport(table, data, defs) : null), [table, data, defs])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Import & export" />}>
        <View style={{ padding: 20 }}><T tone="mute">Import & export is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  async function choose() {
    setBusy(true)
    try {
      const f = await pickFile(['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', '*/*'])
      if (!f) return
      const kind = kindOfFile(f.name)
      setTable(readTable(kind === 'csv' ? await readText(f.uri) : await readBytes(f.uri), kind))
      setFile(f.name); setFilter('')
    } catch { toast('That file could not be read. Use a .csv or .xlsx file.', 'err') } finally { setBusy(false) }
  }

  async function apply() {
    if (!table || !preview) return
    const n = preview.counts.create + preview.counts.update
    const ok = await ask({
      title: `Import ${n} ${n === 1 ? 'row' : 'rows'}?`,
      message: `${preview.counts.items} new items, ${preview.counts.create} new variants, ${preview.counts.update} updates.${preview.counts.error ? ` ${preview.counts.error} refused rows are left out.` : ''}`,
      confirm: 'Import',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = perform((s, ctx) => importItems(s, table, ctx, { fileName: file }))
      if (r.openings.length) perform((s, ctx) => postOpeningStock(s, r.openings, ctx))
      toast(`${r.items} items, ${r.created} new variants, ${r.updated} updated`, 'ok')
      setTable(null); setFile('')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not import', 'err') } finally { setBusy(false) }
  }

  const day = toInputDate(Date.now())
  const rows: Row[] = (preview?.rows ?? []).filter((r) => !filter || r.action === filter).map((r) => ({
    id: String(r.line), title: `${r.data.name || r.data.sku || r.data.barcode || 'Row'}${r.data.size || r.data.color ? ` · ${[r.data.size, r.data.color].filter(Boolean).join(' / ')}` : ''}`,
    subtitle: r.errors.length ? r.errors.join(' · ') : [...r.changes, ...r.warnings].join(' · ') || `Row ${r.line}`, line: r.line, action: r.action,
  }))
  const ready = preview ? preview.counts.create + preview.counts.update : 0

  const columns: Array<Column<Row>> = [
    { key: 'title', label: 'Row', sortValue: (r) => r.line, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.subtitle}</T>
      </View>
    ) },
    { key: 'action', label: 'Result', width: 110, sortValue: (r) => r.action, render: (r) => <Pill tone={TONE[r.action]} label={WORD[r.action]} /> },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Import & export" subtitle="Items from CSV or Excel"
          right={
            <>
              <DeskButton label="Template" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName('item import template'), toCsv(templateRows()))} />
              <DeskButton label={file || 'Choose a file'} tone="primary" icon={<Upload size={14} color={c.onPrimary} />} disabled={busy && !table} onPress={() => void choose()} />
              {preview && !preview.fatal ? <DeskButton label={ready ? `Import ${ready}` : 'Nothing to import'} tone="primary" disabled={!ready || busy} onPress={() => void apply()} /> : null}
            </>
          } />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, flexDirection: 'row', gap: 10 }}>
        <DeskButton label="Export Excel (.xlsx)" icon={<FileSpreadsheet size={14} color={c.primary} />} onPress={() => void shareBytes(csvFileName(`items ${day}`, 'xlsx'), toXlsx(exportRows(data, defs)), XLSX_MIME).catch(() => toast('Could not export', 'err'))} />
        <DeskButton label="Export CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(`items ${day}`), toCsv(exportRows(data, defs))).catch(() => toast('Could not export', 'err'))} />
      </View>

      {preview?.fatal ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="danger" title="This file cannot be imported" body={preview.fatal} /></View> : null}
      {preview && !preview.fatal ? (
        <>
          <KpiStrip>
            <KpiTile label="New items" value={String(preview.counts.items)} />
            <KpiTile label="New variants" value={String(preview.counts.create)} tone="success" />
            <KpiTile label="Updates" value={String(preview.counts.update)} tone="primary" />
            <KpiTile label="No change" value={String(preview.counts.same)} />
            <KpiTile label="Refused" value={String(preview.counts.error)} tone={preview.counts.error ? 'danger' : 'default'} />
          </KpiStrip>
          {preview.ignored.length ? <View style={{ paddingHorizontal: 20 }}><Notice title="Columns not used" body={preview.ignored.join(', ')} /></View> : null}
          <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
            <DeskSegmented value={filter} onChange={setFilter} options={[{ id: '', label: 'All' }, { id: 'error', label: 'Refused' }, { id: 'create', label: 'New' }, { id: 'update', label: 'Updates' }, { id: 'same', label: 'No change' }]} />
          </View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable rows={rows} columns={columns} emptyLabel="No rows here" />
          </View>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <T tone="mute">Choose a file to preview the import.</T>
        </View>
      )}
    </DeskPage>
  )
}

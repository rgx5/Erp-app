import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { csvFileName, toCsv } from '@/domain/csv'
import { toInputDate } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { exportRows, previewImport, templateRows, type ImportAction } from '@/modules/catalog/import'
import { importItems, postOpeningStock } from '@/modules/catalog/ops'
import { kindOfFile, readTable, toXlsx, XLSX_MIME } from '@/modules/catalog/sheet'
import { CustomFieldDef } from '@/modules/catalog/types'
import { pickFile, readBytes, readText, shareBytes } from '@/modules/catalog/ui/files'
import { NoAccess } from '@/modules/catalog/ui/common'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, ListRow, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, FileSpreadsheet, Upload } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'

const TONE: Record<ImportAction, Tone> = { create: 'success', update: 'primary', same: 'default', error: 'danger' }
const WORD: Record<ImportAction, string> = { create: 'New', update: 'Update', same: 'No change', error: 'Refused' }
const SHOWN = 150

/** Bring items in from a spreadsheet, or take them out to one. Every row is checked and shown before anything is written. */
export default function BulkItems() {
  const { c } = useTheme()
  const can = useCan('inventory')
  const data = useApp((s) => s.data)
  const defs: CustomFieldDef[] = useList('customFields')
  const [table, setTable] = useState<string[][] | null>(null)
  const [file, setFile] = useState('')
  const [filter, setFilter] = useState<'' | ImportAction>('')
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => (table ? previewImport(table, data, defs) : null), [table, data, defs])

  if (!can) return <NoAccess title="Import & export" who="the owner and managers" />

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
  const rows = preview?.rows.filter((r) => !filter || r.action === filter) ?? []
  const ready = preview ? preview.counts.create + preview.counts.update : 0

  return (
    <Screen title="Import & export" subtitle="Items from CSV or Excel" back
      footer={preview && !preview.fatal ? <Button label={ready ? `Import ${ready} ${ready === 1 ? 'row' : 'rows'}` : 'Nothing to import'} size="lg" block disabled={!ready} loading={busy} onPress={() => void apply()} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <Section title="Import" style={{ marginTop: 0 }}>
          <Card style={{ gap: 12 }}>
            <T tone="soft">One row per size / colour. Rows with the same Item code become one item. A row whose SKU or barcode is already in your catalogue updates that item’s prices, cost and stock instead.</T>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label={file || 'Choose a file'} icon={<Upload size={17} color={c.bg} />} loading={busy && !table} onPress={() => void choose()} /></View>
              <Button label="Template" kind="soft" icon={<Download size={16} color={c.primary} />} onPress={() => void shareFile(csvFileName('item import template'), toCsv(templateRows()))} />
            </View>
          </Card>
        </Section>

        {preview?.fatal ? <Notice tone="danger" title="This file cannot be imported" body={preview.fatal} /> : null}
        {preview && !preview.fatal ? (
          <>
            <Card>
              <KV k="New items" v={String(preview.counts.items)} />
              <KV k="New variants" v={String(preview.counts.create)} tone="success" />
              <KV k="Updates" v={String(preview.counts.update)} tone="primary" />
              <KV k="No change" v={String(preview.counts.same)} />
              <KV k="Refused" v={String(preview.counts.error)} tone={preview.counts.error ? 'danger' : undefined} />
              {preview.newCategories.length ? <KV k="New categories" v={preview.newCategories.join(', ')} /> : null}
            </Card>
            {preview.ignored.length ? <Notice tone="default" title="Columns not used" body={preview.ignored.join(', ')} /> : null}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {([['', 'All'], ['error', 'Refused'], ['create', 'New'], ['update', 'Updates'], ['same', 'No change']] as Array<[typeof filter, string]>).map(([k, l]) => (
                <Chip key={k} label={l} selected={filter === k} count={k ? preview.counts[k] : preview.rows.length} onPress={() => setFilter(k)} />
              ))}
            </View>
            <Card padded={false}>
              {rows.slice(0, SHOWN).map((r) => (
                <ListRow key={r.line} title={`${r.data.name || r.data.sku || r.data.barcode || 'Row'}${r.data.size || r.data.color ? ` · ${[r.data.size, r.data.color].filter(Boolean).join(' / ')}` : ''}`}
                  subtitle={r.errors.length ? r.errors.join(' · ') : [...r.changes, ...r.warnings].join(' · ') || `Row ${r.line}`}
                  meta={`Row ${r.line}`} badge={<Badge tone={TONE[r.action]}>{WORD[r.action]}</Badge>} />
              ))}
              {rows.length > SHOWN ? <T v="caption" tone="mute" align="center" style={{ padding: 12 }}>Showing the first {SHOWN} of {rows.length} rows</T> : null}
              {!rows.length ? <T tone="mute" align="center" style={{ padding: 16 }}>No rows here</T> : null}
            </Card>
          </>
        ) : null}

        <Section title="Export" style={{ marginTop: 6 }}>
          <Card style={{ gap: 12 }}>
            <T tone="soft">Every item and variant with its prices, cost, stock and custom fields, in the same columns an import reads — export, edit in a spreadsheet, import it back.</T>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label="Excel (.xlsx)" kind="soft" icon={<FileSpreadsheet size={17} color={c.primary} />} onPress={() => void shareBytes(csvFileName(`items ${day}`, 'xlsx'), toXlsx(exportRows(data, defs)), XLSX_MIME).catch(() => toast('Could not export', 'err'))} /></View>
              <View style={{ flex: 1 }}><Button label="CSV" kind="soft" icon={<Download size={16} color={c.primary} />} onPress={() => void shareFile(csvFileName(`items ${day}`), toCsv(exportRows(data, defs))).catch(() => toast('Could not export', 'err'))} /></View>
            </View>
          </Card>
        </Section>
      </View>
    </Screen>
  )
}

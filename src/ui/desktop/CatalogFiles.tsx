import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { needsUpload } from '@/modules/catalog/upload'
import { uploadAllPending, uploadTarget } from '@/modules/catalog/ui/files'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Cloud } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, Toolbar, dtext, type Column } from './kit'

type Row = { id: string; name: string; item: string; onServer: boolean }

/**
 * The desktop Photos & files screen: one dense sortable grid of every attachment instead of the phone's scrolling
 * cards. Rows use the same `needsUpload`/`uploadAllPending` the phone `m/catalog/files.tsx` calls.
 */
export function DesktopCatalogFiles() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const files = useList('itemAttachments')
  const products = useList('products')
  const [busy, setBusy] = useState(false)
  const name = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const pending = files.filter(needsUpload)
  const online = !!uploadTarget()

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Photos & files" />}>
        <View style={{ padding: 20 }}><T tone="mute">Photos & files are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  async function sendAll() {
    setBusy(true)
    const r = await uploadAllPending()
    setBusy(false)
    if (r.failed) toast(`${r.done} uploaded, ${r.failed} failed. ${r.message ?? ''}`.trim(), 'err'); else toast(`${r.done} uploaded`, 'ok')
  }

  const rows: Row[] = [...files].sort((a, b) => b.addedAt - a.addedAt).map((a) => ({ id: a.id, name: a.name, item: name.get(a.productId) ?? 'Item', onServer: !!a.remoteId }))
  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'File', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.item}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 130, sortValue: (r) => Number(r.onServer), render: (r) => <Pill tone={r.onServer ? 'success' : 'warning'} label={r.onServer ? 'On server' : 'On this phone'} /> },
  ]
  const rowOf = (id: string) => files.find((a) => a.id === id)

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Photos & files" subtitle={`${files.length} attached`}
          right={pending.length && online ? <DeskButton label={`Upload ${pending.length}`} tone="primary" icon={<Cloud size={14} color={c.onPrimary} />} disabled={busy} onPress={() => void sendAll()} /> : undefined} />
      }
    >
      {!online && pending.length ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="warning" title="Not connected to a server" body="Photos stay on this phone until it is connected to a OneSync server; then they can be uploaded so other phones see them." /></View> : null}
      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => { const a = rowOf(r.id); if (a) router.push({ pathname: '/m/catalog/item/[id]', params: { id: a.productId } }) }} emptyLabel="No photos or files yet" />
      </View>
    </DeskPage>
  )
}

import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { needsUpload } from '@/modules/catalog/upload'
import { AttachmentThumb } from '@/modules/catalog/ui/AttachmentThumb'
import { NoAccess } from '@/modules/catalog/ui/common'
import { uploadAllPending, uploadTarget } from '@/modules/catalog/ui/files'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Tap } from '@/ui/primitives'
import { EmptyState, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Cloud, Image as ImageIcon } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Every photo and file attached to an item, and whether it has reached the server. */
export default function CatalogFiles() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const files = useList('itemAttachments')
  const products = useList('products')
  const [busy, setBusy] = useState(false)
  const name = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const pending = files.filter(needsUpload)
  const online = !!uploadTarget()

  if (!can) return <NoAccess title="Photos & files" who="the owner and managers" />

  async function sendAll() {
    setBusy(true)
    const r = await uploadAllPending()
    setBusy(false)
    if (r.failed) toast(`${r.done} uploaded, ${r.failed} failed. ${r.message ?? ''}`.trim(), 'err'); else toast(`${r.done} uploaded`, 'ok')
  }

  return (
    <Screen title="Photos & files" subtitle={`${files.length} attached`} back
      right={pending.length && online ? <Button label={`Upload ${pending.length}`} size="sm" icon={<Cloud size={15} color={c.bg} />} loading={busy} onPress={() => void sendAll()} /> : undefined}>
      {!online && pending.length ? <Notice tone="warning" title="Not connected to a server" body="Photos stay on this phone until it is connected to a Kosh server; then they can be uploaded so other phones see them." /> : null}
      {!files.length ? (
        <EmptyState icon={<ImageIcon size={26} color={c.primary} />} title="No photos or files yet" hint="Open an item and add a photo, a spec sheet or a warranty card." />
      ) : (
        <View style={{ gap: 8, paddingBottom: 24, paddingTop: 8 }}>
          {[...files].sort((a, b) => b.addedAt - a.addedAt).map((a) => (
            <Tap key={a.id} onPress={() => router.push({ pathname: '/m/catalog/item/[id]', params: { id: a.productId } })}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <AttachmentThumb a={a} size={52} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="bodyStrong" numberOfLines={1}>{a.name}</T>
                  <T v="caption" tone="mute" numberOfLines={1}>{name.get(a.productId)?.name ?? 'Item'}</T>
                </View>
                <Badge tone={a.remoteId ? 'success' : 'warning'}>{a.remoteId ? 'On server' : 'On this phone'}</Badge>
              </Card>
            </Tap>
          ))}
        </View>
      )}
    </Screen>
  )
}

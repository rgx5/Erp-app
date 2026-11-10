import React, { useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { File } from 'expo-file-system'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { OpError } from '@/data/ops'
import { perform } from '@/data/store'
import { addAttachment } from '@/modules/catalog/ops'
import { keepFile } from '@/modules/catalog/ui/files'
import { T } from '@/ui/Text'
import { Camera } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { goBack } from '@/ui/nav'
import { DeskButton, DeskPage, Toolbar } from './kit'

/**
 * The desktop camera screen: the same `expo-camera` capture flow as `src/app/m/catalog/camera.tsx`, under the
 * standard `DeskPage`/`Toolbar` chrome and centred in a comfortably sized preview instead of filling the whole
 * window edge to edge. Capturing and attaching the photo (`keepFile`, `addAttachment`) is unchanged.
 */
export function DesktopCatalogCamera() {
  const { c } = useTheme()
  const router = useRouter()
  const { productId } = useLocalSearchParams<{ productId: string }>()
  const [perm, requestPerm] = useCameraPermissions()
  const cam = useRef<CameraView>(null)
  const [busy, setBusy] = useState(false)

  async function snap() {
    if (busy || !cam.current) return
    setBusy(true)
    try {
      const shot = await cam.current.takePictureAsync({ quality: 0.7, skipProcessing: false })
      const name = `photo-${Date.now()}.jpg`
      const uri = await keepFile(shot.uri, name)
      let size = 0
      try { size = Platform.OS === 'web' ? 0 : new File(uri).size } catch { /* unknown size is fine */ }
      perform((s, ctx) => addAttachment(s, { productId, kind: 'photo', name, uri, mime: 'image/jpeg', size }, ctx))
      toast('Photo added', 'ok')
      goBack(router)
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not take the photo', 'err')
      setBusy(false)
    }
  }

  return (
    <DeskPage toolbar={<Toolbar title="Take photo" right={<DeskButton label="Close" onPress={() => goBack(router)} />} />}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        {perm?.granted ? (
          <View style={{ width: 480, aspectRatio: 3 / 4, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
            <CameraView ref={cam} style={{ flex: 1 }} facing="back" />
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 14, maxWidth: 360 }}>
            <Camera size={44} color={c.inkMute} />
            <T style={{ fontSize: 18, textAlign: 'center' }}>Camera access</T>
            <T tone="mute" style={{ textAlign: 'center' }}>{perm && !perm.canAskAgain ? 'Camera permission is off. Turn it on in your browser or system settings, or choose a photo from your files instead.' : 'Allow the camera to photograph the item.'}</T>
            {perm?.canAskAgain !== false ? <DeskButton label="Allow camera" tone="primary" onPress={() => void requestPerm()} /> : null}
          </View>
        )}
      </View>
      {perm?.granted ? (
        <View style={{ paddingBottom: 24, alignItems: 'center' }}>
          <DeskButton label={busy ? 'Saving…' : 'Capture'} tone="primary" disabled={busy} onPress={() => void snap()} />
        </View>
      ) : null}
    </DeskPage>
  )
}

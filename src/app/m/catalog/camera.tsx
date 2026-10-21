import React, { useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { File } from 'expo-file-system'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { OpError } from '@/data/ops'
import { perform } from '@/data/store'
import { addAttachment } from '@/modules/catalog/ops'
import { keepFile } from '@/modules/catalog/ui/files'
import { Button, IconButton } from '@/ui/Button'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Camera, Close } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { goBack } from '@/ui/nav'

/** Takes a photo of an item with the camera and attaches it. The picture is kept on the phone first; uploading is a separate step. */
export default function CatalogCamera() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
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
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {perm?.granted ? (
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 14 }}>
          <Camera size={44} color="rgba(255,255,255,0.7)" />
          <T v="h2" style={{ color: '#fff' }} align="center">Camera access</T>
          <T style={{ color: 'rgba(255,255,255,0.7)' }} align="center">{perm && !perm.canAskAgain ? 'Camera permission is off. Turn it on in your phone’s Settings, or choose a photo from your files instead.' : 'Allow the camera to photograph the item.'}</T>
          {perm?.canAskAgain !== false ? <Button label="Allow camera" onPress={() => void requestPerm()} /> : null}
        </View>
      )}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 8, paddingHorizontal: 16 }}>
        <IconButton label="Close camera" tone="dark" onPress={() => goBack(router)}><Close size={20} color="#fff" /></IconButton>
      </View>
      {perm?.granted ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + 28, left: 0, right: 0, alignItems: 'center' }}>
          <Tap onPress={() => void snap()} disabled={busy} style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' }} />
          </Tap>
        </View>
      ) : null}
    </View>
  )
}

import React from 'react'
import { Image, ScrollView, View } from 'react-native'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Camera, Close } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { dropPhoto, pickPhoto } from './photos'

/** A row of photo thumbnails with a button to add one more (through the phone's chooser / camera) and a cross to remove one. */
export function PhotoStrip({ photos, onChange, max = 12, readOnly }: { photos: string[]; onChange?: (p: string[]) => void; max?: number; readOnly?: boolean }) {
  const { c, radius } = useTheme()
  async function add() {
    try {
      const uri = await pickPhoto()
      if (uri) onChange?.([...photos, uri])
    } catch { toast('Could not add the photo', 'err') }
  }
  if (readOnly && !photos.length) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
      {photos.map((uri) => (
        <View key={uri} style={{ width: 86, height: 86, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.sunken }}>
          <Image source={{ uri }} style={{ width: 86, height: 86 }} accessibilityLabel="Photo" />
          {readOnly ? null : (
            <Tap onPress={() => { dropPhoto(uri); onChange?.(photos.filter((p) => p !== uri)) }} accessibilityLabel="Remove photo" style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Close size={14} color={c.bg} />
            </Tap>
          )}
        </View>
      ))}
      {!readOnly && photos.length < max ? (
        <Tap onPress={() => void add()} accessibilityLabel="Add photo" style={{ width: 86, height: 86, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: c.lineStrong, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Camera size={22} color={c.primary} />
          <T v="micro" tone="mute">Add photo</T>
        </Tap>
      ) : null}
    </ScrollView>
  )
}

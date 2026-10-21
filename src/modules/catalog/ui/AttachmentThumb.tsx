import React, { useState } from 'react'
import { Image, View } from 'react-native'
import type { ItemAttachment } from '../types'
import { fileUrl } from '../upload'
import { authHeaders, uploadTarget } from './files'
import { Paperclip } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Source = { uri: string; headers?: Record<string, string> }

/**
 * Where to load a photo from. An uploaded photo comes from the server (the same on every phone; it needs the sign-in); the file on the
 * phone that took it is the fallback, and the only copy until it is uploaded.
 */
export function attachmentSources(a: ItemAttachment): Source[] {
  if (a.kind !== 'photo') return []
  const t = uploadTarget()
  const remote = t ? fileUrl(t.baseUrl, a) : null
  return [...(remote ? [{ uri: remote, headers: authHeaders() }] : []), ...(a.uri ? [{ uri: a.uri }] : [])]
}

export function AttachmentThumb({ a, size = 84 }: { a: ItemAttachment; size?: number }) {
  const { c } = useTheme()
  const sources = attachmentSources(a)
  const [tried, setTried] = useState(0)
  const src = sources[tried]
  return src ? (
    <Image source={src} onError={() => setTried((n) => n + 1)} style={{ width: size, height: size, borderRadius: 12, backgroundColor: c.sunken }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><Paperclip size={size / 3} color={c.inkMute} /></View>
  )
}

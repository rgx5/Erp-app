import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useApp } from '@/data/store'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Cloud, CloudOff, HardDrive, Refresh, Alert } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** One glance at whether the business is safe: synced, uploading, offline with changes waiting, or just on this phone. */
export function SyncPill({ onDark, compact }: { onDark?: boolean; compact?: boolean }) {
  const { c } = useTheme()
  const router = useRouter()
  const mode = useApp((s) => s.workspace?.mode)
  const sync = useApp((s) => s.sync)

  let label: string, tone: string, Icon = Cloud
  let calm = false
  if (mode !== 'remote') { label = 'On this phone'; tone = c.inkSoft; Icon = HardDrive; calm = true }
  else if (!sync.authenticated) { label = 'Sign in to sync'; tone = c.warning; Icon = Alert }
  else if (sync.rejected > 0) { label = `${sync.rejected} not saved`; tone = c.danger; Icon = Alert }
  else if (!sync.online) { label = sync.pending ? `Offline · ${sync.pending} waiting` : 'Offline'; tone = c.warning; Icon = CloudOff }
  else if (sync.busy || sync.pending) { label = sync.pending ? `Syncing ${sync.pending}…` : 'Syncing…'; tone = c.primary; Icon = Refresh }
  else { label = 'Synced'; tone = c.success; Icon = Cloud; calm = true }

  const fg = onDark ? '#FFFFFF' : tone
  // When all is well the pill shrinks to an icon; a problem earns the words.
  const iconOnly = compact && calm
  return (
    <Tap onPress={() => router.push('/settings/sync')} accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, ...(iconOnly ? { width: 36 } : { paddingHorizontal: 11 }), height: 36, borderRadius: 18, backgroundColor: onDark ? 'rgba(255,255,255,0.14)' : c.surface, borderWidth: 1, borderColor: onDark ? 'rgba(255,255,255,0.18)' : c.line }}>
      <View><Icon size={14} color={fg} /></View>
      {iconOnly ? null : <T v="micro" style={{ color: fg, fontSize: 12 }} numberOfLines={1}>{label}</T>}
    </Tap>
  )
}

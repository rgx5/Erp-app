import React from 'react'
import { OpError, updateSettings } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import type { StoreSettings } from '@/domain/types'
import { Screen } from '@/ui/Screen'
import { EmptyState } from '@/ui/blocks'
import { Lock, Cloud, CloudOff, HardDrive, Refresh, Alert } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Writes business settings (queued for the server in a connected workspace). Returns whether it worked. */
export function saveSettings(patch: Partial<StoreSettings>, message = 'Saved'): boolean {
  try {
    perform((_s, ctx) => updateSettings(patch, ctx))
    toast(message, 'ok')
    return true
  } catch (e) {
    toast(e instanceof OpError ? e.message : 'Could not save', 'err')
    return false
  }
}

/** What a settings screen shows to someone whose role does not allow changing the business. */
export function SettingsLocked({ title }: { title: string }) {
  const { c } = useTheme()
  return (
    <Screen title={title} back>
      <EmptyState icon={<Lock size={26} color={c.primary} />} title="Only the owner can change this" hint="Sign in with the owner’s account to edit business settings." />
    </Screen>
  )
}

/** True for the owner (the only role with the 'settings' permission). */
export const useCanSettings = () => useCan('settings')

/** The one-line state of the connection to the server, shared by the More tab and the sync screen. */
export function useSyncStatus() {
  const { c } = useTheme()
  const mode = useApp((s) => s.workspace?.mode)
  const sync = useApp((s) => s.sync)
  if (mode !== 'remote') return { label: 'Stored on this phone', detail: 'No server — everything stays on this device', tone: c.inkSoft, Icon: HardDrive, calm: true }
  if (!sync.authenticated) return { label: 'Sign in to sync', detail: 'Your session ended. Changes are kept safely on this phone.', tone: c.warning, Icon: Alert, calm: false }
  if (sync.rejected > 0) return { label: `${sync.rejected} ${sync.rejected === 1 ? 'change' : 'changes'} not saved`, detail: 'The server refused them. Tap to see why.', tone: c.danger, Icon: Alert, calm: false }
  if (!sync.online) return { label: sync.pending ? `Offline · ${sync.pending} waiting` : 'Offline', detail: 'Everything keeps working. It uploads when you are back online.', tone: c.warning, Icon: CloudOff, calm: false }
  if (sync.busy || sync.pending) return { label: sync.pending ? `Syncing ${sync.pending}…` : 'Syncing…', detail: 'Uploading to the server', tone: c.primary, Icon: Refresh, calm: false }
  return { label: 'All changes saved', detail: 'Backed up to the server', tone: c.success, Icon: Cloud, calm: true }
}

import React, { useState } from 'react'
import { Platform, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { fmtDate, fmtDateTime, toInputDate } from '@/domain/dates'
import { num } from '@/domain/money'
import { signOut } from '@/data/auth'
import { backupCounts, backupToData, buildBackup, parseBackup } from '@/data/backup'
import { useIndustry, useList } from '@/data/hooks'
import { useApp } from '@/data/store'
import { SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { shareFile } from '@/features/shareFile'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, Trash, Upload } from '@/ui/icons'
import { ask, tell, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Back up everything to a file, restore from one (offline businesses), or remove the business from this phone. */
export default function DataScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const allowed = useCanSettings()
  const ws = useApp((s) => s.workspace)
  const pack = useIndustry()
  const pending = useApp((s) => s.sync.pending)
  const bills = useList('bills')
  const products = useList('products')
  const customers = useList('customers')
  const [busy, setBusy] = useState(false)
  const [erase, setErase] = useState(false)

  if (!allowed) return <SettingsLocked title="Data & backup" />
  const local = ws?.mode !== 'remote'

  async function exportBackup() {
    const s = useApp.getState()
    if (!s.workspace) return
    try {
      const backup = buildBackup(s.data, { name: s.workspace.name, industry: s.workspace.industry, mode: s.workspace.mode })
      await shareFile(csvFileName(`kosh backup ${s.workspace.name} ${toInputDate(Date.now())}`, 'json'), JSON.stringify(backup), 'application/json')
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not make the backup', 'err') }
  }

  async function restore() {
    setBusy(true)
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false })
      if (picked.canceled || !picked.assets?.[0]) return
      const uri = picked.assets[0].uri
      const text = Platform.OS === 'web' ? await (await fetch(uri)).text() : await new File(uri).text()
      const backup = parseBackup(text)
      const n = backupCounts(backup)
      const ok = await ask({
        title: 'Replace everything with this backup?',
        message: `${backup.store.name}, saved ${backup.exportedAt ? fmtDateTime(backup.exportedAt) : 'at an unknown time'}: ${num(n.bills)} bills, ${num(n.items)} items, ${num(n.customers)} customers. What is on this phone now will be lost.`,
        confirm: 'Restore', danger: true,
      })
      if (!ok) return
      const s = useApp.getState()
      const data = backupToData(backup)
      await s.replaceData(data)
      if (s.workspace) await s.setWorkspace({ ...s.workspace, name: backup.store.name, industry: backup.workspace.industry })
      const stay = s.session && data.users[s.session.userId]?.active
      if (!stay) await s.setSession(null)
      toast('Backup restored', 'ok')
      if (!stay) router.replace('/who')
    } catch (e) {
      await tell('Could not restore', e instanceof Error ? e.message : 'The file could not be read.')
    } finally { setBusy(false) }
  }

  async function leave() {
    if (local && !ws?.demo) { setErase(true); return }
    const ok = await ask({
      title: local ? 'Remove the sample business?' : 'Disconnect this phone?',
      message: local ? 'The sample data is removed from this phone.' : pending ? `${pending} ${pending === 1 ? 'change has' : 'changes have'} not reached the server and will be lost.` : 'Everything is saved on the server. You can sign back in at any time.',
      confirm: local ? 'Remove' : 'Disconnect', danger: true,
    })
    if (ok) { await signOut(); router.replace('/welcome') }
  }

  return (
    <Screen title="Data & backup" back>
      <View style={{ paddingBottom: 12 }}>
        <Section title="Back up" style={{ marginTop: 6 }}>
          <Card>
            <T tone="soft">{local ? 'Everything lives on this phone, so a backup file is your safety net. Save it somewhere that is not this phone — Drive, email, WhatsApp to yourself.' : 'Your business is safe on the server. A backup file is an extra copy you can keep.'}</T>
            <View style={{ marginTop: 14 }}><Button label="Export a backup file" size="lg" block icon={<Download size={19} color="#fff" />} onPress={exportBackup} /></View>
          </Card>
          <View style={{ marginTop: 10 }}><Notice tone="warning" title="Keep the file private" body="It holds every bill, customer and price — and, for an offline business, scrambled staff PINs." /></View>
        </Section>

        {local ? (
          <Section title="Restore" style={{ marginTop: 24 }}>
            <Card>
              <T tone="soft">Moving to a new phone or recovering from a reset? Pick a backup file made by this app. It replaces everything on this phone.</T>
              <View style={{ marginTop: 14 }}><Button label="Restore from a backup file" kind="outline" block loading={busy} icon={<Upload size={18} color={c.ink} />} onPress={restore} /></View>
            </Card>
          </Section>
        ) : null}

        <Section title="This business" style={{ marginTop: 24 }}>
          <Card>
            <KV k="Name" v={ws?.name ?? ''} />
            <KV k="Industry" v={pack.name} />
            <KV k="Stored" v={local ? 'On this phone only' : 'On the server, copy on this phone'} />
            <KV k="Started" v={ws ? fmtDate(ws.createdAt) : '—'} />
            <KV k="Bills · items · customers" v={`${num(bills.length)} · ${num(products.length)} · ${num(customers.length)}`} />
          </Card>
        </Section>

        <Section title={local ? 'Erase' : 'Disconnect'} style={{ marginTop: 24 }}>
          <Card>
            <T tone="soft">{local ? 'Remove this business from the phone for good. Back it up first if you might need it again.' : 'Sign out and clear this phone. The business stays on the server.'}</T>
            <View style={{ marginTop: 14 }}><Button label={local ? 'Erase this business' : 'Disconnect this phone'} kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={leave} /></View>
          </Card>
        </Section>
      </View>
      <EraseSheet visible={erase} name={ws?.name ?? ''} onClose={() => setErase(false)} onConfirm={async () => { await signOut(); router.replace('/welcome') }} />
    </Screen>
  )
}

/** Erasing cannot be undone, so it asks for the business name to be typed — the same reason GitHub does. */
function EraseSheet({ visible, name, onClose, onConfirm }: { visible: boolean; name: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const match = typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== ''
  return (
    <Sheet visible={visible} onClose={() => { setTyped(''); onClose() }} title="Erase this business?" subtitle="This cannot be undone"
      footer={<Button label="Erase everything" kind="danger" size="lg" block disabled={!match} loading={busy} onPress={async () => { setBusy(true); await onConfirm(); setBusy(false) }} />}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <T tone="soft">All bills, items, customers and settings on this phone will be deleted. Type <T tone="danger" style={{ fontFamily: 'Inter_600SemiBold' }}>{name}</T> to confirm.</T>
        <Field value={typed} onChangeText={setTyped} placeholder={name} autoCapitalize="none" autoCorrect={false} />
      </View>
    </Sheet>
  )
}

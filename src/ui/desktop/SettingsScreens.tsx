import React from 'react'
import { View } from 'react-native'
import type { Category, Coupon, OutboxEntry, Role, StoreSettings, User } from '@/domain/types'
import type { ReceiptOptions } from '@/domain/receipt'
import type { IndustryPack } from '@/industries/types'
import { INDUSTRIES } from '@/industries'
import { timeAgo, fmtDate } from '@/domain/dates'
import { num } from '@/domain/money'
import { ROLE_HELP, ROLE_LABEL } from '@/domain/permissions'
import { unitPreset } from '@/domain/qty'
import { PackGlyph } from '@/features/packIcons'
import { Logo } from '@/features/Logo'
import { ReceiptPreview } from '@/features/ReceiptPreview'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Badge, Card, Group, IconWell, Tap } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import {
  Boxes, ChartColumn, Check, Cloud, Contrast, Database, Download, Moon, Plus, Printer, Receipt, Refresh,
  ShieldCheck, Sun, Tags, Ticket, Trash, Truck, Upload, Users, Wallet,
} from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

/**
 * The desktop layouts for every screen under `src/app/settings/`. Settings are forms and short management lists,
 * not data grids, so every one of these is `DesktopSettingsPage` (see `SettingsPage.tsx`) wrapped around the exact
 * same mobile building blocks (`Field`, `Section`, `Card`, `ListRow`, `SwitchRow`…) the phone screen already uses.
 * None of them hold their own state, validation or persistence: every value and handler is computed once, in the
 * phone route file, and passed down as props — this file only lays that same data out in a centred column instead
 * of a stacked full-width one. Kept together in one file because each screen here is small and the whole set
 * benefits from being reviewed and scanned as one feature.
 */

// ───────────────────────────── receipt.tsx ─────────────────────────────

export interface DesktopReceiptSettingsProps {
  format: 'thermal' | 'a4'; setFormat: (v: 'thermal' | 'a4') => void
  width: '58mm' | '80mm'; setWidth: (v: '58mm' | '80mm') => void
  autoPrint: boolean; setAutoPrint: (v: boolean) => void
  policy: string; setPolicy: (v: string) => void
  windowDays: string; setWindowDays: (v: string) => void
  footer: string; setFooter: (v: string) => void
  showTax: boolean; setShowTax: (v: boolean) => void
  showHsn: boolean; setShowHsn: (v: boolean) => void
  showSavings: boolean; setShowSavings: (v: boolean) => void
  showLoyalty: boolean; setShowLoyalty: (v: boolean) => void
  draft: StoreSettings
  opts: ReceiptOptions
  dirty: boolean
  onSave: () => void
  onTestPrint: () => void
}

export function DesktopReceiptSettings(p: DesktopReceiptSettingsProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Receipts" subtitle="What prints at the till and on a saved bill"
      right={<DeskButton label="Save changes" tone="primary" disabled={!p.dirty} onPress={p.onSave} />}>
      <Section title="What prints" style={{ marginTop: 0 }}>
        <Segmented<'thermal' | 'a4'> value={p.format} onChange={p.setFormat} options={[{ value: 'thermal', label: 'Thermal receipt' }, { value: 'a4', label: 'A4 tax invoice' }]} />
        <T v="caption" tone="mute" style={{ marginTop: 8 }}>What every one-tap &ldquo;Print&rdquo; sends — at the till, on a saved bill, and (if turned on below) the moment a sale is charged. Either one can also be sent as a PDF invoice from a bill&apos;s own page.</T>
      </Section>

      {p.format === 'thermal' ? (
        <Section title="Paper width">
          <Segmented<'58mm' | '80mm'> value={p.width} onChange={p.setWidth} options={[{ value: '58mm', label: '58 mm (small)' }, { value: '80mm', label: '80 mm (standard)' }]} />
        </Section>
      ) : null}

      <Section title="Preview">
        {p.format === 'thermal' ? (
          <View style={{ backgroundColor: c.sunken, borderRadius: 20, padding: 16 }}>
            <ReceiptPreview store={p.draft} opts={p.opts} />
          </View>
        ) : (
          <Card><T tone="mute">A4 invoices are formatted for full-page printing — the itemised GST tax invoice, with HSN summary, buyer details and an authorised-signatory line. Print a sample to see it.</T></Card>
        )}
        <View style={{ marginTop: 12 }}>
          <Button label={p.format === 'thermal' ? 'Print a test receipt' : 'Print a sample A4 invoice'} kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={p.onTestPrint} />
        </View>
      </Section>

      <Section title="At the till">
        <Card padded={false}>
          <SwitchRow title="Print automatically" subtitle="The moment a sale is charged — no extra tap" value={p.autoPrint} onChange={p.setAutoPrint} />
        </Card>
      </Section>

      <Section title="Wording">
        <View style={{ gap: 14 }}>
          <Field label="Return & exchange policy" value={p.policy} onChangeText={p.setPolicy} multiline hint="Printed at the bottom of every receipt" />
          <NumberField label="Returns accepted for (days)" value={p.windowDays} onChange={p.setWindowDays} hint="Later returns still work but are flagged. 0 means no limit." />
          <Field label="Thank-you note" value={p.footer} onChangeText={p.setFooter} />
        </View>
      </Section>

      <Section title="Extra lines">
        <Card padded={false}>
          <SwitchRow title="Tax breakup" subtitle="Taxable value, CGST and SGST" value={p.showTax} onChange={p.setShowTax} />
          <SwitchRow title="HSN summary" subtitle="Needed on a GST tax invoice" value={p.showHsn} onChange={p.setShowHsn} />
          <SwitchRow title="“You saved” line" subtitle="Total MRP minus what the customer paid" value={p.showSavings} onChange={p.setShowSavings} />
          <SwitchRow title="Loyalty points earned" subtitle="Shown when the customer earns points" value={p.showLoyalty} onChange={p.setShowLoyalty} />
        </Card>
      </Section>
      <T v="caption" tone="mute" style={{ marginTop: 18 }}>The A4 tax invoice always shows the full tax breakup and HSN summary.</T>
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── appearance.tsx ─────────────────────────────

export interface DesktopAppearanceSettingsProps {
  theme: 'system' | 'light' | 'dark'; setTheme: (v: 'system' | 'light' | 'dark') => void
  haptics: boolean; setHaptics: (v: boolean) => void
  appLock: boolean; bio: boolean | null
  onToggleLock: (v: boolean) => void
}

export function DesktopAppearanceSettings(p: DesktopAppearanceSettingsProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Appearance & security">
      <Section title="Theme" style={{ marginTop: 0 }}>
        <Segmented<'system' | 'light' | 'dark'> value={p.theme} onChange={p.setTheme} options={[
          { value: 'system', label: 'Auto', icon: <Contrast size={15} color={p.theme === 'system' ? c.ink : c.inkSoft} /> },
          { value: 'light', label: 'Light', icon: <Sun size={15} color={p.theme === 'light' ? c.ink : c.inkSoft} /> },
          { value: 'dark', label: 'Dark', icon: <Moon size={15} color={p.theme === 'dark' ? c.ink : c.inkSoft} /> },
        ]} />
        <T v="caption" tone="mute" style={{ marginTop: 8 }}>{p.theme === 'system' ? 'Follows your phone’s light or dark setting.' : p.theme === 'dark' ? 'Easier on the eyes in a dim shop or at night.' : 'Bright and paper-like — best in daylight.'} Text size follows your phone’s font setting.</T>
      </Section>

      <Section title="Feel">
        <Card padded={false}>
          <SwitchRow title="Haptic feedback" subtitle="A light tap when you press buttons and scan items" value={p.haptics} onChange={p.setHaptics} />
        </Card>
      </Section>

      <Section title="Security">
        <Card padded={false}>
          <SwitchRow title="App lock" subtitle={p.bio === false ? 'Set up a fingerprint, face or screen lock on your phone first' : 'Ask for fingerprint, face or phone PIN when the app opens or after 30 seconds away'} value={p.appLock} onChange={p.onToggleLock} disabled={p.bio === false && !p.appLock} />
        </Card>
        <T v="caption" tone="mute" style={{ marginTop: 8 }}>Staff PINs choose who is at the counter. App lock protects the business itself if the phone is lent, lost or left on the counter.</T>
      </Section>
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── data.tsx ─────────────────────────────

export interface DesktopDataSettingsProps {
  local: boolean
  wsName: string
  industryName: string
  storedWhere: string
  startedAt: string
  billsCount: number
  productsCount: number
  customersCount: number
  busy: boolean
  onExport: () => void
  onRestore: () => void
  onLeave: () => void
  eraseSheet: React.ReactNode
}

export function DesktopDataSettings(p: DesktopDataSettingsProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Data & backup">
      <Section title="Back up" style={{ marginTop: 0 }}>
        <Card>
          <T tone="soft">{p.local ? 'Everything lives on this computer, so a backup file is your safety net. Save it somewhere that is not this computer — Drive, email, a USB drive.' : 'Your business is safe on the server. A backup file is an extra copy you can keep.'}</T>
          <View style={{ marginTop: 14 }}><Button label="Export a backup file" size="lg" block icon={<Download size={19} color="#fff" />} onPress={p.onExport} /></View>
        </Card>
        <View style={{ marginTop: 10 }}><Notice tone="warning" title="Keep the file private" body="It holds every bill, customer and price — and, for an offline business, scrambled staff PINs." /></View>
      </Section>

      {p.local ? (
        <Section title="Restore">
          <Card>
            <T tone="soft">Moving to a new device or recovering from a reset? Pick a backup file made by this app. It replaces everything here.</T>
            <View style={{ marginTop: 14 }}><Button label="Restore from a backup file" kind="outline" block loading={p.busy} icon={<Upload size={18} color={c.ink} />} onPress={p.onRestore} /></View>
          </Card>
        </Section>
      ) : null}

      <Section title="This business">
        <Card>
          <KV k="Name" v={p.wsName} />
          <KV k="Industry" v={p.industryName} />
          <KV k="Stored" v={p.storedWhere} />
          <KV k="Started" v={p.startedAt} />
          <KV k="Bills · items · customers" v={`${num(p.billsCount)} · ${num(p.productsCount)} · ${num(p.customersCount)}`} />
        </Card>
      </Section>

      <Section title={p.local ? 'Erase' : 'Disconnect'}>
        <Card>
          <T tone="soft">{p.local ? 'Remove this business for good. Back it up first if you might need it again.' : 'Sign out and clear this device. The business stays on the server.'}</T>
          <View style={{ marginTop: 14 }}><Button label={p.local ? 'Erase this business' : 'Disconnect this device'} kind="danger" block icon={<Trash size={18} color={c.danger} />} onPress={p.onLeave} /></View>
        </Card>
      </Section>
      {p.eraseSheet}
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── tax.tsx ─────────────────────────────

export interface TaxTier { upto: string; rate: string }
export interface DesktopTaxSettingsProps {
  inclusive: boolean; setInclusive: (v: boolean) => void
  tiers: TaxTier[]
  updateTier: (i: number, patch: Partial<TaxTier>) => void
  removeTier: (i: number) => void
  addTier: () => void
  canAddTier: boolean
  topRate: string; setTopRate: (v: string) => void
  rowErrors: Array<string | null>
  topError: string | null
  tried: boolean
  sample: string; setSample: (v: string) => void
  demo: { rate: number; taxable: number; tax: number; cgst: number; sgst: number; gross: number } | null
  dirty: boolean
  onSave: () => void
  inr: (n: number, decimals?: number) => string
}

export function DesktopTaxSettings(p: DesktopTaxSettingsProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Tax & GST" subtitle="How GST is worked out at the till"
      right={<DeskButton label="Save changes" tone="primary" disabled={!p.dirty} onPress={p.onSave} />}>
      <Section title="Prices" style={{ marginTop: 0 }}>
        <Card padded={false}>
          <SwitchRow title="Prices include GST" subtitle={p.inclusive ? 'The price on the tag is what the customer pays. GST is worked out from it.' : 'Prices are before GST. GST is added on top at billing.'} value={p.inclusive} onChange={p.setInclusive} />
        </Card>
      </Section>

      <Section title="GST by price">
        <Card>
          <T v="caption" tone="soft" style={{ marginBottom: 14 }}>The rate is picked from the price of one piece after discount. Items or categories with their own GST rate ignore these.</T>
          <View style={{ gap: 14 }}>
            {p.tiers.map((t, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <View style={{ flex: 1.4 }}><MoneyField label={i === 0 ? 'Up to' : 'Above previous, up to'} value={t.upto} onChange={(v) => p.updateTier(i, { upto: v })} error={p.tried ? p.rowErrors[i] : null} /></View>
                <View style={{ flex: 1 }}><NumberField label="GST %" value={t.rate} onChange={(v) => p.updateTier(i, { rate: v })} decimals suffix="%" /></View>
                <View style={{ paddingTop: 24 }}><IconButton label="Remove this slab" tone="ghost" size={40} onPress={() => p.removeTier(i)}><Trash size={18} color={c.danger} /></IconButton></View>
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ flex: 1.4, minHeight: 50, justifyContent: 'center', paddingTop: 18 }}>
                <T v="bodyStrong" tone="soft">{p.tiers.length ? `Above ${p.inr(Number(p.tiers[p.tiers.length - 1].upto) || 0, 0)}` : 'All prices'}</T>
              </View>
              <View style={{ flex: 1 }}><NumberField label="GST %" value={p.topRate} onChange={p.setTopRate} decimals suffix="%" error={p.tried ? p.topError : null} /></View>
              <View style={{ width: 40 }} />
            </View>
          </View>
          {p.canAddTier ? <View style={{ marginTop: 16 }}><Button label="Add a price level" kind="soft" size="sm" icon={<Plus size={16} color={c.primary} />} onPress={p.addTier} /></View> : null}
        </Card>
      </Section>

      <Section title="Try it">
        <Card>
          <MoneyField label="Price of one piece" value={p.sample} onChange={p.setSample} />
          {p.demo ? (
            <View style={{ marginTop: 12 }}>
              <KV k="GST rate" v={`${p.demo.rate}%`} strong />
              <KV k="Before GST" v={p.inr(p.demo.taxable)} />
              <KV k="CGST + SGST" v={p.inr(p.demo.tax)} sub={`${p.inr(p.demo.cgst)} + ${p.inr(p.demo.sgst)}`} />
              <KV k="Customer pays" v={p.inr(p.demo.gross)} strong />
            </View>
          ) : null}
        </Card>
      </Section>
      <View style={{ marginTop: 18 }}>
        <Notice tone="warning" title="Confirm rates with your accountant" body="GST rules change. The defaults are a starting point for the industry you chose, not tax advice." />
      </View>
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── store.tsx ─────────────────────────────

export interface DesktopStoreSettingsProps {
  name: string; setName: (v: string) => void
  tagline: string; setTagline: (v: string) => void
  address: string; setAddress: (v: string) => void
  city: string; setCity: (v: string) => void
  phone: string; setPhone: (v: string) => void
  email: string; setEmail: (v: string) => void
  gstin: string; setGstin: (v: string) => void
  prefix: string; setPrefix: (v: string) => void
  nextNo: string; setNextNo: (v: string) => void
  connected: boolean
  taglinePlaceholder: string
  tried: boolean
  errors: { name: string | null; gstin: string | null; email: string | null; prefix: string | null; next: string | null }
  dirty: boolean
  onSave: () => void
}

export function DesktopStoreSettings(p: DesktopStoreSettingsProps) {
  return (
    <DesktopSettingsPage title="Business profile" subtitle="What prints at the top of every receipt"
      right={<DeskButton label="Save changes" tone="primary" disabled={!p.dirty} onPress={p.onSave} />}>
      <Section title="Shown on receipts" style={{ marginTop: 0 }}>
        <View style={{ gap: 14 }}>
          <Field label="Business name" value={p.name} onChangeText={p.setName} autoCapitalize="words" error={p.tried ? p.errors.name : null} />
          <Field label="Tagline (optional)" value={p.tagline} onChangeText={p.setTagline} placeholder={p.taglinePlaceholder} />
          <Field label="Address" value={p.address} onChangeText={p.setAddress} multiline />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Field label="City" value={p.city} onChangeText={p.setCity} autoCapitalize="words" /></View>
            <View style={{ flex: 1 }}><Field label="Phone" value={p.phone} onChangeText={p.setPhone} keyboardType="phone-pad" /></View>
          </View>
          <Field label="Email (optional)" value={p.email} onChangeText={p.setEmail} keyboardType="email-address" autoCapitalize="none" error={p.tried ? p.errors.email : null} />
        </View>
      </Section>

      <Section title="Tax">
        <Field label="GSTIN (optional)" value={p.gstin} onChangeText={(t) => p.setGstin(t.toUpperCase())} autoCapitalize="characters" maxLength={15} mono
          hint="Printed on tax invoices. Leave empty if you are not registered for GST." error={p.tried ? p.errors.gstin : null} />
      </Section>

      <Section title="Bill numbers">
        <View style={{ gap: 14 }}>
          <Field label="Invoice prefix" value={p.prefix} onChangeText={p.setPrefix} autoCapitalize="characters" mono maxLength={10} hint={`Bills read ${p.prefix.trim() || 'INV-'}0001, ${p.prefix.trim() || 'INV-'}0002…`} error={p.tried ? p.errors.prefix : null} />
          {p.connected ? (
            <Notice tone="primary" title="Numbers are kept per device" body="This business syncs with a server, so each device numbers its own bills (for example INV-M4X-0001). That way two devices can never use the same number." />
          ) : (
            <NumberField label="Next bill number" value={p.nextNo} onChange={p.setNextNo} hint="Set this to carry on from your paper bill book." error={p.tried ? p.errors.next : null} />
          )}
        </View>
      </Section>
      <T v="caption" tone="mute" style={{ marginTop: 18 }}>Changes apply to new receipts straight away. Bills already printed are not altered.</T>
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── categories.tsx ─────────────────────────────

export interface DesktopCategoriesProps {
  groups: Array<{ name: string; cats: Category[] }>
  counts: Map<string, number>
  labels: IndustryPack['labels']
  onNew: () => void
  onEdit: (cat: Category) => void
  categorySheet: React.ReactNode
}

export function DesktopCategories(p: DesktopCategoriesProps) {
  const { c } = useTheme()
  const total = p.groups.reduce((n, g) => n + g.cats.length, 0)
  return (
    <DesktopSettingsPage title="Categories" subtitle={`${total} ${total === 1 ? 'category' : 'categories'}`}
      right={<DeskButton label="New category" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onNew} />} maxWidth={620}>
      {p.groups.length ? (
        <View>
          {p.groups.map((g) => (
            <Section key={g.name || 'other'} title={g.name || 'Other'}>
              <Group>
                {g.cats.map((cat) => <ListRow key={cat.id} icon={<Tags size={19} color={c.primary} />} title={cat.name} subtitle={categorySummary(cat, p.counts.get(cat.id) ?? 0, p.labels.item)} onPress={() => p.onEdit(cat)} />)}
              </Group>
            </Section>
          ))}
        </View>
      ) : (
        <EmptyState icon={<Tags size={26} color={c.primary} />} title="No categories yet" hint={`Categories keep ${p.labels.items.toLowerCase()} organised and decide how each one is sold.`} action="Add a category" onAction={p.onNew} />
      )}
      {p.categorySheet}
    </DesktopSettingsPage>
  )
}

/** The exact same summary line `src/app/settings/categories.tsx`'s `summary()` builds — kept local (rather than
 * imported from that route file) only to avoid a circular import between it and this file; it calls the same
 * domain helper (`unitPreset`) the route file does, not a re-derived rule. */
function categorySummary(cat: Category, count: number, itemWord: string) {
  const cfg = cat.config ?? {}
  const unit = unitPreset(cfg.unit)
  return [
    unit && unit.code !== 'pc' ? `Sold by ${unit.label.toLowerCase()}` : null,
    cfg.trackStock === false ? 'No stock count' : null,
    cfg.gstRate !== undefined ? `GST ${cfg.gstRate}%` : null,
    `${count} ${count === 1 ? itemWord.toLowerCase() : itemWord.toLowerCase() + 's'}`,
  ].filter(Boolean).join(' · ')
}

// ───────────────────────────── staff.tsx ─────────────────────────────

export interface DesktopStaffProps {
  sorted: User[]
  me?: string
  labels: IndustryPack['labels']
  onNew: () => void
  onEdit: (u: User) => void
  staffSheet: React.ReactNode
}

const ROLES: Role[] = ['owner', 'manager', 'cashier']

export function DesktopStaff(p: DesktopStaffProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Staff & roles" subtitle={`${p.sorted.filter((u) => u.active).length} active`}
      right={<DeskButton label="Add person" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onNew} />}>
      <View style={{ gap: 14 }}>
        <Group>
          {p.sorted.map((u) => (
            <ListRow key={u.id} avatar={u.name} title={u.name} subtitle={`${ROLE_LABEL[u.role]}${u.code ? ` · ${p.labels.staff} no. ${u.code}` : ''}`}
              badge={u.id === p.me ? <Badge tone="primary">You</Badge> : !u.active ? <Badge>Inactive</Badge> : undefined} onPress={() => p.onEdit(u)} />
          ))}
        </Group>
        <Card flat>
          <T v="label" tone="soft" style={{ marginBottom: 8 }}>WHO CAN DO WHAT</T>
          {ROLES.map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 10, paddingVertical: 4 }}>
              <T v="bodyStrong" style={{ width: 76 }}>{ROLE_LABEL[r]}</T>
              <T v="caption" tone="soft" style={{ flex: 1 }}>{ROLE_HELP[r]}</T>
            </View>
          ))}
        </Card>
      </View>
      {p.staffSheet}
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── sync.tsx ─────────────────────────────

export interface DesktopSyncProps {
  connected: boolean
  statusLabel: string
  statusDetail: string
  statusCalm: boolean
  StatusIcon: React.ComponentType<{ size?: number; color?: string }>
  statusTone: string
  authenticated: boolean
  loginEmail?: string
  lastError?: string
  busy: boolean
  syncBusy: boolean
  onSyncNow: () => void
  onSignIn: () => void
  businessName: string
  serverHost: string
  signedInAs: string
  deviceTag?: string
  prefix: string
  pending: number
  oldestPendingAt?: number | null
  lastSyncedAt?: number | null
  lastPulledAt?: number | null
  rejected: OutboxEntry[]
  entityLabel: (o: OutboxEntry) => string
  onRetryRejected: () => void
  startedAt?: number
  billsCount: number
  productsCount: number
  customersCount: number
  onGoToBackup: () => void
  onMoveToServer: () => void
  syncSheets: React.ReactNode
}

export function DesktopSync(p: DesktopSyncProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Sync & connection">
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 0 }}>
        <IconWell size={46} tone={p.statusCalm ? (p.connected ? 'success' : 'default') : p.statusTone === c.danger ? 'danger' : 'warning'}><p.StatusIcon size={22} color={p.statusTone} /></IconWell>
        <View style={{ flex: 1 }}>
          <T v="h2">{p.statusLabel}</T>
          <T v="caption" tone="mute">{p.statusDetail}</T>
        </View>
      </Card>

      {p.connected ? (
        <>
          {!p.authenticated ? (
            <View style={{ marginTop: 12 }}>
              <Notice tone="warning" title="Your sign-in has expired" body={p.loginEmail ? `Enter the password for ${p.loginEmail} to carry on syncing. Nothing is lost meanwhile.` : 'Sign out and connect again to carry on syncing.'} action={p.loginEmail ? 'Sign in' : undefined} onAction={p.onSignIn} />
            </View>
          ) : null}
          {p.lastError && p.authenticated ? <View style={{ marginTop: 12 }}><Notice tone="danger" title="The last sync had a problem" body={p.lastError} /></View> : null}

          <View style={{ marginTop: 14 }}>
            <Button label={p.busy || p.syncBusy ? 'Syncing…' : 'Sync now'} size="lg" block loading={p.busy || p.syncBusy} icon={<Refresh size={19} color="#fff" />} onPress={p.onSyncNow} />
          </View>

          <Section title="Details">
            <Card>
              <KV k="Business" v={p.businessName} />
              <KV k="Server" v={p.serverHost} />
              <KV k="Signed in as" v={p.signedInAs} />
              <KV k="This device’s number series" v={p.deviceTag ?? '—'} sub={`Bills read ${p.prefix}${p.deviceTag ?? ''}-0001`} />
              <KV k="Waiting to upload" v={num(p.pending)} tone={p.pending ? 'warning' : undefined} sub={p.oldestPendingAt ? `oldest ${timeAgo(p.oldestPendingAt)}` : undefined} />
              <KV k="Last uploaded" v={p.lastSyncedAt ? timeAgo(p.lastSyncedAt) : 'Not yet'} />
              <KV k="Last downloaded" v={p.lastPulledAt ? timeAgo(p.lastPulledAt) : 'Not yet'} />
            </Card>
          </Section>

          {p.rejected.length ? (
            <Section title={`Not saved · ${p.rejected.length}`}>
              <View style={{ gap: 10 }}>
                <T v="caption" tone="soft">The server refused these changes, so they were set aside and the rest carried on. They stay on this device.</T>
                {p.rejected.slice(0, 12).map((o) => (
                  <Card key={o.id} flat>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T v="bodyStrong" style={{ flex: 1 }}>{p.entityLabel(o)}</T>
                      <Badge tone="danger">{o.attempts} {o.attempts === 1 ? 'try' : 'tries'}</Badge>
                    </View>
                    <T v="caption" tone="danger" style={{ marginTop: 4 }}>{o.lastError ?? 'Refused by the server'}</T>
                    <T v="micro" tone="mute" style={{ marginTop: 4 }}>Made {timeAgo(o.createdAt)}</T>
                  </Card>
                ))}
                {p.rejected.length > 12 ? <T v="caption" tone="mute">…and {p.rejected.length - 12} more.</T> : null}
                <Button label="Try them again" kind="soft" block loading={p.busy} onPress={p.onRetryRejected} />
              </View>
            </Section>
          ) : null}
        </>
      ) : (
        <>
          <View style={{ marginTop: 12 }}>
            <Notice tone="warning" icon={<Database size={20} color={c.warning} />} title="There is no backup but this device" body="Export a copy regularly. If this device is lost or reset, the business goes with it." action="Back up" onAction={p.onGoToBackup} />
          </View>
          <Section title="On this device">
            <Card>
              <KV k="Business" v={p.businessName} />
              <KV k="Started" v={p.startedAt ? fmtDate(p.startedAt) : '—'} />
              <KV k="Bills" v={num(p.billsCount)} />
              <KV k="Items" v={num(p.productsCount)} />
              <KV k="Customers" v={num(p.customersCount)} />
            </Card>
          </Section>
          <View style={{ marginTop: 14, gap: 10 }}>
            <T v="caption" tone="mute">To share one business between several devices, move it to a OneSync server. Your data then lives on the server and every device keeps working offline.</T>
            <Button label="Move to a server" kind="outline" block icon={<Cloud size={18} color={c.ink} />} onPress={p.onMoveToServer} />
          </View>
        </>
      )}
      {p.syncSheets}
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── about.tsx ─────────────────────────────

const MODULES = [
  { icon: Receipt, title: 'Billing', sub: 'Fast checkout, GST, returns, held bills, receipts' },
  { icon: Boxes, title: 'Stock', sub: 'Live counts, restock lists, physical counts, ledger' },
  { icon: Truck, title: 'Purchasing', sub: 'Goods received, supplier dues, price-later queue' },
  { icon: Users, title: 'People', sub: 'Customers, loyalty, store credit, staff roles' },
  { icon: Wallet, title: 'Money', sub: 'Expenses, day close, cash drawer' },
  { icon: ChartColumn, title: 'Reports', sub: 'Sales, GST, profit, items, staff — export as CSV' },
] as const

export interface DesktopAboutProps {
  pack: IndustryPack
  version: string
  demo: boolean
}

export function DesktopAbout(p: DesktopAboutProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="About">
      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 10 }}>
        <Logo size={72} />
        <T v="h1" style={{ marginTop: 8 }}>OneSyncERP</T>
        <T tone="mute">Version {p.version}</T>
        <T tone="soft" align="center" style={{ maxWidth: 340, marginTop: 4 }}>One app to bill, stock, buy and report — for the shop, counter or kitchen you run.</T>
      </View>

      <Section title="Set up for" style={{ marginTop: 0 }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: p.pack.tint + '22', alignItems: 'center', justifyContent: 'center' }}><PackGlyph icon={p.pack.icon} size={23} color={p.pack.tint} /></View>
            <View style={{ flex: 1 }}>
              <T v="h2">{p.pack.name}</T>
              <T v="caption" tone="mute">{p.pack.tagline}</T>
            </View>
          </View>
          <View style={{ gap: 8, marginTop: 14 }}>
            {p.pack.highlights.map((h) => (
              <View key={h} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <View style={{ paddingTop: 2 }}><Check size={16} color={c.success} /></View>
                <T style={{ flex: 1 }} tone="soft">{h}</T>
              </View>
            ))}
          </View>
        </Card>
        {p.pack.caveat ? <View style={{ marginTop: 10 }}><Notice tone="warning" title="Worth knowing" body={p.pack.caveat} /></View> : null}
        {p.demo ? <View style={{ marginTop: 10 }}><Notice tone="primary" title="You are looking at sample data" body="Everything here is made up so you can explore. Start a real business from the welcome screen when you are ready." /></View> : null}
      </Section>

      <Section title="What is inside">
        <Group>
          {MODULES.map((m) => <ListRow key={m.title} icon={<m.icon size={19} color={c.primary} />} title={m.title} subtitle={m.sub} dense />)}
        </Group>
      </Section>

      <Section title="Good to know">
        <Card flat>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <ShieldCheck size={18} color={c.primary} />
            <T style={{ flex: 1 }} tone="soft">Everything works without a connection. A business connected to a server uploads in the background and keeps selling if the network drops.</T>
          </View>
          <T v="caption" tone="mute" style={{ marginTop: 12 }}>GST rates and slabs are starting points for each industry, not tax advice — confirm them with your accountant. The billing and tax engine is shared with the Krishna Collection billing app, so a bill totals to the same paisa in both.</T>
        </Card>
      </Section>

      <T v="caption" tone="mute" align="center" style={{ marginTop: 22 }}>Made with Expo and React Native. Typefaces Manrope and Inter. Icons by Lucide.</T>
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── coupons.tsx ─────────────────────────────

type CouponStatus = { label: string; tone: 'success' | 'warning' | 'danger' | 'default' }

export interface DesktopCouponsProps {
  sorted: Coupon[]
  used: Map<string, number>
  statusOf: (c: Coupon, used: number) => CouponStatus
  onNew: () => void
  onEdit: (c: Coupon) => void
  couponSheet: React.ReactNode
  inr0: (n: number) => string
  fmtDate: (n: number) => string
}

export function DesktopCoupons(p: DesktopCouponsProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Coupons" subtitle="Discount codes cashiers can apply at checkout"
      right={<DeskButton label="New coupon" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onNew} />} maxWidth={620}>
      {p.sorted.length ? (
        <Group>
          {p.sorted.map((cp) => {
            const st = p.statusOf(cp, p.used.get(cp.code) ?? 0)
            const n = p.used.get(cp.code) ?? 0
            return (
              <ListRow key={cp.id} icon={<Ticket size={20} color={st.tone === 'success' ? c.success : c.inkMute} />} iconTone={st.tone === 'success' ? 'success' : 'default'}
                title={cp.code} subtitle={[cp.type === 'pct' ? `${cp.value}% off` : `${p.inr0(cp.value)} off`, cp.minBill > 0 ? `on bills over ${p.inr0(cp.minBill)}` : null, cp.expiresAt ? `until ${p.fmtDate(cp.expiresAt)}` : null].filter(Boolean).join(' · ')}
                meta={`Used ${n}${cp.maxUses > 0 ? ` of ${cp.maxUses}` : ''} ${n === 1 ? 'time' : 'times'}`} badge={<Badge tone={st.tone}>{st.label}</Badge>} onPress={() => p.onEdit(cp)} />
            )
          })}
        </Group>
      ) : (
        <EmptyState icon={<Ticket size={26} color={c.primary} />} title="No coupons yet" hint="Create a code like DIWALI10 that cashiers can apply at checkout." action="Create a coupon" onAction={p.onNew} />
      )}
      {p.couponSheet}
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── loyalty.tsx ─────────────────────────────

export interface DesktopLoyaltySettingsProps {
  earn: string; setEarn: (v: string) => void
  redeem: string; setRedeem: (v: string) => void
  maxDisc: string; setMaxDisc: (v: string) => void
  low: string; setLow: (v: string) => void
  basis: 'average' | 'latest'; setBasis: (v: 'average' | 'latest') => void
  errors: { earn: string | null; redeem: string | null; max: string | null; low: string | null }
  tried: boolean
  dirty: boolean
  onSave: () => void
  points: number
  worth: number
  earnPct: number
  inr: (n: number, decimals?: number) => string
}

export function DesktopLoyaltySettings(p: DesktopLoyaltySettingsProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Loyalty & rules"
      right={<DeskButton label="Save changes" tone="primary" disabled={!p.dirty} onPress={p.onSave} />}>
      <Section title="Loyalty points" style={{ marginTop: 0 }}>
        <Card>
          <View style={{ gap: 14 }}>
            <NumberField label="Points earned per ₹100 spent" value={p.earn} onChange={p.setEarn} decimals hint="0 turns loyalty off" error={p.tried ? p.errors.earn : null} />
            <NumberField label="Value of 1 point (₹)" value={p.redeem} onChange={p.setRedeem} decimals prefix="₹" error={p.tried ? p.errors.redeem : null} />
          </View>
          <View style={{ marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: c.primaryTint }}>
            <T v="caption" tone="soft">{p.earnPct > 0 ? `A ₹1,000 bill earns ${p.points} points, worth ${p.inr(p.worth, 0)} on the next bill — about ${(((p.worth || 0) / 1000) * 100).toFixed(1)}% back.` : 'Loyalty is off — customers earn no points.'}</T>
          </View>
        </Card>
      </Section>

      <Section title="Discounts">
        <NumberField label="Most a cashier may discount a bill (%)" value={p.maxDisc} onChange={p.setMaxDisc} decimals suffix="%" hint="Above this, a manager or owner has to approve." error={p.tried ? p.errors.max : null} />
      </Section>

      <Section title="Stock">
        <NumberField label="Low-stock warning level" value={p.low} onChange={p.setLow} hint="Given to new items. Each item can have its own." error={p.tried ? p.errors.low : null} />
      </Section>

      <Section title="Profit reports">
        <Segmented<'average' | 'latest'> value={p.basis} onChange={p.setBasis} options={[{ value: 'average', label: 'Average cost' }, { value: 'latest', label: 'Latest cost' }]} />
        <T v="caption" tone="mute" style={{ marginTop: 8 }}>{p.basis === 'average' ? 'Stock value and profit use the weighted average of everything you bought. Smoother, and what most accountants expect.' : 'Stock value and profit use what you paid on the most recent delivery.'}</T>
      </Section>
    </DesktopSettingsPage>
  )
}

// ───────────────────────────── industry.tsx ─────────────────────────────

export interface DesktopIndustryProps {
  current: IndustryPack
  onChoose: (p: IndustryPack) => void
}

export function DesktopIndustry(p: DesktopIndustryProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Industry" subtitle="Choose the words that fit your business">
      <View style={{ gap: 10 }}>
        <Notice tone="primary" title="Words only" body="This changes wording and suggestions. It never changes your data, prices or tax." />
        {INDUSTRIES.map((ip) => {
          const on = ip.id === p.current.id
          return (
            <Tap key={ip.id} onPress={() => p.onChoose(ip)} accessibilityLabel={`${ip.name}${on ? ', current' : ''}`}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: on ? 2 : 1, borderColor: on ? c.primary : c.line }}>
                <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: ip.tint + '1F', alignItems: 'center', justifyContent: 'center' }}>
                  <PackGlyph icon={ip.icon} size={24} color={ip.tint} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="bodyStrong">{ip.name}</T>
                  <T v="caption" tone="mute" numberOfLines={2}>{ip.labels.items} · {ip.labels.customers} · {ip.labels.sales}</T>
                </View>
                {on ? <Badge tone="primary" icon={<Check size={12} color={c.primary} />}>Current</Badge> : null}
              </Card>
            </Tap>
          )
        })}
      </View>
    </DesktopSettingsPage>
  )
}

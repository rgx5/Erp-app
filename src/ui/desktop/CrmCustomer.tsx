import React, { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Customer } from '@/domain/types'
import type { membershipOf } from '@/modules/crm/stats'
import { KIND_LABEL, slaLabel, slaState, STATUS_LABEL } from '@/modules/crm/tickets'
import type { CrmSettings, Ticket } from '@/modules/crm/types'
import { SLA_TONE, STATUS_TONE } from '@/modules/crm/ui/tones'
import { NotesSection, TasksSection } from '@/modules/crm/ui/Work'
import { Button } from '@/ui/Button'
import { Field, SwitchRow } from '@/ui/Inputs'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Close, Gift, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, SplitPane, Toolbar } from './kit'

export interface DesktopCustomerCrmProps {
  id: string
  customer: Customer
  manage: boolean
  mem: ReturnType<typeof membershipOf>
  cfg: CrmSettings
  tickets: Array<Pick<Ticket, 'id' | 'no' | 'subject' | 'status' | 'kind' | 'openedAt' | 'slaDue' | 'resolvedAt'>>
  now: number
  referrer: Customer | undefined
  onSetTags: (next: string[]) => void
  onInvite: () => void
  onUseCode: (code: string) => void
  onToggleMarketing: (allow: boolean) => void
}

/**
 * The desktop customer-relationship screen: a KPI strip (membership, spend), and — because there is no table of
 * line items here, just the tier, groups, referrals and tickets — a `SplitPane` with the ticket list in the main
 * pane and the rest of the record (groups, marketing, referrals) in a side panel, plus the exact `TasksSection`/
 * `NotesSection` the phone screen already uses. Every figure and handler is the same the phone
 * `crm/customer/[id].tsx` computes and passes down.
 */
export function DesktopCustomerCrm(p: DesktopCustomerCrmProps) {
  const { c } = useTheme()
  const router = useRouter()
  const [tag, setTag] = useState('')
  const [code, setCode] = useState('')
  const tags = p.customer.tags ?? []

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={p.customer.name}
          subtitle={p.customer.phone}
          right={<DeskButton label="Open customer page" onPress={() => router.push({ pathname: '/customers/[id]', params: { id: p.id } })} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Membership" value={p.mem.tier?.name ?? '—'} delta={p.mem.next ? `${inr(p.mem.toNext, 0)} more to ${p.mem.next.name}` : p.mem.tier?.perk} />
        <KpiTile label={`Spent in ${p.cfg.tierWindowDays} days`} value={inr(p.mem.spend, 0)} tone="primary" />
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ height: 30, borderBottomWidth: 1, borderBottomColor: c.lineStrong, backgroundColor: c.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 }}>
            <T style={[dtext.label, { color: c.inkMute }]}>Tickets · {p.tickets.length}</T>
            <Pressable onPress={() => router.push({ pathname: '/m/crm/tickets/new', params: { customerId: p.id } })}><T style={[dtext.cellStrong, { color: c.primary }]}>New</T></Pressable>
          </View>
          {p.tickets.length ? (
            <ScrollView style={{ flex: 1 }}>
              {p.tickets.slice(0, 50).map((t) => (
                <Pressable key={t.id} onPress={() => router.push({ pathname: '/m/crm/tickets/[id]', params: { id: t.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 44, borderBottomWidth: 1, borderBottomColor: c.line }}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <T style={dtext.cellStrong} numberOfLines={1}>{t.subject}</T>
                    <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{t.no} · {KIND_LABEL[t.kind]} · {fmtDayShort(t.openedAt)}</T>
                  </View>
                  <Pill tone={STATUS_TONE[t.status]} label={STATUS_LABEL[t.status]} />
                  <Pill tone={SLA_TONE[slaState(t, p.now)]} label={slaLabel(t, p.now)} />
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T style={[dtext.cell, { color: c.inkMute }]}>No complaints or claims.</T></View>
          )}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Groups</T>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {tags.map((t) => (
                <Pressable key={t} onPress={() => p.onSetTags(tags.filter((x) => x !== t))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: c.primaryTint }}>
                  <T style={[dtext.tiny, { color: c.primary }]}>{t}</T>
                  <Close size={11} color={c.primary} />
                </Pressable>
              ))}
              {!tags.length ? <T style={[dtext.tiny, { color: c.inkMute }]}>Not in any group.</T> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}><Field value={tag} onChangeText={setTag} placeholder="VIP, Wholesale, Bride…" autoCapitalize="words" /></View>
              <Button label="Add" kind="soft" icon={<Plus size={16} color={c.primary} />} disabled={!tag.trim()} onPress={() => { p.onSetTags([...tags, tag]); setTag('') }} />
            </View>
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <SwitchRow title="Send promotional messages" subtitle={p.customer.optOutMarketing ? 'Asked not to receive them — left out of campaigns' : 'Included in campaigns'} value={!p.customer.optOutMarketing} onChange={p.onToggleMarketing} />
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Referrals</T>
            <KV k="Their code" v={p.customer.referralCode ?? 'Not given yet'} />
            {p.referrer ? <KV k="Referred by" v={p.referrer.name} /> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Button label={p.customer.referralCode ? 'Share the code' : 'Give a code'} kind="soft" size="sm" icon={<Gift size={15} color={c.primary} />} onPress={p.onInvite} />
            </View>
            {!p.customer.referredBy && p.manage ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
                <View style={{ flex: 1 }}><Field label="Was referred? Enter the friend's code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" mono /></View>
                <Button label="Apply" kind="soft" disabled={!code.trim()} onPress={() => { p.onUseCode(code); setCode('') }} />
              </View>
            ) : null}
          </View>

          <TasksSection target={{ customerId: p.id }} />
          <NotesSection target={{ customerId: p.id }} />
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}

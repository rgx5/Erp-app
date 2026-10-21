import React, { useMemo, useState } from 'react'
import { Share, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip, Group, Tap } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Gift, Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { applyReferral, ensureReferralCode, setCustomerTags, setMarketingOptOut } from '@/modules/crm/ops'
import { referralInvite } from '@/modules/crm/referrals'
import { settingsOf } from '@/modules/crm/settings'
import { membershipOf, statsByCustomer, statsOf } from '@/modules/crm/stats'
import { KIND_LABEL, slaLabel, slaState, STATUS_LABEL, ticketsOfCustomer } from '@/modules/crm/tickets'
import { failWith } from '@/modules/crm/ui/forms'
import { SLA_TONE, STATUS_TONE } from '@/modules/crm/ui/tones'
import { NotesSection, TasksSection } from '@/modules/crm/ui/Work'

/** One customer's relationship record: tier, groups, referral code, tickets, tasks and the contact log. */
export default function CustomerCrm() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('customers')
  const manage = useCan('crm')
  const data = useApp((s) => s.data)
  const customer = data.customers[id]
  const [tag, setTag] = useState('')
  const [code, setCode] = useState('')
  const now = Date.now()
  const cfg = settingsOf(data)
  const mem = useMemo(() => membershipOf(statsOf(statsByCustomer(data), id), now, cfg), [data, id, now, cfg])
  const tickets = useMemo(() => ticketsOfCustomer(data, id), [data, id])

  if (!can) return <Screen title="Customer" back><T tone="mute">This is for people who use the billing counter.</T></Screen>
  if (!customer) return <Screen title="Not found" back><T tone="mute">This customer is no longer here.</T></Screen>
  const tags = customer.tags ?? []
  const referrer = customer.referredBy ? data.customers[customer.referredBy] : undefined
  const setTags = (next: string[]) => { try { perform((s, ctx) => setCustomerTags(s, id, next, ctx)) } catch (e) { failWith(e) } }

  async function invite() {
    try {
      const r = perform((s, ctx) => ensureReferralCode(s, id, ctx))
      await Share.share({ message: referralInvite(data.store?.name ?? 'our shop', customer!.name, r.code, cfg.refereeCredit) })
    } catch (e) { failWith(e) }
  }
  function useCode() {
    try { const r = perform((s, ctx) => applyReferral(s, id, code, ctx)); toast(`Referred by ${r.referrer.name}`, 'ok'); setCode('') } catch (e) { failWith(e) }
  }

  return (
    <Screen title={customer.name} subtitle={customer.phone} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <KV k="Membership" v={mem.tier?.name ?? '—'} strong sub={mem.next ? `${inr(mem.toNext, 0)} more to reach ${mem.next.name}` : undefined} />
          <KV k={`Spent in ${cfg.tierWindowDays} days`} v={inr(mem.spend, 0)} />
          {mem.tier?.perk ? <KV k="Perk" v={mem.tier.perk} /> : null}
          <View style={{ marginTop: 8 }}>
            <Button label="Open customer page" kind="ghost" size="sm" onPress={() => router.push({ pathname: '/customers/[id]', params: { id } })} />
          </View>
        </Card>

        <Section title="Groups" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {tags.map((t) => <Chip key={t} label={`${t}  ×`} selected onPress={() => setTags(tags.filter((x) => x !== t))} />)}
            {!tags.length ? <T tone="mute">Not in any group.</T> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}><Field value={tag} onChangeText={setTag} placeholder="VIP, Wholesale, Bride…" autoCapitalize="words" /></View>
            <Button label="Add" kind="soft" icon={<Plus size={16} color={c.primary} />} disabled={!tag.trim()} onPress={() => { setTags([...tags, tag]); setTag('') }} />
          </View>
        </Section>

        <SwitchRow title="Send promotional messages" subtitle={customer.optOutMarketing ? 'Asked not to receive them — left out of campaigns' : 'Included in campaigns'} value={!customer.optOutMarketing}
          onChange={(v) => { try { perform((s, ctx) => setMarketingOptOut(s, id, !v, ctx)) } catch (e) { failWith(e) } }} />

        <Section title="Referrals" style={{ marginTop: 0 }}>
          <Card>
            <KV k="Their code" v={customer.referralCode ?? 'Not given yet'} />
            {referrer ? <KV k="Referred by" v={referrer.name} /> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Button label={customer.referralCode ? 'Share the code' : 'Give a code'} kind="soft" size="sm" icon={<Gift size={15} color={c.primary} />} onPress={() => void invite()} />
            </View>
            {!customer.referredBy && manage ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
                <View style={{ flex: 1 }}><Field label="Was referred? Enter the friend's code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" mono /></View>
                <Button label="Apply" kind="soft" disabled={!code.trim()} onPress={useCode} />
              </View>
            ) : null}
          </Card>
        </Section>

        <Section title="Tickets" action="New" onAction={() => router.push({ pathname: '/m/crm/tickets/new', params: { customerId: id } })} style={{ marginTop: 0 }}>
          {tickets.length ? (
            <Group>
              {tickets.slice(0, 10).map((t) => (
                <Tap key={t.id} onPress={() => router.push({ pathname: '/m/crm/tickets/[id]', params: { id: t.id } })} style={{ padding: 14, gap: 4 }}>
                  <T v="bodyStrong" numberOfLines={1}>{t.subject}</T>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    <Badge tone={SLA_TONE[slaState(t, now)]}>{slaLabel(t, now)}</Badge>
                    <T v="caption" tone="mute">{t.no} · {KIND_LABEL[t.kind]} · {fmtDayShort(t.openedAt)}</T>
                  </View>
                </Tap>
              ))}
            </Group>
          ) : <T tone="mute">No complaints or claims.</T>}
        </Section>

        <TasksSection target={{ customerId: id }} />
        <NotesSection target={{ customerId: id }} />
      </View>
    </Screen>
  )
}

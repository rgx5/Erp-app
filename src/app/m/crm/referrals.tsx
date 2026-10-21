import React, { useMemo } from 'react'
import { Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group, Tap } from '@/ui/primitives'
import { EmptyState, KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Gift } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { ensureReferralCode, rewardReferral } from '@/modules/crm/ops'
import { referralInvite, referralRows, topReferrers } from '@/modules/crm/referrals'
import { settingsOf } from '@/modules/crm/settings'
import { membershipOf, statsByCustomer, statsOf } from '@/modules/crm/stats'
import { failWith } from '@/modules/crm/ui/forms'

/** Referral rewards waiting to be given, who brought whom, and the membership tiers customers have reached. */
export default function Referrals() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const manage = useCan('crm')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const cfg = settingsOf(data)
  const view = useMemo(() => {
    const rows = referralRows(data)
    const stats = statsByCustomer(data)
    const counts = new Map<string, number>()
    for (const cu of listOf(data.customers)) {
      const t = membershipOf(statsOf(stats, cu.id), now, cfg).tier?.name
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return { rows, top: topReferrers(rows).slice(0, 5), counts }
  }, [data, now, cfg])

  if (!can) return <Screen title="Referrals" back><T tone="mute">Referrals are for people who use the billing counter.</T></Screen>
  function reward(id: string) {
    try {
      const r = perform((s, ctx) => rewardReferral(s, id, ctx))
      toast(`Rewarded: ${inr(r.reward.referrerCredit, 0)} credit${r.reward.referrerPoints ? ` + ${r.reward.referrerPoints} points` : ''} to the referrer`, 'ok')
    } catch (e) { failWith(e) }
  }
  const ready = view.rows.filter((r) => r.ready)
  const amount = `${inr(cfg.referrerCredit, 0)} credit${cfg.referrerPoints ? ` + ${cfg.referrerPoints} points` : ''} to the referrer${cfg.refereeCredit ? `, ${inr(cfg.refereeCredit, 0)} to the new customer` : ''}`
  async function invite(customerId: string) {
    try {
      const r = perform((s, ctx) => ensureReferralCode(s, customerId, ctx))
      const cu = data.customers[customerId]
      await whatsApp(referralInvite(data.store?.name ?? 'our shop', cu.name, r.code, cfg.refereeCredit), cu.phone)
    } catch (e) { failWith(e) }
  }

  return (
    <Screen title="Referrals & membership" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <KV k="Reward" v={amount} />
          <KV k="Given after" v={`first ${inr(cfg.referralMinBill, 0)} of purchases`} />
          {manage ? <Button label="Change rewards" kind="ghost" size="sm" onPress={() => router.push('/m/crm/settings')} /> : null}
        </Card>

        <Section title={`Rewards ready (${ready.length})`} style={{ marginTop: 0 }}>
          {ready.length ? (
            <Group>
              {ready.map((r) => (
                <View key={r.referred.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Avatar name={r.referrer.name} size={36} />
                  <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{r.referrer.name}</T><T v="caption" tone="mute" numberOfLines={1}>brought {r.referred.name} · bought {inr(r.spend, 0)}</T></View>
                  {manage ? <Button label="Give" size="sm" onPress={() => reward(r.referred.id)} /> : <Badge tone="warning">Ask a manager</Badge>}
                </View>
              ))}
            </Group>
          ) : (
            <EmptyState compact icon={<Gift size={24} color={c.primary} />} title="Nothing to give yet" hint="Give a regular customer a code from their page. When a friend quotes it and buys, the reward shows up here." />
          )}
        </Section>

        {view.top.length ? (
          <Section title="Top referrers" style={{ marginTop: 0 }}>
            <Group>
              {view.top.map((t) => (
                <Tap key={t.referrer.id} onPress={() => router.push({ pathname: '/m/crm/customer/[id]', params: { id: t.referrer.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Avatar name={t.referrer.name} size={36} />
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{t.referrer.name}</T>
                  <T tone="mute">{t.count} brought · {t.rewarded} rewarded</T>
                  <Button label="Invite" kind="soft" size="sm" onPress={() => void invite(t.referrer.id)} />
                </Tap>
              ))}
            </Group>
          </Section>
        ) : null}

        <Section title="Membership tiers" style={{ marginTop: 0 }}>
          <Group>
            {[...cfg.tiers].reverse().map((t) => (
              <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
                <View style={{ flex: 1 }}><T v="bodyStrong">{t.name}</T><T v="caption" tone="mute">{t.minSpend ? `${inr(t.minSpend, 0)} in ${cfg.tierWindowDays} days` : 'Everyone'}{t.perk ? ` · ${t.perk}` : ''}</T></View>
                <T v="num">{view.counts.get(t.name) ?? 0}</T>
              </View>
            ))}
          </Group>
          <T v="caption" tone="mute" style={{ marginTop: 8 }}>A customer&apos;s tier follows what they spent over the last {cfg.tierWindowDays} days, so it rises and falls by itself. The perks are for you to honour at the counter — the bill does not change by tier.</T>
        </Section>
        <Button label="Share the how-it-works text" kind="ghost" size="sm" onPress={() => void Share.share({ message: `Refer a friend to ${data.store?.name ?? 'us'}: when they buy, you get ${amount}.` })} />
      </View>
    </Screen>
  )
}

import React, { useMemo } from 'react'
import { Pressable, ScrollView, Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { ensureReferralCode, rewardReferral } from '@/modules/crm/ops'
import { referralInvite, referralRows, topReferrers } from '@/modules/crm/referrals'
import { settingsOf } from '@/modules/crm/settings'
import { membershipOf, statsByCustomer, statsOf } from '@/modules/crm/stats'
import { failWith } from '@/modules/crm/ui/forms'
import { Button } from '@/ui/Button'
import { T } from '@/ui/Text'
import { Gift } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DeskPage, dtext, Pill, Toolbar } from './kit'

/**
 * The desktop Referrals & membership screen: the reward summary, the rewards-ready and top-referrers lists in the
 * main column, and the membership-tier breakdown in a side panel — instead of three stacked `Section`s. Reads its
 * own data directly, exactly like `DesktopPurchases`: every figure and handler (`rewardReferral`, `ensureReferralCode`)
 * is the same the phone `m/crm/referrals.tsx` calls.
 */
export function DesktopReferrals() {
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

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Referrals & membership" />}>
        <View style={{ padding: 20 }}><T tone="mute">Referrals are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

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
    <DeskPage toolbar={<Toolbar title="Referrals & membership" />}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ gap: 8 }}>
            <T style={[dtext.label, { color: c.inkMute }]}>{`Rewards ready (${ready.length})`}</T>
            {ready.length ? (
              <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
                {ready.map((r, i) => (
                  <View key={r.referred.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 48, backgroundColor: i % 2 ? c.surfaceAlt : 'transparent', borderBottomWidth: 1, borderBottomColor: c.line }}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <T style={dtext.cellStrong} numberOfLines={1}>{r.referrer.name}</T>
                      <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>brought {r.referred.name} · bought {inr(r.spend, 0)}</T>
                    </View>
                    {manage ? <Button label="Give" size="sm" onPress={() => reward(r.referred.id)} /> : <Pill tone="warning" label="Ask a manager" />}
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Gift size={20} color={c.primary} />
                <T style={[dtext.cell, { color: c.inkMute, flex: 1 }]}>Nothing to give yet. Give a regular customer a code from their page. When a friend quotes it and buys, the reward shows up here.</T>
              </View>
            )}
          </View>

          {view.top.length ? (
            <View style={{ gap: 8 }}>
              <T style={[dtext.label, { color: c.inkMute }]}>Top referrers</T>
              <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
                {view.top.map((t, i) => (
                  <View key={t.referrer.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 48, backgroundColor: i % 2 ? c.surfaceAlt : 'transparent', borderBottomWidth: 1, borderBottomColor: c.line }}>
                    <Pressable onPress={() => router.push({ pathname: '/m/crm/customer/[id]', params: { id: t.referrer.id } })} style={{ flex: 1 }}>
                      <T style={dtext.cellStrong} numberOfLines={1}>{t.referrer.name}</T>
                    </Pressable>
                    <T style={[dtext.tiny, { color: c.inkMute }]}>{t.count} brought · {t.rewarded} rewarded</T>
                    <Button label="Invite" kind="soft" size="sm" onPress={() => void invite(t.referrer.id)} />
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={{ width: 340, borderLeftWidth: 1, borderLeftColor: c.line, backgroundColor: c.bg }}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }}>
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 10 }}>
              <View style={{ gap: 2 }}>
                <T style={[dtext.label, { color: c.inkMute }]}>Reward</T>
                <T style={dtext.cell}>{amount}</T>
              </View>
              <View style={{ gap: 2 }}>
                <T style={[dtext.label, { color: c.inkMute }]}>Given after</T>
                <T style={dtext.cell}>{`first ${inr(cfg.referralMinBill, 0)} of purchases`}</T>
              </View>
              {manage ? <Button label="Change rewards" kind="ghost" size="sm" onPress={() => router.push('/m/crm/settings')} style={{ alignSelf: 'flex-start' }} /> : null}
            </View>

            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Membership tiers</T>
              {[...cfg.tiers].reverse().map((t) => (
                <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                  <View style={{ flex: 1 }}>
                    <T style={dtext.cellStrong}>{t.name}</T>
                    <T style={[dtext.tiny, { color: c.inkMute }]}>{t.minSpend ? `${inr(t.minSpend, 0)} in ${cfg.tierWindowDays} days` : 'Everyone'}{t.perk ? ` · ${t.perk}` : ''}</T>
                  </View>
                  <T style={dtext.num}>{view.counts.get(t.name) ?? 0}</T>
                </View>
              ))}
              <T style={[dtext.tiny, { color: c.inkMute, marginTop: 8 }]}>A customer&apos;s tier follows what they spent over the last {cfg.tierWindowDays} days, so it rises and falls by itself.</T>
            </View>

            <Button label="Share the how-it-works text" kind="ghost" size="sm" onPress={() => void Share.share({ message: `Refer a friend to ${data.store?.name ?? 'us'}: when they buy, you get ${amount}.` })} />
          </ScrollView>
        </View>
      </View>
    </DeskPage>
  )
}

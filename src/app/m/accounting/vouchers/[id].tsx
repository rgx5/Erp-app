import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { resolveAccount } from '@/modules/accounting/chart'
import { isLocked, isReversed, voucherDebit, VOUCHER_LABEL } from '@/modules/accounting/logic'
import { reverseVoucher } from '@/modules/accounting/ops'
import { useLedger } from '@/modules/accounting/ui/hooks'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Undo } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One voucher: its lines, and — if it was a mistake — a reversal. */
export default function VoucherPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('accounting')
  const v = useList('vouchers').find((x) => x.id === id)
  const original = useList('vouchers').find((x) => x.id === v?.reversesId)
  const data = useApp((s) => s.data)
  const ledger = useLedger()
  const customers = useList('customers'), suppliers = useList('suppliers')
  if (!can) return <Screen title="Voucher" back><T tone="mute">Vouchers are for the owner and managers.</T></Screen>
  if (!v) return <Screen title="Not found" back><T tone="mute">This voucher is no longer here.</T></Screen>
  const reversed = isReversed(data, v)
  const partyName = (t: string, pid: string) => (t === 'supplier' ? suppliers : customers).find((p) => p.id === pid)?.name ?? pid
  async function reverse() {
    if (!(await ask({ title: `Reverse ${v!.no}?`, message: 'A new journal voucher dated today will cancel its effect. The original stays on record.', confirm: 'Reverse', danger: true }))) return
    try { const r = perform((s, ctx) => reverseVoucher(s, v!.id, ctx)); toast('Reversed', 'ok'); router.replace({ pathname: '/m/accounting/vouchers/[id]', params: { id: r.voucher.id } }) }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not reverse it', 'err') }
  }
  return (
    <Screen title={v.no} subtitle={VOUCHER_LABEL[v.type]} back footer={!reversed && !v.reversesId && v.type !== 'closing' ? <Button label="Reverse this voucher" kind="danger" size="lg" block icon={<Undo size={18} color={c.danger} />} onPress={reverse} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {reversed ? <Badge tone="warning">Reversed</Badge> : null}
          {v.reversesId ? <Badge>Reversal</Badge> : null}
          {isLocked(data, v.date) ? <Badge tone="primary">Locked period</Badge> : null}
        </View>
        {reversed ? <Notice tone="warning" title="This voucher has been reversed" body="Its effect was cancelled by a later entry." /> : null}
        <Card>
          <KV k="Date" v={fmtDate(v.date)} />
          <KV k="Amount" v={inr(voucherDebit(v.lines), 2)} strong />
          {v.narration ? <KV k="Narration" v={v.narration} /> : null}
          {original ? <KV k="Reverses" v={original.no} /> : null}
        </Card>
        <Section title="Entries">
          <Card padded={false}>
            {v.lines.map((l, i) => {
              const acc = resolveAccount(ledger.chart, l.account)
              return (
                <View key={i} style={{ flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong" numberOfLines={1}>{acc ? `${acc.code}  ${acc.name}` : l.account}</T>
                    {l.party ? <T v="caption" tone="mute">{partyName(l.party.type, l.party.id)}</T> : null}
                  </View>
                  <View style={{ width: 96 }}><T v="caption" tone="mute" align="right">Dr</T><T v="num" align="right">{l.debit ? inr(l.debit, 2) : ''}</T></View>
                  <View style={{ width: 96 }}><T v="caption" tone="mute" align="right">Cr</T><T v="num" align="right">{l.credit ? inr(l.credit, 2) : ''}</T></View>
                </View>
              )
            })}
          </Card>
        </Section>
      </View>
    </Screen>
  )
}

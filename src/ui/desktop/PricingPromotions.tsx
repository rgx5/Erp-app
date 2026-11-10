import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { setPromotionActive } from '@/modules/pricing/ops'
import { describePromotion, describeSchedule, promoResults, promoStatus } from '@/modules/pricing/promotions'
import { PROMO_LABEL, type PromoKind } from '@/modules/pricing/types'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, type Column } from './kit'

const STATUS: Record<ReturnType<typeof promoStatus>, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'success' }, scheduled: { label: 'Scheduled', tone: 'primary' }, ended: { label: 'Ended', tone: 'default' }, off: { label: 'Off', tone: 'warning' },
}
const KIND_HINT: Record<PromoKind, string> = {
  buy_x_get_y: 'Buy 2 get 1 free, or the second at half price', bundle: 'A shirt and a tie together for one price',
  category_sale: '20% off all jeans', happy_hour: '10% off between 4 and 6 pm',
}
type Row = { id: string; name: string; kind: PromoKind; detail: string; schedule: string; status: ReturnType<typeof promoStatus> }
type ResultRow = { id: string; name: string; bills: number; discount: number; active: boolean | null }

/** The desktop promotions screen: the offers as one grid, and what each has taken off as a second grid — the
 * same `promoResults`/`promoStatus` figures the phone `m/pricing/promotions/index.tsx` already computes. */
export function DesktopPromotions() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pricing')
  const promos = useList('promotions')
  const bills = useList('bills')
  const [choosing, setChoosing] = useState(false)
  const now = Date.now()
  const results = useMemo(() => promoResults(bills), [bills])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Promotions" />}>
        <View style={{ padding: 20 }}><T tone="mute">Promotions are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const open = (id: string, kind?: PromoKind) => { setChoosing(false); router.push({ pathname: '/m/pricing/promotions/[id]', params: { id, ...(kind ? { kind } : {}) } }) }

  const rows: Row[] = [...promos].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name))
    .map((pr) => ({ id: pr.id, name: pr.name, kind: pr.kind, detail: describePromotion(pr), schedule: describeSchedule(pr), status: promoStatus(pr, now) }))
  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Promotion', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{PROMO_LABEL[r.kind]} · {r.detail}</T>
      </View>
    ) },
    { key: 'schedule', label: 'Schedule', width: 170, render: (r) => cellText(r.schedule) },
    { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => <Pill tone={STATUS[r.status].tone} label={STATUS[r.status].label} /> },
  ]

  const resultRows: ResultRow[] = results.map((r) => ({ id: r.id, name: r.name, bills: r.bills, discount: r.discount, active: promos.find((p) => p.id === r.id)?.active ?? null }))
  const resultColumns: Array<Column<ResultRow>> = [
    { key: 'name', label: 'Offer', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'bills', label: 'Bills', width: 80, align: 'right', sortValue: (r) => r.bills, render: (r) => cellNum(String(r.bills)) },
    { key: 'discount', label: 'Taken off', width: 110, align: 'right', sortValue: (r) => r.discount, render: (r) => cellNum(inr(r.discount, 0), true) },
    { key: 'toggle', label: '', width: 100, render: (r) => (r.active === null ? null : (
      <DeskButton label={r.active ? 'Switch off' : 'Switch on'} onPress={() => { try { perform((s, ctx) => setPromotionActive(s, r.id, !r.active, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not change', 'err') } }} />
    )) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Promotions"
          subtitle={`${promos.filter((p) => promoStatus(p, now) === 'running').length} running`}
          right={<DeskButton label="New promotion" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => setChoosing(true)} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Running" value={String(promos.filter((p) => promoStatus(p, now) === 'running').length)} tone="success" />
        <KpiTile label="Total offers" value={String(promos.length)} tone="primary" />
      </KpiStrip>

      <SplitPane>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} onRowPress={(r) => open(r.id)} emptyLabel="No promotions yet" />
        </View>
        <View style={{ flex: 1, margin: 14, gap: 8 }}>
          <T style={[dtext.label, { color: c.inkMute }]}>What they have taken off</T>
          <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable rows={resultRows} columns={resultColumns} emptyLabel="No bill has used a promotion yet" />
          </View>
        </View>
      </SplitPane>

      {choosing ? (
        <View style={{ position: 'absolute', right: 20, top: 66, width: 320, backgroundColor: c.surface, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 8, padding: 12, gap: 8, shadowOpacity: 0.12, shadowRadius: 12 }}>
          <T style={[dtext.label, { color: c.inkMute }]}>What kind of promotion?</T>
          {(Object.keys(PROMO_LABEL) as PromoKind[]).map((k) => (
            <View key={k} style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8 }}>
              <DeskButton label={PROMO_LABEL[k]} onPress={() => open('new', k)} />
              <T style={[dtext.tiny, { color: c.inkMute, marginTop: 4 }]}>{KIND_HINT[k]}</T>
            </View>
          ))}
          <DeskButton label="Cancel" onPress={() => setChoosing(false)} />
        </View>
      ) : null}
    </DeskPage>
  )
}

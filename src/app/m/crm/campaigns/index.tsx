import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Megaphone, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { campaignProgress, sendsOf } from '@/modules/crm/campaigns'

/** Campaigns: a message built for a segment and worked through one customer at a time. */
export default function Campaigns() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('crm')
  const list = useList('crmCampaigns')
  const data = useApp((s) => s.data)
  if (!can) return <Screen title="Campaigns" back><T tone="mute">Campaigns are for the owner and managers.</T></Screen>
  const rows = [...list].sort((a, b) => b.createdAt - a.createdAt)
  return (
    <Screen title="Campaigns" back right={<IconButton label="New campaign" tone="dark" onPress={() => router.push('/m/crm/campaigns/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ paddingBottom: 24, gap: 12 }}>
        {rows.length ? (
          <Group>
            {rows.map((x) => {
              const p = campaignProgress(sendsOf(data, x.id))
              return (
                <ListRow key={x.id} icon={<Megaphone size={20} color="#fff" />} iconTone={x.closedAt ? 'success' : 'warning'} title={x.name} subtitle={`${x.no} · ${x.audienceName} · ${fmtDayShort(x.createdAt)}`}
                  badge={x.closedAt ? <Badge tone="success">Done</Badge> : <Badge tone="warning">{p.pending} left</Badge>} value={`${p.sent}/${p.total}`} sub="sent"
                  onPress={() => router.push({ pathname: '/m/crm/campaigns/[id]', params: { id: x.id } })} />
              )
            })}
          </Group>
        ) : (
          <EmptyState icon={<Megaphone size={26} color={c.primary} />} title="No campaigns yet" hint="Pick a segment, write a message with the customer's name in it, and send it one WhatsApp at a time." action="New campaign" onAction={() => router.push('/m/crm/campaigns/new')} />
        )}
        <T v="caption" tone="mute">Each message opens in WhatsApp or your messages app with the text ready; you press send. Sending to many people automatically needs the WhatsApp Business service or an SMS provider, set up on a server.</T>
      </View>
    </Screen>
  )
}

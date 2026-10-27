import React, { useMemo, useState } from 'react'
import { Share as RNShare, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import type { Bill, Customer } from '@/domain/types'
import { perform, useApp } from '@/data/store'
import { whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Badge, Card } from '@/ui/primitives'
import { ListRow, Section } from '@/ui/blocks'
import { Contact, Link, MessageCircle, Share as ShareIcon } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { markLinkSent } from '../ops'
import { openTasks } from '../tasks'
import { invoiceMessage } from '../share'
import { settingsOf } from '../settings'
import { membershipOf, statsByCustomer, statsOf } from '../stats'
import { isOpenTicket } from '../tickets'
import { useInvoiceLink, useKoshConnected } from './useShare'

/** On a customer's page: their tier, open tasks and tickets, and the way into their CRM record (notes, groups, referral code). */
export function CustomerCrmPanel({ customer }: { customer: Customer }) {
  const router = useRouter()
  const data = useApp((s) => s.data)
  const row = useMemo(() => {
    const cfg = settingsOf(data)
    const m = membershipOf(statsOf(statsByCustomer(data), customer.id), Date.now(), cfg)
    const tasks = openTasks(data).filter((t) => t.customerId === customer.id).length
    const tickets = Object.values(data.crmTickets ?? {}).filter((t) => t.customerId === customer.id && isOpenTicket(t)).length
    return { m, tasks, tickets }
  }, [data, customer.id])
  const bits = [row.m.tier ? row.m.tier.name : '', row.tasks ? `${row.tasks} open task${row.tasks === 1 ? '' : 's'}` : '', row.tickets ? `${row.tickets} open ticket${row.tickets === 1 ? '' : 's'}` : ''].filter(Boolean)
  return (
    <Section title="Relationship" style={{ marginTop: 6 }}>
      <Card padded={false}>
        <ListRow icon={<Contact size={20} color="#fff" />} title="Notes, tasks & tickets" subtitle={bits.join(' · ') || 'Add a note or a follow-up'}
          badge={row.tickets ? <Badge tone="warning">{row.tickets} open</Badge> : undefined}
          onPress={() => router.push({ pathname: '/m/crm/customer/[id]', params: { id: customer.id } })} />
      </Card>
    </Section>
  )
}

/** On a bill: a public link to the invoice made by the OneSync server, sent on WhatsApp. Only when connected to a OneSync server. */
export function BillSharePanel({ bill }: { bill: Bill }) {
  const { c } = useTheme()
  const connected = useKoshConnected()
  const shop = useApp((s) => s.data.store?.name ?? 'our shop')
  const customer = useApp((s) => (bill.customerId ? s.data.customers[bill.customerId] : undefined))
  const { saved, busy, get } = useInvoiceLink(bill.id)
  const [copied, setCopied] = useState(false)
  if (!connected || bill.refundOfBillId || bill.status === 'held') return null

  async function send(kind: 'whatsapp' | 'share') {
    try {
      const url = await get()
      const text = invoiceMessage(shop, bill, url, customer?.name)
      if (kind === 'whatsapp') await whatsApp(text, customer?.phone)
      else await RNShare.share({ message: text })
      perform((s, ctx) => markLinkSent(s, bill.id, ctx))
      setCopied(true)
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not make the link', 'err') }
  }
  return (
    <Section title="Invoice link" style={{ marginTop: 6 }}>
      <Card>
        <ListRow dense icon={<Link size={18} color="#fff" />} title={saved ? 'Link ready' : 'Share this invoice online'} subtitle={saved ? (saved.sentAt || copied ? 'Sent to the customer' : 'Not sent yet') : `${inr(bill.total, 0)} · opens as a web page, no sign-in`} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Button label="WhatsApp link" kind="success" size="sm" loading={busy} icon={<MessageCircle size={15} color="#fff" />} onPress={() => void send('whatsapp')} />
          <Button label="Share" kind="soft" size="sm" loading={busy} icon={<ShareIcon size={15} color={c.primary} />} onPress={() => void send('share')} />
        </View>
      </Card>
    </Section>
  )
}

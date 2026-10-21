// Pure half of the crm module: collections, permissions, effects. See docs/MODULES.md.
import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta, type Effect } from '@/replication/registry'
import type { ReferralReward } from './types'
import './types'

// Campaigns, segments, the programme's settings and rewards are the manager's. Notes, tasks, leads, tickets and feedback are for
// anyone at the counter (they already hold `customers`).
registerPermission('crm', ['manager'])

registerCollections(['crmSegments', 'crmLeads', 'crmTasks', 'crmNotes', 'crmCampaigns', 'crmSends', 'crmTickets', 'crmFeedback', 'referralRewards', 'invoiceLinks', 'crmSettings'])

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const text = (n: unknown) => typeof n === 'string' && n.trim().length > 0
const oneOf = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v)
const WORKERS = ['customers', 'crm']

registerCollectionMeta(
  {
    name: 'crmSegments', kind: 'master', perm: 'crm', readPerm: WORKERS,
    validate: (d) => (text(d.name) && Array.isArray(d.rules) && oneOf(d.match, ['all', 'any']) ? null : 'A segment needs a name and its rules'),
  },
  {
    name: 'crmLeads', kind: 'master', perm: WORKERS, branched: true,
    validate: (d) => (text(d.name) && oneOf(d.stage, ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']) ? null : 'A lead needs a name and a stage'),
  },
  {
    name: 'crmTasks', kind: 'master', perm: 'customers',
    validate: (d) => (text(d.title) && typeof d.done === 'boolean' ? null : 'A task needs a title'),
  },
  {
    name: 'crmNotes', kind: 'master', perm: 'customers',
    validate: (d) => (text(d.text) && finite(d.at) ? null : 'A note needs some text'),
  },
  {
    name: 'crmCampaigns', kind: 'master', perm: 'crm', readPerm: WORKERS,
    validate: (d) => (text(d.name) && text(d.template) && oneOf(d.channel, ['whatsapp', 'sms']) ? null : 'A campaign needs a name, a channel and a message'),
  },
  {
    name: 'crmSends', kind: 'master', perm: 'crm', readPerm: WORKERS,
    validate: (d) => (typeof d.campaignId === 'string' && typeof d.customerId === 'string' && oneOf(d.status, ['pending', 'sent', 'skipped']) ? null : 'A recipient needs a campaign, a customer and a status'),
  },
  {
    name: 'crmTickets', kind: 'master', perm: 'customers', branched: true,
    validate: (d) => (text(d.subject) && oneOf(d.kind, ['complaint', 'service', 'warranty']) && oneOf(d.status, ['open', 'in-progress', 'waiting', 'resolved', 'closed']) && finite(d.slaDue) ? null : 'A ticket needs a subject, a kind, a status and a due time'),
  },
  {
    name: 'crmFeedback', kind: 'ledger', perm: 'customers', readPerm: WORKERS, branched: true,
    validate: (d) => {
      const rated = finite(d.rating) && (d.rating as number) >= 1 && (d.rating as number) <= 5
      const scored = finite(d.nps) && (d.nps as number) >= 0 && (d.nps as number) <= 10
      return rated || scored ? null : 'Feedback needs a rating from 1 to 5 or a score from 0 to 10'
    },
  },
  {
    name: 'referralRewards', kind: 'ledger', perm: 'crm', readPerm: WORKERS, branched: true,
    validate: (d) => (typeof d.referrerId === 'string' && typeof d.referredId === 'string' && d.referrerId !== d.referredId && finite(d.referrerCredit) && finite(d.referrerPoints) && finite(d.refereeCredit)
      && (d.referrerCredit as number) >= 0 && (d.referrerPoints as number) >= 0 && (d.refereeCredit as number) >= 0 ? null : 'A referral reward needs two different customers and amounts that are not negative'),
    effects: (d) => rewardEffects(d as unknown as ReferralReward),
  },
  { name: 'invoiceLinks', kind: 'master', perm: 'pos', readPerm: ['pos', 'customers'], validate: (d) => (typeof d.billId === 'string' && text(d.url) ? null : 'A link needs its bill and address') },
  { name: 'crmSettings', kind: 'master', perm: 'crm', readPerm: 'any' },
)

/** A reward adds store credit and points (both are numbers the server already keeps for each customer) to the customer who referred, and credit to the one who was referred. */
export function rewardEffects(r: ReferralReward): Effect[] {
  const out: Effect[] = []
  if (r.referrerCredit > 0) out.push({ kind: 'inc', coll: 'customers', id: r.referrerId, field: 'storeCredit', by: r.referrerCredit })
  if (r.referrerPoints > 0) out.push({ kind: 'inc', coll: 'customers', id: r.referrerId, field: 'loyaltyPoints', by: r.referrerPoints })
  if (r.refereeCredit > 0) out.push({ kind: 'inc', coll: 'customers', id: r.referredId, field: 'storeCredit', by: r.refereeCredit })
  return out
}

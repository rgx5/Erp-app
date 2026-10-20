// ───────────────────────────── segments ─────────────────────────────

export type DatePeriod = 'today' | 'week' | 'month' | 'next-month'

/**
 * One condition on a customer, worked out from their bills. Spend and orders can be limited to the last `days`; recency is the
 * number of days since the last purchase (a customer who never bought does not match a recency rule — use `never`).
 */
export type SegmentRule =
  | { kind: 'spend'; min?: number; max?: number; days?: number }
  | { kind: 'orders'; min?: number; max?: number; days?: number }
  | { kind: 'recency'; minDays?: number; maxDays?: number }
  | { kind: 'never' }
  | { kind: 'birthday'; when: DatePeriod }
  | { kind: 'anniversary'; when: DatePeriod }
  | { kind: 'tag'; tag: string; not?: boolean }
  | { kind: 'points'; min: number }
  | { kind: 'dues'; min: number }
  | { kind: 'joined'; withinDays: number }
  | { kind: 'tier'; tier: string }

/** A saved customer segment: customers matching all (or any) of its rules. Membership is never stored — it is computed. */
export interface CustomerSegment {
  id: string
  name: string
  match: 'all' | 'any'
  rules: SegmentRule[]
  note: string
  createdAt: number
  updatedAt: number
  userId: string
}

// ───────────────────────────── leads, tasks, notes ─────────────────────────────

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost'

export interface Lead {
  id: string
  /** LD-0001 */
  no: string
  name: string
  phone: string
  email: string
  /** Where they came from: walk-in, referral, Instagram… */
  source: string
  stage: LeadStage
  /** What the deal may be worth. */
  value: number
  nextFollowUp?: number
  notes: string
  assignedTo?: string
  /** The customer this lead became (set when converted). */
  customerId?: string
  lostReason?: string
  createdAt: number
  updatedAt: number
  closedAt?: number
  userId: string
  branchId?: string
}

export type TaskKind = 'task' | 'call' | 'visit' | 'reminder'

/** A to-do or reminder, optionally about a customer, a lead or a ticket. */
export interface CrmTask {
  id: string
  title: string
  kind: TaskKind
  due?: number
  done: boolean
  doneAt?: number
  customerId?: string
  leadId?: string
  ticketId?: string
  assignedTo?: string
  notes: string
  createdAt: number
  userId: string
}

export type NoteKind = 'note' | 'call' | 'whatsapp' | 'sms' | 'visit' | 'email' | 'status'

/** A note or an entry in the communication log of a customer, lead or ticket. */
export interface CrmNote {
  id: string
  kind: NoteKind
  text: string
  at: number
  userId: string
  customerId?: string
  leadId?: string
  ticketId?: string
}

// ───────────────────────────── campaigns ─────────────────────────────

export type Channel = 'whatsapp' | 'sms'

export interface Campaign {
  id: string
  /** CP-0001 */
  no: string
  name: string
  channel: Channel
  /** The message with {{merge fields}}. */
  template: string
  /** Who it was built for: 'all', 'preset:lapsed' or a saved segment's id. */
  audience: string
  audienceName: string
  /** How many recipients the list had when it was built. */
  count: number
  createdAt: number
  userId: string
  closedAt?: number
}

export type SendStatus = 'pending' | 'sent' | 'skipped'

/** One recipient of a campaign: the finished message and whether it has gone. */
export interface CampaignSend {
  id: string
  campaignId: string
  customerId: string
  name: string
  phone: string
  text: string
  status: SendStatus
  at?: number
  userId?: string
  createdAt: number
}

// ───────────────────────────── tickets ─────────────────────────────

export type TicketKind = 'complaint' | 'service' | 'warranty'
export type TicketStatus = 'open' | 'in-progress' | 'waiting' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high'
export type WarrantyOutcome = 'repair' | 'replace' | 'refund' | 'rejected'

/** A complaint, an after-sales request or a warranty claim, with a due time for the first answer to be settled (the SLA). */
export interface Ticket {
  id: string
  /** TK-0001 */
  no: string
  kind: TicketKind
  status: TicketStatus
  priority: TicketPriority
  customerId?: string
  /** Kept on the ticket so it survives a walk-in with no customer record. */
  partyName: string
  partyPhone: string
  subject: string
  description: string
  billId?: string
  itemName?: string
  serial?: string
  openedAt: number
  /** The time by which it should be resolved. */
  slaDue: number
  resolvedAt?: number
  closedAt?: number
  resolution: string
  outcome?: WarrantyOutcome
  assignedTo?: string
  updatedAt: number
  userId: string
  branchId?: string
}

// ───────────────────────────── feedback, referrals, links, settings ─────────────────────────────

/** A rating after a sale: stars (1–5), a likelihood-to-recommend score (0–10), or both. Posted once. */
export interface Feedback {
  id: string
  customerId?: string
  billId?: string
  rating?: number
  nps?: number
  comment: string
  at: number
  source: 'counter' | 'whatsapp' | 'call'
  /** The complaint opened because of a low score, if any. */
  ticketId?: string
  userId: string
  branchId?: string
}

/**
 * The reward for a referral, posted once per referred customer (its id is made from theirs, so the server refuses a second
 * one however many phones try). Its effects add store credit and points to the people involved.
 */
export interface ReferralReward {
  id: string
  referrerId: string
  referredId: string
  referrerCredit: number
  referrerPoints: number
  refereeCredit: number
  date: number
  note: string
  userId: string
  branchId?: string
}

/** A public link to a bill's invoice made by the Kosh server (POST /share → GET /p/:token). */
export interface InvoiceLink {
  /** The bill's id. */
  id: string
  billId: string
  token: string
  url: string
  createdAt: number
  userId: string
  /** Last time it was sent to the customer. */
  sentAt?: number
}

export interface MembershipTier { name: string; minSpend: number; perk: string }

/** The shop's settings for this module (one document, id 'crm'). */
export interface CrmSettings {
  id: 'crm'
  /** Hours allowed to settle a ticket, by priority. */
  slaHours: { high: number; normal: number; low: number }
  /** How long a product is under warranty from the sale when nothing else is said. */
  warrantyMonths: number
  /** Membership tiers by spend in the last `tierWindowDays` days, lowest first. */
  tiers: MembershipTier[]
  tierWindowDays: number
  referrerCredit: number
  referrerPoints: number
  refereeCredit: number
  /** A referred customer must have bought for at least this much before the reward is due. */
  referralMinBill: number
}

declare module '@/data/state' {
  interface CollMap {
    crmSegments: CustomerSegment
    crmLeads: Lead
    crmTasks: CrmTask
    crmNotes: CrmNote
    crmCampaigns: Campaign
    crmSends: CampaignSend
    crmTickets: Ticket
    crmFeedback: Feedback
    referralRewards: ReferralReward
    invoiceLinks: InvoiceLink
    crmSettings: CrmSettings
  }
}

declare module '@/domain/types' {
  interface Customer {
    /** Groups the customer is in ("VIP", "Wholesale"). Set by the shop; segments can match on them. */
    tags?: string[]
    /** What this customer gives friends to quote when they first buy. */
    referralCode?: string
    /** The customer who referred this one. */
    referredBy?: string
    /** Asked not to receive promotional messages. Campaigns leave them out. */
    optOutMarketing?: boolean
  }
}

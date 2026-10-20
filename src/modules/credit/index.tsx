/**
 * Credit & collections — where it appears in the app. Customers buy on account (udhaar) with a due date, pay in parts, and the
 * shop chases what is late; gift cards and store credit are sold and spent at the till; UPI QR codes and links take payment.
 *   replication.ts  collections, effects (the customer's balance), permissions, posting rules (pure; the server loads it too)
 *   logic.ts / ops.ts / giftcards.ts / reminders.ts / reports.ts  rules, operations, text builders (pure; tested)
 *   hooks.ts        the bill hook: credit limit, gift-card spending
 *   this file       the Apps screen, checkout (pay on account / gift card), customer + bill panels, receipt lines, Home notice
 *   src/app/m/credit/…  its screens
 */
import React from 'react'
import { listOf } from '@/data/state'
import { Bell, ChartColumn, Gift, HandCoins, QrCode, Settings, ShoppingCart } from '@/ui/icons'
import { inr } from '@/domain/money'
import { registerBillHook, registerCheckoutPanel, registerModule, registerPanel, registerPaymentMethod, registerReceiptExtra } from '../registry'
import { findGiftCard, giftCardBalance, giftCodeOf } from './giftcards'
import { creditBillHook, receiptLines } from './hooks'
import { overdueNow } from './notices'
import { CreditCheckoutPanel } from './ui/CheckoutPanel'
import { BillCreditPanel, CustomerCreditPanel } from './ui/Panels'
import './replication'

registerModule({
  id: 'sales', name: 'Sales', tagline: 'Billing, orders, credit and pricing', icon: ShoppingCart, tone: 'primary', order: 10,
  features: [
    { id: 'credit-dues', label: 'Credit & dues', sub: 'Who owes what, collect payments, statements', icon: HandCoins, tone: 'warning', to: '/m/credit', perm: 'collections', section: 'Credit & collections',
      badge: (s) => overdueNow(s, Date.now()).customers || null },
    { id: 'credit-reminders', label: 'Payment reminders', sub: 'WhatsApp or SMS the customers who are late', icon: Bell, tone: 'warning', to: '/m/credit/reminders', perm: 'collections', section: 'Credit & collections' },
    { id: 'credit-gift-cards', label: 'Gift cards & store credit', sub: 'Sell cards and vouchers, top up credit', icon: Gift, tone: 'accent', to: '/m/credit/giftcards', perm: 'collections', section: 'Credit & collections' },
    { id: 'credit-upi-qr', label: 'UPI QR & payment link', sub: 'A QR for any amount, or a link to send', icon: QrCode, tone: 'primary', to: '/m/credit/qr', perm: 'pos', section: 'Credit & collections' },
    { id: 'credit-settings', label: 'Credit settings', sub: 'UPI id, days to pay, reminder wording', icon: Settings, tone: 'primary', to: '/m/credit/settings', perm: 'credit', section: 'Credit & collections' },
  ],
  reports: [
    { id: 'receivables-ageing', label: 'Receivables ageing', sub: 'What is owed, by how late it is', icon: ChartColumn, tone: 'warning', to: '/m/credit/ageing', group: 'Accounts', perm: 'reports' },
    { id: 'customer-statements', label: 'Customer statements', sub: 'Bills, returns and payments of one customer', icon: HandCoins, tone: 'primary', to: '/m/credit', group: 'Accounts', perm: 'reports' },
    { id: 'gift-card-liability', label: 'Gift cards outstanding', sub: 'Balance on cards still to be spent', icon: Gift, tone: 'accent', to: '/m/credit/giftcards', group: 'Accounts', perm: 'reports' },
  ],
  notices: [
    (s, now) => {
      const o = overdueNow(s, now)
      return o.customers
        ? { id: 'credit-overdue', tone: 'warning', title: `${inr(o.amount, 0)} is overdue from ${o.customers} ${o.customers === 1 ? 'customer' : 'customers'}`, body: 'Send them a reminder', action: 'Remind', to: '/m/credit/reminders' }
        : null
    },
  ],
})

// Ways to pay at checkout.
registerPaymentMethod({ id: 'due', label: 'On account', icon: HandCoins, order: 40, enabled: (s, cart) => !(cart.customerId && s.customerTerms?.[cart.customerId]?.blocked) })
registerPaymentMethod({ id: 'giftcard', label: 'Gift card', icon: Gift, order: 50, enabled: (s) => listOf(s.giftCards ?? {}).some((g) => g.active) })
registerCheckoutPanel({ id: 'credit', order: 30, component: CreditCheckoutPanel })

// Limit check and gift-card spending run in the bill's own transaction.
registerBillHook(creditBillHook)

// Printed bill: what is on account and when it is due; the card used and what is left on it.
registerReceiptExtra({
  id: 'credit',
  footer: (bill, state) => [
    ...receiptLines(bill, state),
    ...bill.payments.filter((p) => p.mode === 'giftcard').map((p) => {
      const card = findGiftCard(state, giftCodeOf(bill, p))
      return card ? `Balance on card: ${inr(giftCardBalance(state, card.id), 0)}` : ''
    }).filter(Boolean),
  ],
})

registerPanel({ id: 'credit.customer', slot: 'customer', order: 15, perm: 'collections', needsKosh: true, component: ({ customer }) => <CustomerCreditPanel customer={customer} /> })
registerPanel({ id: 'credit.bill', slot: 'bill', order: 15, perm: 'collections', needsKosh: true, component: ({ bill }) => <BillCreditPanel bill={bill} /> })

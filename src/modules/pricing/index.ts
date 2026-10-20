/**
 * Pricing — price lists and tiers, quantity breaks, promotions, B2B invoicing (GSTIN, place of supply, IGST, bill of supply),
 * e-invoice and e-way bill payloads, weighing-scale barcodes.
 *   replication.ts   collections and permissions (pure; the server loads it)
 *   register.ts      the cart adjusters, bill check and receipt lines (pure)
 *   this file        where it appears: the Sales app, the checkout section, the customer page, Home notices, the Reports hub
 *   src/app/m/pricing/…  its screens
 * Submitting to the government's portals (IRP, e-way bill) stops at the exported file: see einvoice.ts and eway.ts.
 */
import React from 'react'
import { listOf } from '@/data/state'
import { Barcode, BadgePercent, FileText, Layers, Scale, Tags, Truck } from '@/ui/icons'
import { registerCheckoutPanel, registerModule, registerPanel } from '../registry'
import { eInvoiceSkipReason } from './einvoice'
import { ewbNeeded } from './eway'
import { PricingCheckoutPanel } from './ui/CheckoutPanel'
import { CustomerPricing } from './ui/CustomerPricing'
import { eInvoiceId, ewayId } from './types'
import './register'
import './replication'

registerModule({
  id: 'sales', name: 'Sales', tagline: 'Billing, orders, credit and pricing', icon: Tags, tone: 'primary', order: 10,
  features: [
    { id: 'price-lists', label: 'Price lists & tiers', sub: 'Retail, wholesale and dealer prices', icon: Tags, tone: 'primary', to: '/m/pricing/lists', perm: 'pricing', section: 'Pricing' },
    { id: 'qty-breaks', label: 'Quantity breaks', sub: 'The more they buy, the less each costs', icon: Layers, tone: 'accent', to: '/m/pricing/breaks', perm: 'pricing', section: 'Pricing' },
    { id: 'promotions', label: 'Promotions', sub: 'Buy X get Y, bundles, sales, happy hour', icon: BadgePercent, tone: 'warning', to: '/m/pricing/promotions', perm: 'pricing', section: 'Pricing' },
    { id: 'b2b', label: 'GST invoices (B2B)', sub: 'IGST, e-invoice and e-way bill files', icon: FileText, tone: 'success', to: '/m/pricing/b2b', perm: 'pricing', section: 'GST' },
    { id: 'scale', label: 'Scale & price barcodes', sub: 'Labels that carry the weight or price', icon: Scale, tone: 'default', to: '/m/pricing/scale', perm: 'pricing', section: 'Pricing' },
  ],
  reports: [
    { id: 'b2b-register', label: 'B2B sales register', sub: 'Invoices to GST-registered buyers with the tax split', icon: FileText, tone: 'success', to: '/m/pricing/b2b', group: 'Tax', perm: 'reports' },
    { id: 'promo-results', label: 'Promotion results', sub: 'What each offer took off', icon: BadgePercent, tone: 'warning', to: '/m/pricing/promotions', group: 'Sales', perm: 'reports' },
  ],
  notices: [
    (s, now) => {
      if (!s.pricingSettings?.settings?.eInvoiceOn) return null
      const week = now - 7 * 86_400_000
      const todo = listOf(s.bills).filter((b) => b.date >= week && !b.refundOfBillId && b.total > 0 && !eInvoiceSkipReason(b, s.store, b.customerId ? s.customers[b.customerId] : null) && s.eInvoices?.[eInvoiceId(b.id)]?.status !== 'registered')
      const ewb = listOf(s.bills).filter((b) => b.date >= week && ewbNeeded(b, s.pricingSettings?.settings).needed && s.ewayBills?.[ewayId(b.id)]?.status !== 'generated' && !eInvoiceSkipReason(b, s.store, b.customerId ? s.customers[b.customerId] : null))
      if (!todo.length && !ewb.length) return null
      return { id: 'einvoice-todo', tone: 'warning', title: `${todo.length} invoice${todo.length === 1 ? '' : 's'} without an IRN${ewb.length ? ` · ${ewb.length} may need an e-way bill` : ''}`, body: 'From the last 7 days', action: 'Open', to: '/m/pricing/b2b' }
    },
  ],
})

registerCheckoutPanel({ id: 'pricing', order: 20, component: PricingCheckoutPanel })
registerPanel({ id: 'pricing.customer', slot: 'customer', order: 30, perm: 'customers', needsKosh: true, component: ({ customer }) => React.createElement(CustomerPricing, { customer }) })

void Barcode; void Truck

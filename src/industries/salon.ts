import type { IndustryPack, PackCategory } from './types'

const MAX = Number.MAX_SAFE_INTEGER

const svc = (id: string, name: string, group: string, prefix: string, extra: PackCategory['config'] = {}): PackCategory =>
  ({ id, name, group, config: { prefix, unit: 'svc', variantMode: 'plain', optionLabel: 'Types', trackStock: false, gstRate: 18, hsn: '9997', ...extra } })

export const salon: IndustryPack = {
  id: 'salon',
  name: 'Salon, Spa & Services',
  tagline: 'Salons, spas, clinics and any appointment-based service',
  icon: 'scissors',
  tint: '#D6409F',
  labels: {
    item: 'Service', items: 'Services', customer: 'Client', customers: 'Clients',
    option1: 'Type', option2: 'Variant', attr1: 'Duration', attr2: 'Notes', attr1Hint: '45 min', attr2Hint: 'Includes wash',
    sale: 'Invoice', sales: 'Invoices', newSale: 'New invoice', staff: 'Stylist', price: 'Price',
  },
  tax: { slabs: [{ upto: MAX, rate: 18 }], inclusive: true, hsnHint: 'Beauty services 9997', defaultHsn: '9997' },
  categories: [
    svc('cat_s_hair', 'Hair Services', 'Services', 'HR'),
    svc('cat_s_skin', 'Skin & Facials', 'Services', 'SK'),
    svc('cat_s_nail', 'Nails', 'Services', 'NL'),
    svc('cat_s_spa', 'Spa & Massage', 'Services', 'SP'),
    svc('cat_s_bridal', 'Bridal & Packages', 'Packages', 'BR'),
    { id: 'cat_s_retail', name: 'Retail Products', group: 'Retail', config: { prefix: 'RT', unit: 'pc', variantMode: 'plain', optionLabel: 'Sizes', gstRate: 18, hsn: '3305', reorderLevel: 3 } },
  ],
  groupOrder: ['Services', 'Packages', 'Retail'],
  settings: {
    returnPolicy: 'Services are non-refundable. If you are unhappy, tell us within 24 hours and we will redo it free of charge.',
    footerNote: 'Thank you for visiting! Book your next appointment with us.',
    loyaltyEarnPct: 5, loyaltyRedeemValue: 1, maxCashierDiscountPct: 15, lowStockDefault: 3, returnWindowDays: 1, priceIncludesTax: true,
  },
  expenseCategories: ['Rent', 'Salary', 'Commission', 'Products & supplies', 'Electricity', 'Laundry', 'Marketing', 'GST / Taxes', 'Misc'],
  stockReasons: ['Used in service', 'Damaged', 'Expired', 'Sample', 'Counting correction', 'Other'],
  returnReasons: ['Service redone', 'Billing error', 'Goodwill', 'Other'],
  highlights: ['Services never touch stock; retail products do', 'Stylist-wise sales and discount report', 'Loyalty points for repeat clients', 'Packages and add-ons as options'],
  caveat: 'Appointment booking and commission payouts are not included yet.',
  demo: {
    storeName: 'Glow Studio', city: 'Chennai', ownerName: 'Priya Natarajan', tagline: 'Hair • Skin • Nails • Spa',
    suppliers: [{ name: 'Salon Pro Supplies', gstin: '33AABCS3344R1ZK' }, { name: 'Beauty Depot' }],
    billsPerDay: [9, 20], lines: [1, 3], payMix: { cash: 0.2, upi: 0.6, card: 0.2 }, hours: [10, 20],
    items: [
      { name: 'Haircut', cat: 'cat_s_hair', attr1: '30 min', attr2: 'Includes wash', cost: 0, mrp: 0, price: 450, options: ['Men', 'Women', 'Kids'], optionPrice: [350, 650, 250], weight: 14 },
      { name: 'Hair Colour', cat: 'cat_s_hair', attr1: '90 min', attr2: 'Branded colour', cost: 600, mrp: 0, price: 2200, options: ['Root touch-up', 'Global colour', 'Highlights'], optionPrice: [1200, 2800, 3500], weight: 4 },
      { name: 'Hair Spa', cat: 'cat_s_hair', attr1: '60 min', attr2: '', cost: 350, mrp: 0, price: 1400, options: ['Regular', 'Premium'], optionPrice: [1100, 1800], weight: 5 },
      { name: 'Classic Facial', cat: 'cat_s_skin', attr1: '60 min', attr2: '', cost: 300, mrp: 0, price: 1200, options: ['Fruit', 'Gold', 'Anti-tan'], optionPrice: [900, 1800, 1300], weight: 6 },
      { name: 'Clean-up', cat: 'cat_s_skin', attr1: '30 min', attr2: '', cost: 150, mrp: 0, price: 600, options: ['Basic'], optionPrice: [600], weight: 6 },
      { name: 'Manicure', cat: 'cat_s_nail', attr1: '40 min', attr2: '', cost: 120, mrp: 0, price: 600, options: ['Classic', 'Gel polish'], optionPrice: [500, 900], weight: 4 },
      { name: 'Pedicure', cat: 'cat_s_nail', attr1: '50 min', attr2: '', cost: 150, mrp: 0, price: 800, options: ['Classic', 'Spa'], optionPrice: [700, 1100], weight: 4 },
      { name: 'Full Body Massage', cat: 'cat_s_spa', attr1: '60 min', attr2: '', cost: 200, mrp: 0, price: 2500, options: ['Relaxing', 'Deep tissue'], optionPrice: [2200, 2800], weight: 3 },
      { name: 'Bridal Makeup Package', cat: 'cat_s_bridal', attr1: '4 hours', attr2: 'Trial included', cost: 4500, mrp: 0, price: 18000, options: ['Standard', 'Premium'], optionPrice: [18000, 32000], weight: 0.6 },
      { name: 'Threading', cat: 'cat_s_skin', attr1: '10 min', attr2: '', cost: 0, mrp: 0, price: 60, options: ['Eyebrows', 'Upper lip', 'Full face'], optionPrice: [60, 30, 250], weight: 9 },
      { name: 'Keratin Shampoo', cat: 'cat_s_retail', brand: 'SalonPro', attr1: 'Retail', attr2: '', cost: 420, mrp: 899, price: 749, options: ['250 ml', '500 ml'], optionPrice: [749, 1299], stock: [4, 12], weight: 2 },
      { name: 'Argan Hair Serum', cat: 'cat_s_retail', brand: 'SalonPro', attr1: 'Retail', attr2: '', cost: 310, mrp: 699, price: 599, options: ['100 ml'], stock: [4, 12], weight: 2 },
    ],
    expenses: [
      { category: 'Rent', amount: [42000, 42000], every: 30, vendor: 'Landlord', mode: 'bank' },
      { category: 'Salary', amount: [96000, 104000], every: 30, mode: 'bank' },
      { category: 'Products & supplies', amount: [4500, 11000], every: 8, vendor: 'Salon Pro Supplies', mode: 'upi' },
      { category: 'Electricity', amount: [7600, 10400], every: 30, mode: 'upi' },
      { category: 'Laundry', amount: [600, 1400], every: 5, mode: 'cash' },
      { category: 'Marketing', amount: [2500, 8000], every: 15, mode: 'upi' },
    ],
  },
}

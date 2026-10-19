import type { IndustryPack, PackCategory } from './types'

const MAX = Number.MAX_SAFE_INTEGER

const c = (id: string, name: string, group: string, prefix: string, extra: PackCategory['config'] = {}): PackCategory =>
  ({ id, name, group, config: { prefix, unit: 'pc', variantMode: 'plain', optionLabel: 'Strengths / pack sizes', reorderLevel: 8, ...extra } })

export const pharmacy: IndustryPack = {
  id: 'pharmacy',
  name: 'Pharmacy & Medical',
  tagline: 'Chemists, medical stores, wellness and healthcare retail',
  icon: 'pill',
  tint: '#E5484D',
  labels: {
    item: 'Medicine', items: 'Medicines', customer: 'Patient', customers: 'Patients',
    option1: 'Strength / pack', option2: 'Form', attr1: 'Composition', attr2: 'Schedule', attr1Hint: 'Paracetamol 500 mg', attr2Hint: 'OTC, H, H1…',
    sale: 'Bill', sales: 'Bills', newSale: 'New bill', staff: 'Pharmacist', price: 'MRP',
  },
  tax: { slabs: [{ upto: MAX, rate: 12 }], inclusive: true, hsnHint: 'Medicaments 3003–3004, devices 9018–9022', defaultHsn: '3004' },
  categories: [
    c('cat_p_tab', 'Tablets & Capsules', 'Medicines', 'TB', { unit: 'strip', gstRate: 12, hsn: '3004', reorderLevel: 10 }),
    c('cat_p_syrup', 'Syrups & Liquids', 'Medicines', 'SY', { unit: 'bottle', gstRate: 12, hsn: '3004' }),
    c('cat_p_cream', 'Ointments & Gels', 'Medicines', 'OG', { gstRate: 12, hsn: '3004' }),
    c('cat_p_vit', 'Vitamins & Supplements', 'Wellness', 'VT', { unit: 'bottle', gstRate: 18, hsn: '2106' }),
    c('cat_p_dev', 'Devices & Monitors', 'Equipment', 'DV', { gstRate: 18, hsn: '9018', reorderLevel: 2 }),
    c('cat_p_aid', 'First Aid & Surgicals', 'Equipment', 'FA', { unit: 'pack', gstRate: 12, hsn: '3005' }),
    c('cat_p_baby', 'Baby & Mother Care', 'Personal Care', 'BM', { gstRate: 18, hsn: '3307' }),
    c('cat_p_care', 'Personal Care', 'Personal Care', 'PC', { gstRate: 18, hsn: '3304' }),
  ],
  groupOrder: ['Medicines', 'Wellness', 'Equipment', 'Personal Care'],
  settings: {
    returnPolicy: 'Medicines once sold cannot be returned. Sealed devices may be exchanged within 7 days with the bill.',
    footerNote: 'Get well soon. Always take medicines as prescribed.',
    loyaltyEarnPct: 0, loyaltyRedeemValue: 0, maxCashierDiscountPct: 10, lowStockDefault: 8, returnWindowDays: 7, priceIncludesTax: true,
  },
  expenseCategories: ['Rent', 'Salary', 'Electricity', 'Licence & compliance', 'Transport', 'Refrigeration', 'Marketing', 'GST / Taxes', 'Misc'],
  stockReasons: ['Expired', 'Damaged', 'Near expiry — returned to distributor', 'Sample', 'Counting correction', 'Other'],
  returnReasons: ['Wrong item dispensed', 'Doctor changed prescription', 'Damaged pack', 'Other'],
  highlights: ['Strip / bottle / tube units', 'Composition and schedule on each item', 'Distributor payables with due dates', 'Fast barcode scanning at the counter'],
  caveat: 'Batch numbers, expiry dates and prescription registers are not tracked yet — keep using your regulatory register for those.',
  demo: {
    storeName: 'Wellcare Medicals', city: 'Bengaluru', ownerName: 'Dr. Meena Rao', tagline: 'Your neighbourhood pharmacy',
    suppliers: [{ name: 'Lifeline Distributors', gstin: '29AAACL2211D1ZA' }, { name: 'Medico Wholesale', gstin: '29AABCM8899P1Z8' }, { name: 'HealthFirst Surgicals' }],
    billsPerDay: [28, 55], lines: [1, 4], payMix: { cash: 0.3, upi: 0.55, card: 0.15 }, hours: [8, 22],
    items: [
      { name: 'Paracetamol 500 mg', cat: 'cat_p_tab', brand: 'Pyrex-P', attr1: 'Paracetamol 500 mg', attr2: 'OTC', cost: 19, mrp: 32, price: 30, options: ['Strip of 10', 'Strip of 15'], optionPrice: [30, 44], stock: [20, 60], weight: 14 },
      { name: 'Cetirizine 10 mg', cat: 'cat_p_tab', brand: 'Allerfree', attr1: 'Cetirizine 10 mg', attr2: 'OTC', cost: 14, mrp: 26, price: 24, options: ['Strip of 10'], stock: [15, 50], weight: 9 },
      { name: 'Azithromycin 500 mg', cat: 'cat_p_tab', brand: 'Azicure', attr1: 'Azithromycin 500 mg', attr2: 'Schedule H', cost: 78, mrp: 132, price: 124, options: ['Strip of 3'], stock: [10, 30], weight: 4 },
      { name: 'Pantoprazole 40 mg', cat: 'cat_p_tab', brand: 'Pantocalm', attr1: 'Pantoprazole 40 mg', attr2: 'Schedule H', cost: 58, mrp: 112, price: 104, options: ['Strip of 10', 'Strip of 15'], optionPrice: [104, 152], stock: [12, 40], weight: 7 },
      { name: 'Metformin 500 mg', cat: 'cat_p_tab', brand: 'Glucon-M', attr1: 'Metformin 500 mg', attr2: 'Schedule H', cost: 22, mrp: 41, price: 38, options: ['Strip of 15'], stock: [15, 45], weight: 6 },
      { name: 'Oral Rehydration Salts', cat: 'cat_p_cream', brand: 'Hydrate+', attr1: 'ORS', attr2: 'OTC', cost: 14, mrp: 24, price: 22, options: ['Sachet', 'Pack of 5'], optionPrice: [22, 100], stock: [20, 60], weight: 6 },
      { name: 'Cough Syrup', cat: 'cat_p_syrup', brand: 'Coughrelief', attr1: 'Dextromethorphan', attr2: 'OTC', cost: 62, mrp: 98, price: 92, options: ['100 ml', '200 ml'], optionPrice: [92, 160], stock: [8, 24], weight: 7 },
      { name: 'Antacid Gel', cat: 'cat_p_syrup', brand: 'Digestwell', attr1: 'Aluminium hydroxide', attr2: 'OTC', cost: 78, mrp: 124, price: 116, options: ['170 ml'], stock: [8, 20], weight: 4 },
      { name: 'Pain Relief Gel', cat: 'cat_p_cream', brand: 'Flexi', attr1: 'Diclofenac', attr2: 'OTC', cost: 68, mrp: 118, price: 109, options: ['30 g', '50 g'], optionPrice: [109, 165], stock: [8, 20], weight: 5 },
      { name: 'Vitamin C 500 mg', cat: 'cat_p_vit', brand: 'Citrus-C', attr1: 'Ascorbic acid', attr2: 'OTC', cost: 96, mrp: 180, price: 165, options: ['Bottle of 60'], stock: [8, 20], weight: 4 },
      { name: 'Multivitamin', cat: 'cat_p_vit', brand: 'Vita-Daily', attr1: 'Multivitamin & minerals', attr2: 'OTC', cost: 188, mrp: 340, price: 310, options: ['Bottle of 30', 'Bottle of 60'], optionPrice: [310, 560], stock: [6, 16], weight: 3 },
      { name: 'Digital Thermometer', cat: 'cat_p_dev', brand: 'MediTech', attr1: 'Digital', attr2: '', cost: 105, mrp: 260, price: 220, options: ['Standard'], stock: [3, 10], weight: 2, gst: 18, hsn: '9025' },
      { name: 'BP Monitor', cat: 'cat_p_dev', brand: 'MediTech', attr1: 'Automatic upper arm', attr2: '1 year warranty', cost: 1250, mrp: 2200, price: 1899, options: ['Standard'], stock: [1, 4], weight: 1, hsn: '9018' },
      { name: 'Glucometer Strips', cat: 'cat_p_dev', brand: 'SugarCheck', attr1: 'Test strips', attr2: '', cost: 520, mrp: 899, price: 820, options: ['Pack of 50'], stock: [4, 12], weight: 3 },
      { name: 'Adhesive Bandage', cat: 'cat_p_aid', brand: 'FirstAid Pro', attr1: 'Waterproof', attr2: '', cost: 26, mrp: 48, price: 42, options: ['Pack of 20'], stock: [10, 30], weight: 4 },
      { name: 'Hand Sanitizer', cat: 'cat_p_care', brand: 'PureHands', attr1: '70% alcohol', attr2: '', cost: 78, mrp: 140, price: 125, options: ['200 ml', '500 ml'], optionPrice: [125, 270], stock: [8, 24], weight: 3, gst: 18 },
      { name: 'Baby Diapers', cat: 'cat_p_baby', brand: 'SoftCare', attr1: 'Medium', attr2: '', cost: 340, mrp: 599, price: 549, options: ['Pack of 44'], stock: [5, 14], weight: 3 },
    ],
    expenses: [
      { category: 'Rent', amount: [32000, 32000], every: 30, vendor: 'Landlord', mode: 'bank' },
      { category: 'Salary', amount: [58000, 62000], every: 30, mode: 'bank' },
      { category: 'Electricity', amount: [6500, 9200], every: 30, mode: 'upi' },
      { category: 'Licence & compliance', amount: [2500, 6500], every: 45, mode: 'bank' },
      { category: 'Transport', amount: [300, 1100], every: 6, mode: 'cash' },
      { category: 'Marketing', amount: [1200, 3500], every: 25, mode: 'upi' },
    ],
  },
}

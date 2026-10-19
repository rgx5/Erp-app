import type { IndustryPack, PackCategory } from './types'

const MAX = Number.MAX_SAFE_INTEGER

const c = (id: string, name: string, group: string, prefix: string, extra: PackCategory['config'] = {}): PackCategory =>
  ({ id, name, group, config: { prefix, unit: 'pc', variantMode: 'sizes', reorderLevel: 5, gstRate: 18, ...extra } })

export const hardware: IndustryPack = {
  id: 'hardware',
  name: 'Hardware & Building',
  tagline: 'Hardware, plumbing, electrical, paints and building materials',
  icon: 'hammer',
  tint: '#868E96',
  labels: {
    item: 'Product', items: 'Products', customer: 'Customer', customers: 'Customers',
    option1: 'Size / grade', option2: 'Colour / finish', attr1: 'Material', attr2: 'Brand grade', attr1Hint: 'PVC, copper, steel…', attr2Hint: 'ISI marked',
    sale: 'Invoice', sales: 'Invoices', newSale: 'New invoice', staff: 'Salesperson', price: 'Rate',
  },
  tax: { slabs: [{ upto: MAX, rate: 18 }], inclusive: true, hsnHint: 'Pipes 3917, wire 8544, paint 3208, fasteners 7318, cement 2523', defaultHsn: '7318' },
  categories: [
    c('cat_h_pipe', 'Pipes & Fittings', 'Plumbing', 'PP', { hsn: '3917' }),
    c('cat_h_pipem', 'Pipes (by metre)', 'Plumbing', 'PM', { unit: 'm', hsn: '3917', step: 0.5, minQty: 0.5, variantMode: 'plain', optionLabel: 'Sizes', reorderLevel: 30 }),
    c('cat_h_elec', 'Electricals', 'Electrical', 'EL', { hsn: '8536' }),
    c('cat_h_wire', 'Wires & Cables', 'Electrical', 'WR', { unit: 'm', hsn: '8544', step: 1, minQty: 1, variantMode: 'plain', optionLabel: 'Sizes', reorderLevel: 100 }),
    c('cat_h_paint', 'Paints', 'Finishing', 'PT', { unit: 'l', hsn: '3208', step: 0.5, minQty: 0.5, variantMode: 'sizes', reorderLevel: 4 }),
    c('cat_h_fast', 'Fasteners (by kg)', 'Hardware', 'FS', { unit: 'kg', hsn: '7318', step: 0.25, minQty: 0.25, variantMode: 'plain', optionLabel: 'Sizes', reorderLevel: 8 }),
    c('cat_h_tool', 'Hand & Power Tools', 'Hardware', 'TL', { hsn: '8205', variantMode: 'plain', optionLabel: 'Models', reorderLevel: 2 }),
    c('cat_h_cement', 'Cement & Building', 'Building', 'CM', { unit: 'bag', hsn: '2523', variantMode: 'plain', optionLabel: 'Grades', reorderLevel: 20 }),
    c('cat_h_sanit', 'Sanitaryware', 'Plumbing', 'SW', { hsn: '6910', variantMode: 'plain', optionLabel: 'Models', reorderLevel: 2 }),
  ],
  groupOrder: ['Plumbing', 'Electrical', 'Hardware', 'Finishing', 'Building'],
  settings: {
    returnPolicy: 'Unused, unopened goods in original packaging may be exchanged within 7 days. Cut-to-length items are not returnable.',
    footerNote: 'Thank you for your business. GST invoice available on request.',
    loyaltyEarnPct: 0, loyaltyRedeemValue: 0, maxCashierDiscountPct: 5, lowStockDefault: 5, returnWindowDays: 7, priceIncludesTax: true,
  },
  expenseCategories: ['Rent', 'Salary', 'Electricity', 'Freight & unloading', 'Godown', 'Marketing', 'Repairs', 'GST / Taxes', 'Misc'],
  stockReasons: ['Breakage', 'Rust / damage', 'Cut-length wastage', 'Lost / theft', 'Supplier return', 'Counting correction', 'Other'],
  returnReasons: ['Wrong size', 'Defective', 'Excess quantity', 'Other'],
  highlights: ['Sell by metre, kilo, litre, bag or piece', 'Cut-to-length wire and pipe in 0.5 m steps', 'GST invoices with HSN summary', 'Supplier payables with part-payments'],
  demo: {
    storeName: 'Patel Hardware & Paints', city: 'Ahmedabad', ownerName: 'Jignesh Patel', tagline: 'Everything for your build',
    suppliers: [{ name: 'Gujarat Pipes & Fittings', gstin: '24AAACG1100M1ZE' }, { name: 'Shree Electricals', gstin: '24AABCS5566Q1Z1' }, { name: 'Colour Craft Paints' }, { name: 'Ambuja Cement Dealer' }],
    billsPerDay: [10, 26], lines: [1, 4], payMix: { cash: 0.45, upi: 0.4, card: 0.15 }, hours: [9, 20],
    items: [
      { name: 'PVC Pipe', cat: 'cat_h_pipem', brand: 'AquaFlow', attr1: 'PVC', attr2: 'ISI', cost: 62, mrp: 110, price: 96, unit: 'm', options: ['½ inch', '¾ inch', '1 inch'], optionPrice: [96, 128, 175], stock: [60, 200], weight: 6, qty: [2, 12] },
      { name: 'CPVC Elbow', cat: 'cat_h_pipe', brand: 'AquaFlow', attr1: 'CPVC', attr2: 'ISI', cost: 14, mrp: 32, price: 26, options: ['½ inch', '¾ inch', '1 inch'], optionPrice: [26, 38, 52], stock: [30, 120], weight: 7 },
      { name: 'Ball Valve', cat: 'cat_h_pipe', brand: 'AquaFlow', attr1: 'Brass', attr2: 'ISI', cost: 118, mrp: 260, price: 215, options: ['½ inch', '¾ inch'], optionPrice: [215, 295], stock: [8, 30], weight: 4 },
      { name: 'Copper Wire', cat: 'cat_h_wire', brand: 'Voltex', attr1: 'Copper', attr2: 'FR', cost: 18, mrp: 32, price: 28, unit: 'm', options: ['1.0 sq mm', '1.5 sq mm', '2.5 sq mm'], optionPrice: [20, 28, 44], stock: [300, 900], weight: 6, qty: [5, 40] },
      { name: 'Modular Switch', cat: 'cat_h_elec', brand: 'Brightline', attr1: 'Polycarbonate', attr2: '', cost: 28, mrp: 62, price: 48, options: ['6A', '16A'], options2: ['White'], optionPrice: [48, 72], stock: [20, 80], weight: 8 },
      { name: 'LED Bulb 9W', cat: 'cat_h_elec', brand: 'Brightline', attr1: 'LED', attr2: '2 year warranty', cost: 42, mrp: 110, price: 85, options: ['Cool white', 'Warm white'], options2: ['B22'], stock: [20, 90], weight: 9 },
      { name: 'MCB 32A', cat: 'cat_h_elec', brand: 'Voltex', attr1: 'Single pole', attr2: 'ISI', cost: 155, mrp: 360, price: 295, options: ['Single pole', 'Double pole'], options2: ['32A'], optionPrice: [295, 540], stock: [6, 24], weight: 3 },
      { name: 'Interior Emulsion', cat: 'cat_h_paint', brand: 'Colour Craft', attr1: 'Acrylic', attr2: 'Premium', cost: 340, mrp: 520, price: 450, unit: 'l', options: ['1 L', '4 L', '10 L', '20 L'], options2: ['White', 'Ivory', 'Sky Blue'], optionPrice: [450, 1650, 3900, 7400], stock: [4, 14], weight: 5, qty: [1, 4] },
      { name: 'Wood Screws', cat: 'cat_h_fast', brand: '', attr1: 'Steel', attr2: '', cost: 140, mrp: 220, price: 190, unit: 'kg', options: ['1 inch', '1.5 inch', '2 inch'], stock: [10, 30], weight: 4, qty: [0.25, 1.5] },
      { name: 'Iron Nails', cat: 'cat_h_fast', brand: '', attr1: 'Iron', attr2: '', cost: 62, mrp: 95, price: 85, unit: 'kg', options: ['2 inch', '3 inch'], stock: [15, 40], weight: 4, qty: [0.5, 2] },
      { name: 'Claw Hammer', cat: 'cat_h_tool', brand: 'ToolMate', attr1: 'Steel', attr2: '', cost: 160, mrp: 380, price: 295, options: ['500 g', '750 g'], optionPrice: [295, 380], stock: [3, 9], weight: 2 },
      { name: 'Impact Drill 13 mm', cat: 'cat_h_tool', brand: 'PowerMax', attr1: 'Electric', attr2: '1 year', cost: 1850, mrp: 3290, price: 2690, options: ['550 W', '750 W'], optionPrice: [2690, 3490], stock: [2, 6], weight: 1 },
      { name: 'Portland Cement', cat: 'cat_h_cement', brand: 'Ambuja', attr1: 'OPC 53', attr2: '50 kg bag', cost: 345, mrp: 420, price: 395, unit: 'bag', options: ['OPC 53', 'PPC'], optionPrice: [395, 375], stock: [40, 160], weight: 5, qty: [2, 12] },
    ],
    expenses: [
      { category: 'Rent', amount: [28000, 28000], every: 30, vendor: 'Landlord', mode: 'bank' },
      { category: 'Godown', amount: [12000, 12000], every: 30, mode: 'bank' },
      { category: 'Salary', amount: [54000, 58000], every: 30, mode: 'bank' },
      { category: 'Freight & unloading', amount: [800, 5200], every: 4, mode: 'cash' },
      { category: 'Electricity', amount: [4800, 7200], every: 30, mode: 'upi' },
      { category: 'Marketing', amount: [1500, 4500], every: 30, mode: 'upi' },
    ],
  },
}

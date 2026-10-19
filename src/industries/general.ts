import type { IndustryPack, PackCategory } from './types'

const MAX = Number.MAX_SAFE_INTEGER

const c = (id: string, name: string, group: string, prefix: string, extra: PackCategory['config'] = {}): PackCategory =>
  ({ id, name, group, config: { prefix, unit: 'pc', variantMode: 'sizes', reorderLevel: 5, gstRate: 18, ...extra } })

/** For any retailer or wholesaler the other packs do not fit — a clean slate with sensible defaults. */
export const general: IndustryPack = {
  id: 'general',
  name: 'General Store & Wholesale',
  tagline: 'Stationery, gifts, kitchenware, wholesale — any product business',
  icon: 'store',
  tint: '#0CA678',
  labels: {
    item: 'Product', items: 'Products', customer: 'Customer', customers: 'Customers',
    option1: 'Size / type', option2: 'Colour', attr1: 'Material', attr2: 'Notes', attr1Hint: 'Steel, plastic…', attr2Hint: '',
    sale: 'Bill', sales: 'Bills', newSale: 'New bill', staff: 'Salesperson', price: 'Price',
  },
  tax: { slabs: [{ upto: 1000, rate: 12 }, { upto: MAX, rate: 18 }], inclusive: true, hsnHint: 'Use the HSN from your supplier invoice', defaultHsn: '' },
  categories: [
    c('cat_x_stat', 'Stationery', 'Office & School', 'ST', { gstRate: 12, hsn: '4820', variantMode: 'plain', optionLabel: 'Types' }),
    c('cat_x_toy', 'Toys & Games', 'Gifts & Fun', 'TY', { gstRate: 12, hsn: '9503' }),
    c('cat_x_gift', 'Gifts & Decor', 'Gifts & Fun', 'GF', { hsn: '9505', variantMode: 'plain', optionLabel: 'Designs' }),
    c('cat_x_kitchen', 'Kitchenware', 'Home', 'KW', { hsn: '7323' }),
    c('cat_x_cosm', 'Cosmetics', 'Personal Care', 'CS', { hsn: '3304', variantMode: 'plain', optionLabel: 'Shades' }),
    c('cat_x_misc', 'Other Goods', 'Home', 'OG', { variantMode: 'plain', optionLabel: 'Types' }),
  ],
  groupOrder: ['Office & School', 'Gifts & Fun', 'Home', 'Personal Care'],
  settings: {
    returnPolicy: 'Exchange within 7 days with the bill. No refund on sale items.',
    footerNote: 'Thank you for shopping with us!',
    loyaltyEarnPct: 1, loyaltyRedeemValue: 1, maxCashierDiscountPct: 10, lowStockDefault: 5, returnWindowDays: 7, priceIncludesTax: true,
  },
  expenseCategories: ['Rent', 'Salary', 'Electricity', 'Transport', 'Packaging', 'Marketing', 'Repairs', 'GST / Taxes', 'Misc'],
  stockReasons: ['Damaged', 'Lost / theft', 'Sample', 'Supplier return', 'Counting correction', 'Other'],
  returnReasons: ['Wrong item', 'Defective', 'Changed mind', 'Other'],
  highlights: ['Works for any product business', 'Price-slab or fixed GST per item', 'Wholesale-friendly purchase and payables tracking', 'Customise categories and units freely'],
  demo: {
    storeName: 'Anand General Store', city: 'Lucknow', ownerName: 'Sunil Anand', tagline: 'Stationery • Gifts • Home',
    suppliers: [{ name: 'Lucknow Paper House', gstin: '09AAACL6677B1ZH' }, { name: 'Toy Galaxy Wholesale' }, { name: 'Home Needs Traders', gstin: '09AABCH3300C1Z6' }],
    billsPerDay: [16, 36], lines: [1, 4], payMix: { cash: 0.38, upi: 0.5, card: 0.12 }, hours: [9, 21],
    items: [
      { name: 'Ruled Notebook', cat: 'cat_x_stat', brand: 'ClassMate', attr1: 'Paper', attr2: '', cost: 24, mrp: 55, price: 45, options: ['A5 · 120 pages', 'A4 · 160 pages'], optionPrice: [45, 78], stock: [20, 80], weight: 10 },
      { name: 'Ball Pen', cat: 'cat_x_stat', brand: 'InkFlow', attr1: 'Plastic', attr2: '', cost: 4, mrp: 10, price: 10, options: ['Blue', 'Black', 'Pack of 10'], optionPrice: [10, 10, 85], stock: [40, 160], weight: 12, gst: 12 },
      { name: 'Geometry Box', cat: 'cat_x_stat', brand: 'ClassMate', attr1: 'Metal', attr2: '', cost: 58, mrp: 140, price: 120, options: ['Standard'], stock: [6, 20], weight: 3 },
      { name: 'Building Blocks Set', cat: 'cat_x_toy', brand: 'PlayBox', attr1: 'Plastic', attr2: '3+ years', cost: 210, mrp: 599, price: 449, options: ['50 pcs', '120 pcs'], options2: ['Multicolour'], optionPrice: [449, 899], stock: [4, 14], weight: 4 },
      { name: 'Remote Control Car', cat: 'cat_x_toy', brand: 'PlayBox', attr1: 'Plastic', attr2: '6+ years', cost: 380, mrp: 1199, price: 849, options: ['Standard'], options2: ['Red', 'Blue'], stock: [3, 9], weight: 3 },
      { name: 'Photo Frame', cat: 'cat_x_gift', brand: 'Decora', attr1: 'Wood', attr2: '', cost: 95, mrp: 349, price: 249, options: ['5×7 inch', '8×10 inch'], optionPrice: [249, 399], stock: [5, 18], weight: 4 },
      { name: 'Scented Candle', cat: 'cat_x_gift', brand: 'Decora', attr1: 'Wax', attr2: '', cost: 72, mrp: 299, price: 199, options: ['Lavender', 'Vanilla', 'Sandalwood'], stock: [6, 20], weight: 5 },
      { name: 'Steel Water Bottle', cat: 'cat_x_kitchen', brand: 'HomeChef', attr1: 'Steel', attr2: '', cost: 140, mrp: 449, price: 329, options: ['500 ml', '1 L'], options2: ['Silver', 'Black'], optionPrice: [329, 449], stock: [4, 14], weight: 6 },
      { name: 'Non-stick Pan', cat: 'cat_x_kitchen', brand: 'HomeChef', attr1: 'Aluminium', attr2: '', cost: 310, mrp: 999, price: 749, options: ['24 cm', '28 cm'], options2: ['Black'], optionPrice: [749, 949], stock: [3, 10], weight: 3 },
      { name: 'Lipstick', cat: 'cat_x_cosm', brand: 'Glamour', attr1: 'Matte', attr2: '', cost: 85, mrp: 399, price: 299, options: ['Ruby', 'Nude', 'Berry', 'Coral'], stock: [6, 18], weight: 5 },
    ],
    expenses: [
      { category: 'Rent', amount: [22000, 22000], every: 30, vendor: 'Landlord', mode: 'bank' },
      { category: 'Salary', amount: [38000, 42000], every: 30, mode: 'bank' },
      { category: 'Electricity', amount: [3800, 5600], every: 30, mode: 'upi' },
      { category: 'Transport', amount: [300, 1200], every: 6, mode: 'cash' },
      { category: 'Packaging', amount: [400, 1400], every: 9, mode: 'cash' },
    ],
  },
}

import type { IndustryPack, PackCategory } from './types'

const MAX = Number.MAX_SAFE_INTEGER

const c = (id: string, name: string, group: string, prefix: string, extra: PackCategory['config'] = {}): PackCategory =>
  ({ id, name, group, config: { prefix, unit: 'pc', variantMode: 'sizes', reorderLevel: 2, gstRate: 18, ...extra } })

export const electronics: IndustryPack = {
  id: 'electronics',
  name: 'Electronics & Mobiles',
  tagline: 'Phones, accessories, appliances, laptops and repair services',
  icon: 'smartphone',
  tint: '#2F6BFF',
  labels: {
    item: 'Product', items: 'Products', customer: 'Customer', customers: 'Customers',
    option1: 'Storage / variant', option2: 'Colour', attr1: 'Model no.', attr2: 'Warranty', attr1Hint: 'SM-A155F', attr2Hint: '1 year',
    sale: 'Invoice', sales: 'Invoices', newSale: 'New invoice', staff: 'Salesperson', price: 'Price',
  },
  tax: { slabs: [{ upto: MAX, rate: 18 }], inclusive: true, hsnHint: 'Phones 8517, audio 8518, computers 8471, TVs 8528', defaultHsn: '8517' },
  categories: [
    c('cat_e_phone', 'Smartphones', 'Devices', 'SM', { hsn: '8517' }),
    c('cat_e_laptop', 'Laptops & Tablets', 'Devices', 'LT', { hsn: '8471', reorderLevel: 1 }),
    c('cat_e_tv', 'TV & Appliances', 'Home Electronics', 'TV', { hsn: '8528', variantMode: 'plain', optionLabel: 'Sizes / models', reorderLevel: 1 }),
    c('cat_e_audio', 'Audio & Wearables', 'Accessories', 'AU', { hsn: '8518', reorderLevel: 3 }),
    c('cat_e_acc', 'Mobile Accessories', 'Accessories', 'AC', { hsn: '8517', reorderLevel: 6 }),
    c('cat_e_svc', 'Repairs & Services', 'Services', 'RS', { unit: 'svc', hsn: '9987', trackStock: false, variantMode: 'plain', optionLabel: 'Types' }),
  ],
  groupOrder: ['Devices', 'Home Electronics', 'Accessories', 'Services'],
  settings: {
    returnPolicy: 'Replacement within 7 days for dead-on-arrival devices with box and invoice. Warranty as per manufacturer.',
    footerNote: 'Keep this invoice for warranty claims.',
    loyaltyEarnPct: 0.5, loyaltyRedeemValue: 1, maxCashierDiscountPct: 3, lowStockDefault: 2, returnWindowDays: 7, priceIncludesTax: true,
  },
  expenseCategories: ['Rent', 'Salary', 'Electricity', 'Transport', 'Marketing', 'Repairs', 'Packaging', 'GST / Taxes', 'Misc'],
  stockReasons: ['Demo unit', 'Damaged', 'Dead on arrival — returned', 'Lost / theft', 'Counting correction', 'Other'],
  returnReasons: ['Dead on arrival', 'Wrong model', 'Changed mind', 'Accessory incompatible', 'Other'],
  highlights: ['Storage × colour variants with unit-level barcode', 'Repair & service items that never touch stock', 'Warranty and model number on every item', 'High-ticket discount guard for cashiers'],
  caveat: 'IMEI / serial-number tracking is not included yet — warranty is recorded per item, not per unit.',
  demo: {
    storeName: 'Digital Plaza', city: 'Hyderabad', ownerName: 'Imran Qureshi', tagline: 'Phones • Laptops • Accessories',
    suppliers: [{ name: 'Mobile Hub Distribution', gstin: '36AAACM4455J1ZQ' }, { name: 'Techno Imports', gstin: '36AABCT7766H1Z9' }, { name: 'Accessory World' }],
    billsPerDay: [8, 20], lines: [1, 3], payMix: { cash: 0.15, upi: 0.5, card: 0.35 }, hours: [10, 21],
    items: [
      { name: 'Nova X5 Smartphone', cat: 'cat_e_phone', brand: 'Nova', attr1: 'NX5-2026', attr2: '1 year', cost: 11800, mrp: 16999, price: 14999, options: ['4GB / 64GB', '6GB / 128GB'], optionPrice: [14999, 17999], options2: ['Graphite', 'Ocean Blue'], stock: [2, 6], weight: 5 },
      { name: 'Pulse 9 Pro Smartphone', cat: 'cat_e_phone', brand: 'Pulse', attr1: 'P9P-256', attr2: '1 year', cost: 27800, mrp: 36999, price: 33999, options: ['8GB / 256GB', '12GB / 512GB'], optionPrice: [33999, 38999], options2: ['Midnight', 'Silver'], stock: [1, 4], weight: 2 },
      { name: 'Aero 14 Laptop', cat: 'cat_e_laptop', brand: 'Aero', attr1: 'AE14-i5', attr2: '1 year', cost: 41800, mrp: 57990, price: 52990, options: ['16GB / 512GB'], options2: ['Silver'], stock: [1, 3], weight: 1 },
      { name: 'Slate 10 Tablet', cat: 'cat_e_laptop', brand: 'Slate', attr1: 'SL10-W', attr2: '1 year', cost: 12400, mrp: 18999, price: 16499, options: ['4GB / 64GB', '6GB / 128GB'], optionPrice: [16499, 19499], options2: ['Grey'], stock: [1, 4], weight: 1.5 },
      { name: 'Vista 43″ Smart TV', cat: 'cat_e_tv', brand: 'Vista', attr1: 'V43-4K', attr2: '2 years', cost: 17200, mrp: 31999, price: 25999, options: ['43 inch', '55 inch'], optionPrice: [25999, 38999], stock: [1, 3], weight: 1 },
      { name: 'Wireless Earbuds', cat: 'cat_e_audio', brand: 'Pulse', attr1: 'PB-200', attr2: '1 year', cost: 780, mrp: 2999, price: 1799, options: ['Standard'], options2: ['Black', 'White'], stock: [4, 12], weight: 8 },
      { name: 'Smart Watch', cat: 'cat_e_audio', brand: 'Nova', attr1: 'NW-FIT', attr2: '1 year', cost: 1450, mrp: 4999, price: 2999, options: ['Standard'], options2: ['Black', 'Green'], stock: [3, 9], weight: 3 },
      { name: 'Fast Charger 33W', cat: 'cat_e_acc', brand: 'Nova', attr1: 'NC-33', attr2: '6 months', cost: 340, mrp: 1299, price: 799, options: ['USB-C'], options2: ['White'], stock: [8, 24], weight: 9 },
      { name: 'USB-C Cable 1 m', cat: 'cat_e_acc', brand: 'Linkit', attr1: 'LK-C1', attr2: '6 months', cost: 55, mrp: 399, price: 249, options: ['1 m', '2 m'], optionPrice: [249, 349], options2: ['Black'], stock: [12, 40], weight: 10 },
      { name: 'Tempered Glass', cat: 'cat_e_acc', brand: 'ShieldPro', attr1: '9H', attr2: '', cost: 22, mrp: 299, price: 149, options: ['Universal', 'Model specific'], optionPrice: [149, 199], options2: ['Clear'], stock: [20, 60], weight: 11 },
      { name: 'Phone Back Case', cat: 'cat_e_acc', brand: 'ShieldPro', attr1: 'Silicone', attr2: '', cost: 45, mrp: 499, price: 299, options: ['Universal'], options2: ['Black', 'Blue', 'Clear'], stock: [10, 30], weight: 7 },
      { name: 'Power Bank 10000 mAh', cat: 'cat_e_acc', brand: 'Linkit', attr1: 'LK-PB10', attr2: '1 year', cost: 780, mrp: 1999, price: 1399, options: ['10000 mAh', '20000 mAh'], optionPrice: [1399, 2299], options2: ['Black'], stock: [4, 12], weight: 5 },
      { name: 'Screen Replacement', cat: 'cat_e_svc', brand: '', attr1: 'Labour + part', attr2: '3 months', cost: 1500, mrp: 3500, price: 2999, options: ['Standard', 'Premium'], optionPrice: [2999, 4999], weight: 2, hsn: '9987' },
      { name: 'Software Update & Cleanup', cat: 'cat_e_svc', brand: '', attr1: 'Labour', attr2: '', cost: 0, mrp: 500, price: 399, options: ['Standard'], weight: 2, hsn: '9987' },
    ],
    expenses: [
      { category: 'Rent', amount: [55000, 55000], every: 30, vendor: 'Landlord', mode: 'bank' },
      { category: 'Salary', amount: [78000, 84000], every: 30, mode: 'bank' },
      { category: 'Electricity', amount: [8200, 11400], every: 30, mode: 'upi' },
      { category: 'Marketing', amount: [3000, 9000], every: 14, mode: 'upi' },
      { category: 'Packaging', amount: [600, 1800], every: 10, mode: 'cash' },
      { category: 'Transport', amount: [400, 1500], every: 7, mode: 'cash' },
    ],
  },
}

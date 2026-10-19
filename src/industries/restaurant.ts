import type { IndustryPack, PackCategory } from './types'

const MAX = Number.MAX_SAFE_INTEGER

/** Menu items are made to order, so nothing is counted in stock — except packaged drinks. */
const c = (id: string, name: string, group: string, prefix: string, extra: PackCategory['config'] = {}): PackCategory =>
  ({ id, name, group, config: { prefix, unit: 'plate', variantMode: 'plain', optionLabel: 'Portions', trackStock: false, gstRate: 5, hsn: '9963', ...extra } })

export const restaurant: IndustryPack = {
  id: 'restaurant',
  name: 'Restaurant & Café',
  tagline: 'Dine-in, takeaway, cloud kitchens and cafés',
  icon: 'utensils',
  tint: '#F59F00',
  labels: {
    item: 'Dish', items: 'Menu', customer: 'Guest', customers: 'Guests',
    option1: 'Portion', option2: 'Variant', attr1: 'Cuisine', attr2: 'Veg / Non-veg', attr1Hint: 'North Indian, Chinese…', attr2Hint: 'Veg',
    sale: 'Order', sales: 'Orders', newSale: 'New order', staff: 'Waiter', price: 'Price',
  },
  tax: { slabs: [{ upto: MAX, rate: 5 }], inclusive: false, hsnHint: 'Restaurant service 9963', defaultHsn: '9963' },
  categories: [
    c('cat_r_start', 'Starters', 'Food', 'ST'),
    c('cat_r_main', 'Main Course', 'Food', 'MC'),
    c('cat_r_bread', 'Breads', 'Food', 'BR', { unit: 'pc', optionLabel: 'Types' }),
    c('cat_r_rice', 'Rice & Biryani', 'Food', 'RB'),
    c('cat_r_dessert', 'Desserts', 'Food', 'DS', { unit: 'pc' }),
    c('cat_r_bev', 'Beverages', 'Drinks', 'BV', { unit: 'pc', optionLabel: 'Sizes' }),
    c('cat_r_pack', 'Packaged Drinks', 'Drinks', 'PD', { unit: 'bottle', trackStock: true, variantMode: 'plain', optionLabel: 'Sizes', reorderLevel: 12, gstRate: 18, hsn: '2202' }),
    c('cat_r_combo', 'Combos', 'Offers', 'CB', { optionLabel: 'Combos' }),
  ],
  groupOrder: ['Food', 'Drinks', 'Offers'],
  settings: {
    returnPolicy: 'Food once served cannot be returned. Please tell us within 15 minutes if something is wrong.',
    footerNote: 'Thank you for dining with us! Rate us on Google.',
    loyaltyEarnPct: 2, loyaltyRedeemValue: 1, maxCashierDiscountPct: 10, lowStockDefault: 12, returnWindowDays: 1, priceIncludesTax: false,
  },
  expenseCategories: ['Rent', 'Salary', 'Raw materials', 'Gas', 'Electricity', 'Delivery commission', 'Packaging', 'Repairs', 'GST / Taxes', 'Misc'],
  stockReasons: ['Spoilage', 'Staff meal', 'Complimentary', 'Breakage', 'Counting correction', 'Other'],
  returnReasons: ['Food quality', 'Wrong order', 'Long wait', 'Billing error', 'Other'],
  highlights: ['Half / Full portions with their own prices', 'Made-to-order items that never touch stock', 'Tax-exclusive pricing (5% GST added on top)', 'Waiter-wise sales report'],
  caveat: 'Table management, KOT printing and recipe-wise stock are not included yet.',
  demo: {
    storeName: 'Spice Route Kitchen', city: 'Mumbai', ownerName: 'Farhan Shaikh', tagline: 'Authentic flavours, every plate',
    suppliers: [{ name: 'Mumbai Fresh Veg', gstin: '27AABCM1212K1ZP' }, { name: 'Royal Masala Traders' }, { name: 'Coastal Seafood & Poultry', gstin: '27AAACC9090L1Z3' }],
    billsPerDay: [34, 78], lines: [2, 5], payMix: { cash: 0.2, upi: 0.6, card: 0.2 }, hours: [11, 23],
    items: [
      { name: 'Paneer Tikka', cat: 'cat_r_start', attr1: 'North Indian', attr2: 'Veg', cost: 95, mrp: 0, price: 240, options: ['Half', 'Full'], optionPrice: [140, 240], weight: 9 },
      { name: 'Chicken 65', cat: 'cat_r_start', attr1: 'South Indian', attr2: 'Non-veg', cost: 110, mrp: 0, price: 260, options: ['Half', 'Full'], optionPrice: [150, 260], weight: 8 },
      { name: 'Veg Spring Rolls', cat: 'cat_r_start', attr1: 'Chinese', attr2: 'Veg', cost: 70, mrp: 0, price: 180, options: ['Regular'], weight: 5 },
      { name: 'Butter Chicken', cat: 'cat_r_main', attr1: 'North Indian', attr2: 'Non-veg', cost: 130, mrp: 0, price: 340, options: ['Half', 'Full'], optionPrice: [210, 340], weight: 10 },
      { name: 'Dal Makhani', cat: 'cat_r_main', attr1: 'North Indian', attr2: 'Veg', cost: 62, mrp: 0, price: 220, options: ['Half', 'Full'], optionPrice: [130, 220], weight: 9 },
      { name: 'Paneer Butter Masala', cat: 'cat_r_main', attr1: 'North Indian', attr2: 'Veg', cost: 92, mrp: 0, price: 290, options: ['Half', 'Full'], optionPrice: [170, 290], weight: 9 },
      { name: 'Hyderabadi Chicken Biryani', cat: 'cat_r_rice', attr1: 'Hyderabadi', attr2: 'Non-veg', cost: 120, mrp: 0, price: 320, options: ['Half', 'Full'], optionPrice: [200, 320], weight: 12 },
      { name: 'Veg Biryani', cat: 'cat_r_rice', attr1: 'Hyderabadi', attr2: 'Veg', cost: 80, mrp: 0, price: 240, options: ['Half', 'Full'], optionPrice: [150, 240], weight: 6 },
      { name: 'Butter Naan', cat: 'cat_r_bread', attr1: 'Tandoor', attr2: 'Veg', cost: 12, mrp: 0, price: 55, options: ['Plain', 'Garlic'], optionPrice: [55, 65], weight: 14 },
      { name: 'Tandoori Roti', cat: 'cat_r_bread', attr1: 'Tandoor', attr2: 'Veg', cost: 6, mrp: 0, price: 28, options: ['Regular'], weight: 9 },
      { name: 'Gulab Jamun', cat: 'cat_r_dessert', attr1: 'Indian sweet', attr2: 'Veg', cost: 18, mrp: 0, price: 90, options: ['2 pcs', '4 pcs'], optionPrice: [90, 160], weight: 5 },
      { name: 'Masala Chai', cat: 'cat_r_bev', attr1: 'Hot', attr2: 'Veg', cost: 8, mrp: 0, price: 40, options: ['Cup', 'Kettle'], optionPrice: [40, 120], weight: 10 },
      { name: 'Fresh Lime Soda', cat: 'cat_r_bev', attr1: 'Cold', attr2: 'Veg', cost: 12, mrp: 0, price: 80, options: ['Sweet', 'Salted'], optionPrice: [80, 80], weight: 7 },
      { name: 'Mineral Water', cat: 'cat_r_pack', attr1: 'Packaged', attr2: '', cost: 8, mrp: 20, price: 20, options: ['1 L'], stock: [30, 80], weight: 11 },
      { name: 'Veg Thali Combo', cat: 'cat_r_combo', attr1: 'Combo', attr2: 'Veg', cost: 110, mrp: 0, price: 320, options: ['Regular', 'Deluxe'], optionPrice: [320, 420], weight: 6 },
    ],
    expenses: [
      { category: 'Rent', amount: [85000, 85000], every: 30, vendor: 'Landlord', mode: 'bank' },
      { category: 'Salary', amount: [140000, 152000], every: 30, mode: 'bank' },
      { category: 'Raw materials', amount: [6500, 14500], every: 1, vendor: 'Mumbai Fresh Veg', mode: 'cash' },
      { category: 'Gas', amount: [4200, 4800], every: 10, mode: 'upi' },
      { category: 'Electricity', amount: [18000, 24000], every: 30, mode: 'upi' },
      { category: 'Delivery commission', amount: [2200, 6800], every: 7, mode: 'bank' },
    ],
  },
}

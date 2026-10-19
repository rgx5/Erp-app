import { DEFAULT_SLABS } from '@/domain/tax'
import type { CategoryConfig } from '@/domain/types'
import type { IndustryPack, PackCategory } from './types'

/**
 * Clothing & textile — the pack the Krishna Collection billing app was built for. Category ids, prefixes and selling
 * rules are identical to that app, so a store connected from it looks exactly as it always did.
 */
type Row = [id: string, name: string, group: string, prefix: string, unit?: 'm', hsn?: string, gst?: number, plain?: boolean]

const rows: Row[] = [
  // Women
  ['cat_wsaree', 'Sarees', 'Women', 'WS', undefined, undefined, undefined, true],
  ['cat_wkurti', 'Kurti', 'Women', 'WK'], ['cat_wtop', 'Tops', 'Women', 'WT'], ['cat_wjeans', 'Jeans', 'Women', 'WJ'],
  ['cat_wdressmat', 'Dress Material', 'Women', 'WD', undefined, undefined, undefined, true],
  ['cat_wblouse', 'Blouse Piece', 'Women', 'WB', undefined, undefined, undefined, true],
  ['cat_wdupatta', 'Dupatta & Stole', 'Women', 'WU', undefined, undefined, undefined, true],
  ['cat_wsuit', 'Salwar Suit', 'Women', 'WZ', undefined, undefined, undefined, true],
  ['cat_wlehenga', 'Lehenga', 'Women', 'WL', undefined, undefined, undefined, true],
  ['cat_wnight', 'Nightwear', 'Women', 'WN'], ['cat_winner', 'Innerwear', 'Women', 'WI'],
  // Men
  ['cat_mshirt', 'Shirts', 'Men', 'MS'], ['cat_mtshirt', 'T-Shirts', 'Men', 'MT'], ['cat_mjeans', 'Jeans', 'Men', 'MJ'],
  ['cat_mkurta', 'Kurta', 'Men', 'MK'], ['cat_mtrouser', 'Trousers', 'Men', 'MR'], ['cat_methnic', 'Ethnic Wear', 'Men', 'ME'],
  ['cat_mshirtpc', 'Shirt Piece', 'Men', 'MP', undefined, undefined, undefined, true],
  ['cat_mtrouserpc', 'Trouser Piece', 'Men', 'MQ', undefined, undefined, undefined, true],
  ['cat_msuitlen', 'Suit Length', 'Men', 'ML', undefined, undefined, undefined, true],
  ['cat_mdhoti', 'Dhoti & Lungi', 'Men', 'MD', undefined, undefined, undefined, true],
  ['cat_minner', 'Innerwear', 'Men', 'MI'],
  // Kids
  ['cat_kids', 'Kids Wear', 'Kids', 'KD'],
  // Fabric by the metre
  ['cat_fab_dress', 'Dress Fabric', 'Fabric (by metre)', 'FD', 'm', '5208', 5],
  ['cat_fab_shirt', 'Shirting', 'Fabric (by metre)', 'FS', 'm', '5208', 5],
  ['cat_fab_suit', 'Suiting', 'Fabric (by metre)', 'FU', 'm', '5407', 5],
  ['cat_fab_blouse', 'Blouse Fabric', 'Fabric (by metre)', 'FB', 'm', '5407', 5],
  ['cat_fab_lace', 'Net & Lace', 'Fabric (by metre)', 'FN', 'm', '5804', 5],
  ['cat_fab_lining', 'Lining & Interlining', 'Fabric (by metre)', 'FL', 'm', '5407', 5],
  ['cat_fab_furn', 'Furnishing Fabric', 'Fabric (by metre)', 'FF', 'm', '5513', 5],
  ['cat_fab_uniform', 'Uniform Fabric', 'Fabric (by metre)', 'FM', 'm', '5513', 5],
  // Home textiles
  ['cat_home_bed', 'Bedsheets', 'Home', 'HB', undefined, '6302', 5, true],
  ['cat_home_blanket', 'Blankets & Quilts', 'Home', 'HQ', undefined, '6301', 5, true],
  ['cat_home_curtain', 'Curtains', 'Home', 'HC', undefined, '6303', 5, true],
  ['cat_home_towel', 'Towels', 'Home', 'HT', undefined, '6302', 5, true],
  ['cat_home_cushion', 'Cushion Covers', 'Home', 'HK', undefined, '6304', 5, true],
  // Accessories
  ['cat_acc', 'Accessories', 'Accessories', 'AC', undefined, undefined, undefined, true],
  ['cat_acc_sewing', 'Sewing Supplies', 'Accessories', 'AS', undefined, undefined, undefined, true],
]

export const APPAREL_CATEGORIES: PackCategory[] = rows.map(([id, name, group, prefix, unit, hsn, gst, plain]) => {
  const fabric = unit === 'm'
  const config: CategoryConfig = {
    prefix, unit: unit ?? 'pc', variantMode: fabric || plain ? 'plain' : 'sizes', reorderLevel: fabric ? 5 : 3,
    ...(fabric ? { optionLabel: 'Designs / colours / widths', step: 0.5, minQty: 0.5 } : {}),
    ...(hsn ? { hsn } : {}), ...(gst !== undefined ? { gstRate: gst } : {}),
  }
  return { id, name, group, config }
})

const SIZES = ['S', 'M', 'L', 'XL']

export const apparel: IndustryPack = {
  id: 'apparel',
  name: 'Clothing & Textile',
  tagline: 'Garment shops, sarees, fabric by the metre, home textiles',
  icon: 'shirt',
  tint: '#7C5CFF',
  labels: {
    item: 'Item', items: 'Items', customer: 'Customer', customers: 'Customers',
    option1: 'Size', option2: 'Colour', attr1: 'Fabric', attr2: 'Season', attr1Hint: 'Cotton, silk…', attr2Hint: 'Summer, festive…',
    sale: 'Bill', sales: 'Bills', newSale: 'New bill', staff: 'Salesperson', price: 'Tag price',
  },
  tax: { slabs: DEFAULT_SLABS, inclusive: true, hsnHint: 'Apparel is usually 6203–6206; fabric 52xx–55xx', defaultHsn: '6205' },
  categories: APPAREL_CATEGORIES,
  groupOrder: ['Women', 'Men', 'Kids', 'Fabric (by metre)', 'Home', 'Accessories'],
  settings: {
    returnPolicy: 'Exchange within 7 days with original bill and tags intact. No refund on sale items.',
    footerNote: 'Thank you for shopping with us! Visit again.',
    loyaltyEarnPct: 1, loyaltyRedeemValue: 1, maxCashierDiscountPct: 10, lowStockDefault: 3, returnWindowDays: 7,
  },
  expenseCategories: ['Rent', 'Salary', 'Electricity', 'Transport', 'Packaging', 'Marketing', 'Repairs', 'Tea & Snacks', 'GST / Taxes', 'Misc'],
  stockReasons: ['Damaged piece', 'Lost / theft', 'Sample given', 'Personal use', 'Supplier return', 'Counting correction', 'Other'],
  returnReasons: ['Wrong size', 'Changed mind', 'Defect', 'Colour not as expected', 'Gift exchange', 'Other'],
  highlights: ['Size × colour variants with one barcode each', 'Fabric by the metre', 'Slab-based GST (5% / 18%)', 'Sell-by-salesperson commissions report'],
  demo: {
    storeName: 'Krishna Collection', city: 'Pune', ownerName: 'Anita Deshmukh', tagline: 'Fashion for the whole family',
    suppliers: [{ name: 'Surat Textile Mills', gstin: '24AABCS1429B1Z5' }, { name: 'Ludhiana Knitwear Co.', gstin: '03AAACL5521M1ZP' }, { name: 'Jaipur Block Prints' }],
    billsPerDay: [14, 28], lines: [1, 3], payMix: { cash: 0.3, upi: 0.5, card: 0.2 }, hours: [10, 21],
    items: [
      { name: 'Oxford Formal Shirt', cat: 'cat_mshirt', brand: 'Urban Thread', attr1: 'Cotton', attr2: 'All season', cost: 520, mrp: 1499, price: 1099, options: SIZES, options2: ['White', 'Sky Blue', 'Navy'], stock: [4, 14], weight: 9, hsn: '6205' },
      { name: 'Slim Fit Casual Shirt', cat: 'cat_mshirt', brand: 'Urban Thread', attr1: 'Cotton blend', attr2: 'Summer', cost: 480, mrp: 1299, price: 899, options: SIZES, options2: ['Olive', 'Maroon'], stock: [3, 12], weight: 6, hsn: '6205' },
      { name: 'Round Neck T-Shirt', cat: 'cat_mtshirt', brand: 'Roadster Basics', attr1: 'Cotton', attr2: 'Summer', cost: 210, mrp: 699, price: 499, options: SIZES, options2: ['Black', 'White', 'Grey'], stock: [6, 20], weight: 12, hsn: '6109' },
      { name: 'Straight Fit Jeans', cat: 'cat_mjeans', brand: 'Denim Co.', attr1: 'Denim', attr2: 'All season', cost: 640, mrp: 1999, price: 1399, options: ['30', '32', '34', '36'], options2: ['Indigo', 'Black'], stock: [3, 10], weight: 7, hsn: '6203' },
      { name: 'Cotton Kurta', cat: 'cat_mkurta', brand: 'Ethnic Roots', attr1: 'Cotton', attr2: 'Festive', cost: 560, mrp: 1799, price: 1299, options: ['M', 'L', 'XL'], options2: ['Cream', 'Mustard'], stock: [3, 9], weight: 5, hsn: '6205' },
      { name: 'Anarkali Kurti', cat: 'cat_wkurti', brand: 'Ethnic Roots', attr1: 'Rayon', attr2: 'Festive', cost: 430, mrp: 1599, price: 1199, options: ['S', 'M', 'L', 'XL'], options2: ['Teal', 'Wine'], stock: [3, 10], weight: 10, hsn: '6204' },
      { name: 'Printed Cotton Top', cat: 'cat_wtop', brand: 'Bloom', attr1: 'Cotton', attr2: 'Summer', cost: 260, mrp: 899, price: 649, options: ['S', 'M', 'L'], options2: ['Floral', 'Stripe'], stock: [4, 14], weight: 8, hsn: '6106' },
      { name: 'Kanjivaram Silk Saree', cat: 'cat_wsaree', brand: 'Heritage Looms', attr1: 'Pure silk', attr2: 'Wedding', cost: 6200, mrp: 14999, price: 11999, options: ['Peacock Blue', 'Ruby Red', 'Gold'], stock: [1, 3], weight: 1.5, hsn: '5007' },
      { name: 'Cotton Handloom Saree', cat: 'cat_wsaree', brand: 'Heritage Looms', attr1: 'Cotton', attr2: 'Everyday', cost: 780, mrp: 2499, price: 1799, options: ['Indigo', 'Mustard', 'Rose'], stock: [3, 8], weight: 5, hsn: '5208' },
      { name: 'Cotton Dress Fabric', cat: 'cat_fab_dress', brand: 'Surat Mills', attr1: 'Cotton', attr2: '', cost: 120, mrp: 260, price: 220, unit: 'm', options: ['Floral', 'Geometric', 'Plain Mint'], stock: [20, 60], weight: 4, qty: [1.5, 4] },
      { name: 'Shirting Fabric', cat: 'cat_fab_shirt', brand: 'Surat Mills', attr1: 'Poly cotton', attr2: '', cost: 145, mrp: 340, price: 290, unit: 'm', options: ['White', 'Sky', 'Check Blue'], stock: [25, 70], weight: 3, qty: [1.25, 3] },
      { name: 'Double Bedsheet Set', cat: 'cat_home_bed', brand: 'Homespun', attr1: 'Cotton', attr2: '', cost: 540, mrp: 1599, price: 1099, options: ['Jaipur Print', 'Plain Beige', 'Floral Blue'], stock: [3, 9], weight: 3, hsn: '6302' },
      { name: 'Cotton Bath Towel', cat: 'cat_home_towel', brand: 'Homespun', attr1: 'Cotton', attr2: '', cost: 160, mrp: 499, price: 349, options: ['White', 'Grey', 'Teal'], stock: [6, 18], weight: 3, hsn: '6302' },
      { name: 'Kids Party Frock', cat: 'cat_kids', brand: 'Little Stars', attr1: 'Net & satin', attr2: 'Festive', cost: 380, mrp: 1299, price: 899, options: ['2-3Y', '4-5Y', '6-7Y'], options2: ['Pink', 'Lilac'], stock: [2, 8], weight: 4, hsn: '6104' },
      { name: 'Cotton Dupatta', cat: 'cat_wdupatta', brand: 'Jaipur Block Prints', attr1: 'Cotton', attr2: '', cost: 140, mrp: 599, price: 399, options: ['Block Print Red', 'Block Print Indigo'], stock: [4, 12], weight: 3, hsn: '6214' },
    ],
    expenses: [
      { category: 'Rent', amount: [38000, 38000], every: 30, vendor: 'Landlord', mode: 'bank' },
      { category: 'Salary', amount: [52000, 56000], every: 30, mode: 'bank' },
      { category: 'Electricity', amount: [5200, 7800], every: 30, vendor: 'MSEDCL', mode: 'upi' },
      { category: 'Tea & Snacks', amount: [60, 240], every: 2, mode: 'cash' },
      { category: 'Packaging', amount: [900, 2400], every: 9, vendor: 'Pack Mart', mode: 'upi' },
      { category: 'Transport', amount: [300, 1400], every: 6, mode: 'cash' },
      { category: 'Marketing', amount: [1500, 5000], every: 21, mode: 'upi' },
    ],
  },
}

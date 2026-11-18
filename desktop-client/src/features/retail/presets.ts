/** Starting category trees for common kinds of shop. A template only creates categories (skipping any whose code already exists); it never touches items, prices or tax. */
export interface Preset { id: string; name: string; about: string; groups: { code: string; name: string; children: string[] }[] }

export const PRESETS: Preset[] = [
  { id: 'grocery', name: 'Grocery and kirana', about: 'Supermarkets, kirana stores, dairy and fresh produce.', groups: [
    { code: 'STP', name: 'Staples', children: ['Atta and flour', 'Rice and grains', 'Dals and pulses'] },
    { code: 'FRS', name: 'Loose and fresh', children: ['Vegetables', 'Fruits', 'Loose grains'] },
    { code: 'KIT', name: 'Kitchen', children: ['Oils and ghee', 'Spices and masala'] },
    { code: 'DRY', name: 'Dairy', children: ['Milk and curd', 'Eggs'] },
    { code: 'PKG', name: 'Packaged food', children: ['Snacks and biscuits', 'Beverages'] },
    { code: 'HOM', name: 'Home and care', children: ['Personal care', 'Household'] },
  ] },
  { id: 'apparel', name: 'Apparel and fashion', about: 'Clothing, footwear and accessories.', groups: [
    { code: 'MEN', name: 'Menswear', children: ['Shirts', 'Trousers', 'T-shirts', 'Ethnic wear'] },
    { code: 'WOM', name: 'Womenswear', children: ['Kurtis', 'Sarees', 'Western wear', 'Lehengas'] },
    { code: 'KID', name: 'Kidswear', children: ['Boys', 'Girls', 'Infants'] },
    { code: 'FTW', name: 'Footwear', children: ['Formal', 'Casual', 'Sports'] },
    { code: 'ACC', name: 'Accessories', children: ['Belts and wallets', 'Bags', 'Jewellery'] },
  ] },
  { id: 'pharmacy', name: 'Pharmacy and wellness', about: 'Medicines, health products and personal care.', groups: [
    { code: 'MED', name: 'Medicines', children: ['Tablets and capsules', 'Syrups', 'Ointments', 'Injectables'] },
    { code: 'WEL', name: 'Wellness', children: ['Vitamins and supplements', 'Ayurvedic', 'Health drinks'] },
    { code: 'DEV', name: 'Devices and supplies', children: ['Monitors and meters', 'First aid', 'Surgical'] },
    { code: 'PCR', name: 'Personal care', children: ['Skin care', 'Hair care', 'Baby care'] },
  ] },
  { id: 'electronics', name: 'Electronics and mobiles', about: 'Phones, appliances, accessories and repairs.', groups: [
    { code: 'MOB', name: 'Mobiles', children: ['Smartphones', 'Feature phones', 'Tablets'] },
    { code: 'ACS', name: 'Accessories', children: ['Chargers and cables', 'Cases and covers', 'Headphones', 'Power banks'] },
    { code: 'APP', name: 'Appliances', children: ['Televisions', 'Fans and coolers', 'Kitchen appliances'] },
    { code: 'CMP', name: 'Computing', children: ['Laptops', 'Storage', 'Printers'] },
  ] },
  { id: 'restaurant', name: 'Restaurant and cafe', about: 'Dishes, beverages and desserts.', groups: [
    { code: 'FOD', name: 'Food', children: ['Starters', 'Main course', 'Breads', 'Rice and biryani'] },
    { code: 'BEV', name: 'Beverages', children: ['Hot drinks', 'Cold drinks', 'Juices and shakes'] },
    { code: 'DST', name: 'Desserts', children: ['Ice cream', 'Sweets'] },
  ] },
  { id: 'salon', name: 'Salon and services', about: 'Hair, skin and grooming services with retail products.', groups: [
    { code: 'SRV', name: 'Services', children: ['Hair', 'Skin', 'Nails', 'Spa and massage'] },
    { code: 'PRD', name: 'Retail products', children: ['Hair products', 'Skin products'] },
  ] },
  { id: 'hardware', name: 'Hardware and building', about: 'Tools, electricals, plumbing and paints.', groups: [
    { code: 'TLS', name: 'Tools', children: ['Hand tools', 'Power tools', 'Fasteners'] },
    { code: 'ELE', name: 'Electricals', children: ['Wires and cables', 'Switches and sockets', 'Lighting'] },
    { code: 'PLB', name: 'Plumbing', children: ['Pipes and fittings', 'Taps and sanitary'] },
    { code: 'PNT', name: 'Paints', children: ['Interior', 'Exterior', 'Accessories'] },
  ] },
  { id: 'general', name: 'General store', about: 'A small, flexible set to start from.', groups: [
    { code: 'GEN', name: 'General goods', children: ['Daily needs', 'Stationery', 'Gifts and toys'] },
  ] },
]

const slug = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 8)
/** Every category a preset would create, parents first, each with a code that is stable across runs. */
export function categoriesOf(p: Preset): { code: string; name: string; parentCode: string | null }[] {
  return p.groups.flatMap((g) => [{ code: g.code, name: g.name, parentCode: null as string | null }, ...g.children.map((c) => ({ code: `${g.code}-${slug(c)}`, name: c, parentCode: g.code as string | null }))])
}

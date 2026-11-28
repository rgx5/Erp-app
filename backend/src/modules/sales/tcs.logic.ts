/** Tax collected at source by a seller (section 206C of the Income-tax Act). The rates are the usual ones and can be changed by the business; confirm with the accountant. */
export interface TcsSection { code: string; description: string; rate: string }
export const DEFAULT_TCS_SECTIONS: TcsSection[] = [
  { code: '206C(1)-SCRAP', description: 'Scrap', rate: '1' },
  { code: '206C(1)-TIMBER-LEASE', description: 'Timber obtained under a forest lease', rate: '2.5' },
  { code: '206C(1)-TIMBER-OTHER', description: 'Timber obtained by any mode other than a forest lease', rate: '2.5' },
  { code: '206C(1)-FOREST', description: 'Any other forest produce (not tendu leaves or timber)', rate: '2.5' },
  { code: '206C(1)-TENDU', description: 'Tendu leaves', rate: '5' },
  { code: '206C(1)-MINERALS', description: 'Coal, lignite or iron ore', rate: '1' },
  { code: '206C(1)-LIQUOR', description: 'Alcoholic liquor for human consumption', rate: '1' },
  { code: '206C(1C)-PARKING', description: 'Parking lot, toll plaza or mining and quarrying licence', rate: '2' },
  { code: '206C(1F)-VEHICLE', description: 'Motor vehicle with a value above ₹10 lakh', rate: '1' },
];

/** TCS on a base amount, in paise, rounded to the nearest paisa. `rate` is a percentage such as "2.5". */
export function tcsOn(basePaise: bigint, rate: string): bigint {
  const [w = '0', f = ''] = rate.split('.');
  const scaled = BigInt(w) * 10_000n + BigInt((f + '0000').slice(0, 4)); // rate in 1/10000 of a percent
  const num = basePaise * scaled; const den = 1_000_000n;              // base × rate% = base × scaled / (10000 × 100)
  return (num + den / 2n) / den;
}

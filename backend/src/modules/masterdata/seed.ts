import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { currencies, units } from './masterdata.schema.js';

/** The GST Unique Quantity Codes (UQC), with a readable name. Countable units default to 0 decimal places, measured ones to 3. */
export const UQC: readonly (readonly [code: string, name: string, decimals: number])[] = [
  ['BAG', 'Bags', 0], ['BAL', 'Bale', 0], ['BDL', 'Bundles', 0], ['BKL', 'Buckles', 0], ['BOU', 'Billions of Units', 0], ['BOX', 'Box', 0],
  ['BTL', 'Bottles', 0], ['BUN', 'Bunches', 0], ['CAN', 'Cans', 0], ['CBM', 'Cubic Meters', 3], ['CCM', 'Cubic Centimeters', 3],
  ['CMS', 'Centimeters', 2], ['CTN', 'Cartons', 0], ['DOZ', 'Dozens', 0], ['DRM', 'Drums', 0], ['GGK', 'Great Gross', 0], ['GMS', 'Grams', 3],
  ['GRS', 'Gross', 0], ['GYD', 'Gross Yards', 0], ['KGS', 'Kilograms', 3], ['KLR', 'Kilolitre', 3], ['KME', 'Kilometre', 3],
  ['MLT', 'Millilitre', 3], ['MTR', 'Meters', 3], ['MTS', 'Metric Ton', 3], ['NOS', 'Numbers', 0], ['OTH', 'Others', 3], ['PAC', 'Packs', 0],
  ['PCS', 'Pieces', 0], ['PRS', 'Pairs', 0], ['QTL', 'Quintal', 3], ['ROL', 'Rolls', 0], ['SET', 'Sets', 0], ['SQF', 'Square Feet', 3],
  ['SQM', 'Square Meters', 3], ['SQY', 'Square Yards', 3], ['TBS', 'Tablets', 0], ['TGM', 'Ten Gross', 0], ['THD', 'Thousands', 0],
  ['TON', 'Tonnes', 3], ['TUB', 'Tubes', 0], ['UGS', 'US Gallons', 3], ['UNT', 'Units', 0], ['YDS', 'Yards', 3],
];

/**
 * What every new tenant starts with: INR and the statutory unit list. Tax rates are NOT seeded (they are the tenant's
 * configuration, and a wrong default would silently mis-tax documents).
 */
export async function seedTenantDefaults(tx: Tx, tenantId: string): Promise<void> {
  await tx.insert(currencies).values({ tenantId, id: uuidv7(), code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalPlaces: 2 });
  await tx.insert(units).values(UQC.map(([code, name, decimalPlaces]) => ({ tenantId, id: uuidv7(), code, name, uqc: code, decimalPlaces })));
}

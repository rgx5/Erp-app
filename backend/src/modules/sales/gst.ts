import { divRound } from '../inventory/decimal.js';

/**
 * The GST engine: pure, integer arithmetic, no I/O. Rates are percentages with 4 decimals, quantities 6, prices 4. Every
 * amount that appears on an invoice is rounded half up to the paisa, per line and per tax component, and each invoice total is
 * rounded to the nearest rupee with a separate round-off.
 */
export type SupplyType = 'b2b' | 'b2c' | 'sez' | 'export';
export type TaxRegime = 'intra' | 'inter';
export const OTHER_COUNTRY = '96';

const PERCENT_ONE = 1_000_000n; // 100.0000 % in 4-decimal units
const PAISE_PER_UNIT = 100n;

const parseDecimal = (text: string, scale: number): bigint => {
  const m = /^(\d{1,14})(?:\.(\d{1,12}))?$/.exec(text);
  if (!m || (m[2]?.length ?? 0) > scale) throw new TypeError(`Not a valid decimal with at most ${scale} places: ${text}`);
  return BigInt(m[1] as string) * 10n ** BigInt(scale) + BigInt((m[2] ?? '').padEnd(scale, '0') || '0');
};
export const paiseToMoney = (paise: bigint): string => {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  return `${negative ? '-' : ''}${abs / PAISE_PER_UNIT}.${(abs % PAISE_PER_UNIT).toString().padStart(2, '0')}00`;
};

/** How a party's GST treatment decides the kind of supply. */
export function supplyTypeOf(treatment: string): SupplyType {
  switch (treatment) {
    case 'registered_regular':
    case 'registered_composition':
    case 'deemed_export':
      return 'b2b';
    case 'sez':
      return 'sez';
    case 'overseas':
      return 'export';
    default:
      return 'b2c'; // unregistered, consumer
  }
}

/**
 * Place of supply. Goods: where they are delivered (ship-to), else the billing state. Services: the recipient's (billing) state.
 * Exports: Other Country (96). With no recipient address at all (a counter sale), the supplier's own state.
 */
export function placeOfSupply(input: { kind: 'goods' | 'services'; supplierState: string; supplyType: SupplyType; billToState?: string | undefined; shipToState?: string | undefined; override?: string | undefined }): string {
  if (input.supplyType === 'export') return OTHER_COUNTRY;
  if (input.override) return input.override;
  if (input.kind === 'goods') return input.shipToState ?? input.billToState ?? input.supplierState;
  return input.billToState ?? input.supplierState;
}

/** Within the supplier's state: CGST + SGST. Anywhere else, and always for SEZ and exports: IGST. */
export const taxRegime = (supplierState: string, pos: string, supplyType: SupplyType): TaxRegime => (supplyType === 'sez' || supplyType === 'export' ? 'inter' : pos === supplierState ? 'intra' : 'inter');

export interface Rates { igst: string; cgst: string; sgst: string; cess: string }
export interface LineInput { quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean; rates: Rates }
export interface LineTax {
  /** Everything in paise (1/100). */
  taxable: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  cess: bigint;
  total: bigint;
}

/** Tax for one line. `charge` false (LUT / bond: exports and SEZ supplies without payment of tax) yields zero tax. */
export function computeLine(line: LineInput, regime: TaxRegime, charge = true): LineTax {
  const qty = parseDecimal(line.quantity, 6);
  const price = parseDecimal(line.unitPrice, 4);
  const discount = parseDecimal(line.discountPercent, 4);
  if (discount > PERCENT_ONE) throw new RangeError('A discount cannot exceed 100%');
  // quantity x price x (100% - discount), to the paisa
  let amountPaise = divRound(qty * price * (PERCENT_ONE - discount), 10n ** 14n);
  const rate = {
    cgst: parseDecimal(line.rates.cgst, 4),
    sgst: parseDecimal(line.rates.sgst, 4),
    igst: parseDecimal(line.rates.igst, 4),
    cess: parseDecimal(line.rates.cess, 4),
  };
  const gstRate = regime === 'intra' ? rate.cgst + rate.sgst : rate.igst;
  const totalRate = charge ? gstRate + rate.cess : 0n;
  let taxable = amountPaise;
  if (line.taxInclusive && totalRate > 0n) {
    taxable = divRound(amountPaise * PERCENT_ONE, PERCENT_ONE + totalRate); // back out the tax that is inside the price
    amountPaise = taxable;
  }
  const part = (r: bigint): bigint => (charge ? divRound(taxable * r, PERCENT_ONE) : 0n);
  const cgst = regime === 'intra' ? part(rate.cgst) : 0n;
  const sgst = regime === 'intra' ? part(rate.sgst) : 0n;
  const igst = regime === 'inter' ? part(rate.igst) : 0n;
  const cess = part(rate.cess);
  return { taxable, cgst, sgst, igst, cess, total: taxable + cgst + sgst + igst + cess };
}

export interface InvoiceTotals {
  taxable: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  cess: bigint;
  /** The amount before rounding: taxable plus the tax charged (reverse charge: tax is shown but not collected). */
  payable: bigint;
  roundOff: bigint;
  grand: bigint;
}

/** Sums the lines and rounds the payable amount to the nearest rupee. */
export function computeInvoice(lines: LineTax[], reverseCharge: boolean): InvoiceTotals {
  const sum = (pick: (l: LineTax) => bigint): bigint => lines.reduce((a, l) => a + pick(l), 0n);
  const taxable = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  const cess = sum((l) => l.cess);
  const payable = taxable + (reverseCharge ? 0n : cgst + sgst + igst + cess);
  const grand = divRound(payable, PAISE_PER_UNIT) * PAISE_PER_UNIT;
  return { taxable, cgst, sgst, igst, cess, payable, roundOff: grand - payable, grand };
}

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildEInvoice, buildEway, checkEInvoice, checkEway, computeIrn, financialYear, uqcOf, type InvoiceIn, type PartyIn } from './einvoice.build.js';

const seller: PartyIn = { gstin: '27ABCDE1234F1Z5', legalName: 'Shree Traders', tradeName: null, address1: '1 Main Rd', address2: null, city: 'Mumbai', pincode: '400001', stateCode: '27' };
const buyer: PartyIn = { gstin: '29KLMNO9012P1Z5', legalName: 'Buyer Pvt Ltd', tradeName: null, address1: '9 Road', address2: null, city: 'Bengaluru', pincode: '560001', stateCode: '29' };
const line = { lineNo: 1, description: 'Widget', hsn: '8479', isService: false, quantity: '2', unitPrice: '118', discountPercent: '10', taxInclusive: true, taxableValue: '180', igstRate: '18', cgstRate: '0', sgstRate: '0', cessRate: '0', igstAmount: '32.4', cgstAmount: '0', sgstAmount: '0', cessAmount: '0', lineTotal: '212.4', uqc: 'NOS', unitCode: 'NOS' };
const inv: InvoiceIn = { invoiceNo: 'INV/25-26/0001', documentType: 'tax_invoice', invoiceDate: '2025-04-10', status: 'posted', supplyType: 'b2b', taxPayment: null, reverseCharge: false, placeOfSupply: '29', taxableTotal: '180', cgstTotal: '0', sgstTotal: '0', igstTotal: '32.4', cessTotal: '0', roundOff: '-0.4', grandTotal: '212', original: null, lines: [line] };

describe('IRN', () => {
  it('is SHA-256 of seller GSTIN, financial year, document type and number', () => {
    expect(computeIrn(seller.gstin as string, '2025-04-10', 'tax_invoice', 'INV/25-26/0001')).toBe(createHash('sha256').update('27ABCDE1234F1Z52025-26INVINV/25-26/0001').digest('hex'));
    expect(financialYear('2026-03-31')).toBe('2025-26'); expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(computeIrn(seller.gstin as string, '2025-04-10', 'credit_note', 'CN1')).not.toBe(computeIrn(seller.gstin as string, '2025-04-10', 'tax_invoice', 'CN1'));
  });
});

describe('e-invoice file', () => {
  it('writes the portal layout with the discount worked back out of a tax-inclusive line', () => {
    const j = buildEInvoice(inv, seller, buyer) as any; // eslint-disable-line
    expect(j.Version).toBe('1.1');
    expect(j.TranDtls).toMatchObject({ SupTyp: 'B2B', RegRev: 'N' });
    expect(j.DocDtls).toEqual({ Typ: 'INV', No: 'INV/25-26/0001', Dt: '10/04/2025' });
    expect(j.BuyerDtls).toMatchObject({ Gstin: '29KLMNO9012P1Z5', Pos: '29', Pin: 560001, Stcd: '29' });
    expect(j.ItemList[0]).toMatchObject({ SlNo: '1', HsnCd: '8479', Unit: 'NOS', Qty: 2, TotAmt: 200, Discount: 20, AssAmt: 180, GstRt: 18, IgstAmt: 32.4, TotItemVal: 212.4 });
    expect(j.ValDtls).toMatchObject({ AssVal: 180, IgstVal: 32.4, Disc: 20, RndOffAmt: -0.4, TotInvVal: 212 });
  });
  it('marks exports and credit notes', () => {
    const exp = buildEInvoice({ ...inv, supplyType: 'export', taxPayment: 'without_payment' }, seller, { ...buyer, gstin: null, pincode: null, stateCode: null }) as any; // eslint-disable-line
    expect(exp.TranDtls.SupTyp).toBe('EXPWOP'); expect(exp.BuyerDtls).toMatchObject({ Gstin: 'URP', Pos: '96', Pin: 999999, Stcd: '96' });
    const cn = buildEInvoice({ ...inv, documentType: 'credit_note', original: { invoiceNo: 'INV1', invoiceDate: '2025-04-01' } }, seller, buyer) as any; // eslint-disable-line
    expect(cn.DocDtls.Typ).toBe('CRN'); expect(cn.PrecDocDtls).toEqual([{ InvNo: 'INV1', InvDt: '01/04/2025' }]);
  });
  it('lists what stops the file', () => {
    expect(checkEInvoice(inv, seller, buyer, false).filter((i) => i.blocking)).toEqual([]);
    const f = (i: InvoiceIn, b: PartyIn = buyer, s: PartyIn = seller, issued = false) => checkEInvoice(i, s, b, issued).filter((x) => x.blocking).map((x) => x.field);
    expect(f({ ...inv, supplyType: 'b2c_small' })).toEqual(['buyer']);
    expect(f({ ...inv, documentType: 'bill_of_supply' })).toEqual(['document']);
    expect(f({ ...inv, status: 'cancelled' })).toContain('status');
    expect(f(inv, buyer, seller, true)).toContain('irn');
    expect(f(inv, { ...buyer, address1: null, pincode: null })).toEqual(expect.arrayContaining(['buyer.address', 'buyer.pincode']));
    expect(f(inv, buyer, { ...seller, pincode: null })).toContain('seller.pincode');
    expect(f({ ...inv, invoiceNo: '0001' })).toContain('docNo'); expect(f({ ...inv, invoiceNo: 'INV/2025-26/000000001' })).toContain('docNo');
    expect(f({ ...inv, lines: [{ ...line, hsn: null }] })).toContain('item1.hsn');
    expect(f({ ...inv, invoiceDate: '2099-01-01' })).toContain('date');
  });
  it('maps units to the portal list and warns on a guess', () => {
    expect(uqcOf(null, 'KG')).toEqual({ code: 'KGS', guessed: false }); expect(uqcOf(null, 'WIDGETS')).toEqual({ code: 'OTH', guessed: true });
    expect(checkEInvoice({ ...inv, lines: [{ ...line, uqc: null, unitCode: 'BUCKET' }] }, seller, buyer, false).find((i) => i.field === 'item1.unit')).toMatchObject({ blocking: false });
  });
});

describe('e-way bill', () => {
  const road = { mode: 'road' as const, distanceKm: 850, vehicleNo: 'mh 12-ab 1234' };
  it('builds the bulk layout', () => {
    const j = buildEway(inv, seller, buyer, road) as any; // eslint-disable-line
    expect(j.version).toBe('1.0.0621'); const b = j.billLists[0];
    expect(b).toMatchObject({ userGstin: '27ABCDE1234F1Z5', supplyType: 'O', docType: 'INV', docDate: '10/04/2025', fromPincode: 400001, toPincode: 560001, toStateCode: 29, transMode: 1, transDistance: '850', vehicleNo: 'MH12AB1234', totInvValue: 212 });
    expect(b.itemList[0]).toMatchObject({ hsnCode: 8479, qtyUnit: 'NOS', taxableAmount: 180, igstRate: 18 });
  });
  it('checks distance, vehicle, non-road documents and notes', () => {
    const f = (t: object, i: InvoiceIn = inv) => checkEway(i, seller, buyer, { mode: 'road', distanceKm: 100, ...t } as never).filter((x) => x.blocking).map((x) => x.field);
    expect(f(road)).toEqual([]);
    expect(f({ distanceKm: 0 })).toContain('distance'); expect(f({ distanceKm: 4001 })).toContain('distance');
    expect(f({})).toContain('vehicle'); expect(f({ transporterId: '27ABCDE1234F1Z5' })).toEqual([]);
    expect(f({ vehicleNo: 'BAD' })).toContain('vehicle');
    expect(f({ mode: 'rail', distanceKm: 300 })).toContain('transportDoc');
    expect(f(road, { ...inv, documentType: 'credit_note' })).toContain('document');
    expect(checkEway({ ...inv, grandTotal: '40000' }, seller, buyer, road as never).find((x) => x.field === 'value')?.blocking).toBe(false);
  });
});

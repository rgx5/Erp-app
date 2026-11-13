import { describe, expect, it } from 'vitest';
import { computeInvoice, computeLine, paiseToMoney, placeOfSupply, supplyTypeOf, taxRegime } from './gst.js';

const rates = (igst: string, cess = '0'): { igst: string; cgst: string; sgst: string; cess: string } => ({ igst, cgst: (Number(igst) / 2).toString(), sgst: (Number(igst) / 2).toString(), cess });
const line = (o: Partial<Parameters<typeof computeLine>[0]> = {}) => ({ quantity: '1', unitPrice: '100', discountPercent: '0', taxInclusive: false, rates: rates('18'), ...o });
const m = (n: bigint) => paiseToMoney(n);

describe('supply type and place of supply', () => {
  it('derives the supply type from the party\'s GST treatment', () => {
    expect(['registered_regular', 'registered_composition', 'deemed_export', 'unregistered', 'consumer', 'sez', 'overseas'].map(supplyTypeOf)).toEqual(['b2b', 'b2b', 'b2b', 'b2c', 'b2c', 'sez', 'export']);
  });
  it('uses the delivery state for goods, the recipient for services, Other Country for exports', () => {
    const base = { supplierState: '27', supplyType: 'b2b' as const, billToState: '29', shipToState: '24' };
    expect(placeOfSupply({ ...base, kind: 'goods' })).toBe('24');
    expect(placeOfSupply({ ...base, kind: 'services' })).toBe('29');
    expect(placeOfSupply({ ...base, kind: 'goods', shipToState: undefined })).toBe('29');
    expect(placeOfSupply({ supplierState: '27', supplyType: 'b2c', kind: 'goods' })).toBe('27'); // a counter sale
    expect(placeOfSupply({ ...base, kind: 'goods', supplyType: 'export' })).toBe('96');
    expect(placeOfSupply({ ...base, kind: 'goods', override: '07' })).toBe('07');
  });
  it('charges CGST+SGST within the state and IGST otherwise, always IGST for SEZ and exports', () => {
    expect(taxRegime('27', '27', 'b2b')).toBe('intra');
    expect(taxRegime('27', '29', 'b2b')).toBe('inter');
    expect(taxRegime('27', '27', 'sez')).toBe('inter');
    expect(taxRegime('27', '96', 'export')).toBe('inter');
  });
});

describe('line tax', () => {
  it('splits an intra-state 18% line into 9% + 9%', () => {
    const l = computeLine(line({ quantity: '2', unitPrice: '500' }), 'intra');
    expect([m(l.taxable), m(l.cgst), m(l.sgst), m(l.igst), m(l.total)]).toEqual(['1000.0000', '90.0000', '90.0000', '0.0000', '1180.0000']);
  });
  it('charges IGST inter-state', () => {
    const l = computeLine(line({ unitPrice: '1000' }), 'inter');
    expect([m(l.cgst), m(l.sgst), m(l.igst), m(l.total)]).toEqual(['0.0000', '0.0000', '180.0000', '1180.0000']);
  });
  it('rounds each component half up to the paisa', () => {
    const l = computeLine(line({ quantity: '3', unitPrice: '33.33', rates: rates('5') }), 'intra'); // taxable 99.99, 2.5% = 2.49975
    expect([m(l.taxable), m(l.cgst), m(l.sgst)]).toEqual(['99.9900', '2.5000', '2.5000']);
    const half = computeLine(line({ unitPrice: '0.1', rates: rates('5') }), 'intra'); // 2.5% of 0.10 = 0.0025 -> 0.00
    expect(m(half.cgst)).toBe('0.0000');
    const edge = computeLine(line({ unitPrice: '10.10', rates: rates('5') }), 'intra'); // 0.2525 -> 0.25... 2.5% of 10.10 = 0.2525
    expect(m(edge.cgst)).toBe('0.2500');
    const up = computeLine(line({ unitPrice: '10.20', rates: rates('5') }), 'intra'); // 0.255 -> 0.26 (half up)
    expect(m(up.cgst)).toBe('0.2600');
  });
  it('applies the discount before tax', () => {
    const l = computeLine(line({ quantity: '4', unitPrice: '250', discountPercent: '10', rates: rates('12') }), 'inter');
    expect([m(l.taxable), m(l.igst), m(l.total)]).toEqual(['900.0000', '108.0000', '1008.0000']);
  });
  it('backs tax out of a tax-inclusive price', () => {
    const l = computeLine(line({ unitPrice: '118', taxInclusive: true }), 'intra');
    expect([m(l.taxable), m(l.cgst), m(l.sgst), m(l.total)]).toEqual(['100.0000', '9.0000', '9.0000', '118.0000']);
    const odd = computeLine(line({ unitPrice: '99.99', taxInclusive: true, rates: rates('5') }), 'inter');
    expect(m(odd.taxable)).toBe('95.2300'); // 99.99 / 1.05
    expect(m(odd.igst)).toBe('4.7600');
  });
  it('adds cess and charges nothing when tax is not charged (LUT) or the rate is zero', () => {
    const l = computeLine(line({ unitPrice: '1000', rates: rates('28', '12') }), 'inter');
    expect([m(l.igst), m(l.cess), m(l.total)]).toEqual(['280.0000', '120.0000', '1400.0000']);
    const lut = computeLine(line({ unitPrice: '1000' }), 'inter', false);
    expect([m(lut.igst), m(lut.total)]).toEqual(['0.0000', '1000.0000']);
    expect(m(computeLine(line({ rates: rates('0') }), 'intra').total)).toBe('100.0000');
  });
  it('refuses nonsense', () => {
    expect(() => computeLine(line({ discountPercent: '101' }), 'intra')).toThrow();
    expect(() => computeLine(line({ quantity: '1.1234567' }), 'intra')).toThrow();
  });
});

describe('invoice totals and round-off', () => {
  it('rounds the payable amount to the nearest rupee with a signed round-off', () => {
    const lines = [computeLine(line({ unitPrice: '99.99', quantity: '3' }), 'intra'), computeLine(line({ unitPrice: '10.10', rates: rates('5') }), 'intra')];
    const t = computeInvoice(lines, false);
    expect(m(t.payable)).toBe('364.5700'); // 299.97 + 2 x 27.00 + 10.10 + 2 x 0.25
    expect(m(t.grand)).toBe('365.0000');
    expect(m(t.roundOff)).toBe('0.4300');
    const down = computeInvoice([computeLine(line({ unitPrice: '100.49', rates: rates('0') }), 'intra')], false);
    expect([m(down.grand), m(down.roundOff)]).toEqual(['100.0000', '-0.4900']);
    expect(t.grand + 0n).toBe(t.payable + t.roundOff);
    const up = computeInvoice([computeLine(line({ unitPrice: '100.50', rates: rates('0') }), 'intra')], false);
    expect([m(up.grand), m(up.roundOff)]).toEqual(['101.0000', '0.5000']); // .50 rounds up
  });
  it('shows but does not collect tax under reverse charge', () => {
    const t = computeInvoice([computeLine(line({ unitPrice: '1000' }), 'inter')], true);
    expect([m(t.igst), m(t.payable), m(t.grand)]).toEqual(['180.0000', '1000.0000', '1000.0000']);
  });
  it('always reconciles: grand = payable + round-off, within half a rupee', () => {
    for (const price of ['0.01', '1.99', '33.33', '1234.56', '99999.99']) {
      const t = computeInvoice([computeLine(line({ unitPrice: price, quantity: '7' }), 'intra')], false);
      expect(t.grand).toBe(t.payable + t.roundOff);
      expect(t.roundOff >= -50n && t.roundOff <= 50n).toBe(true);
      expect(t.grand % 100n).toBe(0n);
    }
  });
});

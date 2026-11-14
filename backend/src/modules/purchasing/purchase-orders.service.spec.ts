import { describe, expect, it } from 'vitest';
import { netUnitCost } from './purchase-orders.service.js';

describe('netUnitCost', () => {
  it('applies the discount to the price exactly, to six places', () => {
    expect(netUnitCost('1000', '0')).toBe('1000.000000');
    expect(netUnitCost('1000', '10')).toBe('900.000000');
    expect(netUnitCost('99.9999', '0')).toBe('99.999900');
    expect(netUnitCost('100', '12.5')).toBe('87.500000');
    expect(netUnitCost('0.3333', '33.3333')).toBe('0.222200'); // 0.3333 x 0.666667 = 0.22220 (rounded half up at 6 places)
    expect(netUnitCost('250.5', '100')).toBe('0.000000');
  });
});

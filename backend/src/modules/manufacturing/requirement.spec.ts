import { describe, expect, it } from 'vitest';
import { qty } from '../inventory/decimal.js';
import { requirement } from './masters.service.js';

describe('requirement', () => {
  const need = (line: string, scrap: string, target: string, base: string) => qty.format(requirement(line, scrap, qty.parse(target), qty.parse(base)));
  it('scales the line to the target quantity and the BOM base', () => {
    expect(need('3', '0', '10', '2')).toBe('15.000000');
    expect(need('4', '0', '1', '1')).toBe('4.000000');
  });
  it('grosses up for scrap, rounding half up at six places', () => {
    expect(need('4', '5', '10', '1')).toBe('42.105263'); // 40 / 0.95
    expect(need('1', '50', '3', '1')).toBe('6.000000');
  });
});

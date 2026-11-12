import { describe, expect, it } from 'vitest';
import { fromUnits, isPositive, toUnits } from './money.js';
import { MANUFACTURING_INDIA_TEMPLATE } from './template.js';

describe('exact money arithmetic', () => {
  it('round-trips and never loses a paisa to floating point', () => {
    expect(toUnits('0.1') + toUnits('0.2')).toBe(toUnits('0.3')); // 0.1 + 0.2 !== 0.3 in floats
    expect(fromUnits(toUnits('1234567.8900'))).toBe('1234567.8900');
    expect(fromUnits(toUnits('5'))).toBe('5.0000');
    expect(fromUnits(-toUnits('0.0001'))).toBe('-0.0001');
  });
  it('rejects anything but a plain non-negative decimal', () => {
    for (const bad of ['', '-1', '1e3', '1.23456', '1,5', ' 1', 'abc', '123456789012345']) expect(() => toUnits(bad)).toThrow();
  });
  it('knows positive from zero', () => {
    expect(isPositive('0.0001')).toBe(true);
    expect(isPositive('0.0000')).toBe(false);
  });
});

describe('chart template', () => {
  it('is internally consistent: unique codes, parents are groups of the same type, control accounts are leaves', () => {
    const byCode = new Map(MANUFACTURING_INDIA_TEMPLATE.map((a) => [a.code, a]));
    expect(byCode.size).toBe(MANUFACTURING_INDIA_TEMPLATE.length);
    MANUFACTURING_INDIA_TEMPLATE.forEach((a, i) => {
      if (!a.parent) return;
      const parent = byCode.get(a.parent);
      expect(parent?.group, a.code).toBe(true);
      expect(parent?.type, a.code).toBe(a.type);
      expect(MANUFACTURING_INDIA_TEMPLATE.findIndex((x) => x.code === a.parent), `${a.code} parent comes first`).toBeLessThan(i);
      if (a.group) expect(a.control).toBeUndefined();
    });
  });
  it('covers the manufacturing flow: raw material, WIP, finished goods and GRNI', () => {
    const names = MANUFACTURING_INDIA_TEMPLATE.map((a) => a.name);
    for (const n of ['Raw material inventory', 'Work in progress', 'Finished goods inventory', 'Goods received not invoiced', 'Cost of goods sold', 'Overheads absorbed']) expect(names).toContain(n);
  });
});

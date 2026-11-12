import { describe, expect, it } from 'vitest';
import { gstinCheckCharacter, isValidGstin, panOfGstin, stateCodeOfGstin } from './gstin.js';

describe('GSTIN', () => {
  it('accepts a real-world GSTIN whose check character is correct', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
  });
  it('computes the check character of the first 14 characters', () => {
    expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V');
  });
  it('rejects a wrong check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZA')).toBe(false);
  });
  it('rejects malformed values', () => {
    for (const bad of ['', '27AAPFU0939F1Z', '27aapfu0939f1zv', '27AAPFU0939F1XV', '2AAAPFU0939F1ZV']) expect(isValidGstin(bad)).toBe(false);
  });
  it('extracts the state code and PAN', () => {
    expect(stateCodeOfGstin('27AAPFU0939F1ZV')).toBe('27');
    expect(panOfGstin('27AAPFU0939F1ZV')).toBe('AAPFU0939F');
  });
});

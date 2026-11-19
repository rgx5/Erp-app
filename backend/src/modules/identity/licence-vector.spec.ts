import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonical, licenceSchema, verifyLicence } from './entitlements.service.js';

/** The control plane (control-plane/) signs licences; this server verifies them. Both repositories' tests check the same vector. */
const vector = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../../control-plane/test/licence-vector.json'), 'utf8')) as { publicKey: string; licence: Record<string, unknown>; signature: string };

describe('licence signed by the control plane', () => {
  it('verifies, and is a licence this server accepts', () => {
    expect(verifyLicence({ licence: vector.licence, signature: vector.signature }, vector.publicKey)).toBe(true);
    expect(licenceSchema.safeParse(vector.licence).success).toBe(true);
  });
  it('fails when the licence is changed or the signature is wrong', () => {
    expect(verifyLicence({ licence: { ...vector.licence, modules: ['sales', 'payroll'] }, signature: vector.signature }, vector.publicKey)).toBe(false);
    expect(verifyLicence({ licence: vector.licence, signature: `${vector.signature.slice(0, -4)}AAAA` }, vector.publicKey)).toBe(false);
  });
  it('writes canonical text with sorted keys, like the control plane', () => {
    expect(canonical({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}');
  });
});

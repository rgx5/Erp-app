import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonical, signDocument, verifyDocument } from '../src/crypto.js';
import { DEPENDS, LIMIT_KEYS, MODULES } from '../src/modules.js';

const vector = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'licence-vector.json'), 'utf8')) as { publicKey: string; privateKey: string; licence: object; signature: string };
const backend = readFileSync(path.resolve(import.meta.dirname, '../../backend/src/modules/identity/entitlements.ts'), 'utf8');

describe('agreement with the product server', () => {
  it('signs a licence to exactly the bytes the server verifies (Ed25519 is deterministic)', () => {
    expect(signDocument(vector.licence, vector.privateKey)).toBe(vector.signature);
    expect(verifyDocument(vector.licence, vector.signature, vector.publicKey)).toBe(true);
    expect(verifyDocument({ ...vector.licence, plan: 'Other' }, vector.signature, vector.publicKey)).toBe(false);
  });
  it('writes canonical text with sorted keys', () => { expect(canonical({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}'); });
  it('knows the same modules, dependencies and limits as the product server', () => {
    const list = (name: string) => [...(backend.match(new RegExp(`${name} = \\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(list('MODULES')).toEqual([...MODULES]);
    expect(list('LIMIT_KEYS')).toEqual([...LIMIT_KEYS]);
    const deps = Object.fromEntries([...(backend.match(/DEPENDS[^=]*= \{([^}]*)\}/)?.[1] ?? '').matchAll(/(\w+): \[([^\]]*)\]/g)].map((m) => [m[1], [...(m[2] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1])]));
    expect(deps).toEqual(Object.fromEntries(Object.entries(DEPENDS).map(([k, v]) => [k, [...v]])));
  });
});

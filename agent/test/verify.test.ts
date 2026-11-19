import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { releaseProblem } from '../src/verify.js';
import { manifest, PUBLIC, signManifest } from './helpers.js';

describe('release verification', () => {
  const m = manifest('2.0.0');
  it('accepts a signed, newer, well formed release', () => { expect(releaseProblem(m, signManifest(m), PUBLIC, '1.0.0')).toBeUndefined(); expect(releaseProblem(m, signManifest(m), PUBLIC, null)).toBeUndefined(); });
  it('refuses a changed manifest, a signature from another key, and a garbled signature', () => {
    expect(releaseProblem({ ...m, version: '2.0.1' }, signManifest(m), PUBLIC, '1.0.0')).toBe('signature_invalid');
    expect(releaseProblem({ ...m, images: [{ name: 'api', digest: `sha256:${'c'.repeat(64)}` }] }, signManifest(m), PUBLIC, '1.0.0')).toBe('signature_invalid');
    expect(releaseProblem(m, signManifest(m, generateKeyPairSync('ed25519').privateKey), PUBLIC, '1.0.0')).toBe('signature_invalid');
    expect(releaseProblem(m, 'not-a-signature', PUBLIC, '1.0.0')).toBe('signature_invalid');
  });
  it('refuses a release that is not newer, and a manifest with a bad digest or name', () => {
    expect(releaseProblem(m, signManifest(m), PUBLIC, '2.0.0')).toBe('not_newer');
    expect(releaseProblem(m, signManifest(m), PUBLIC, '2.1.0')).toBe('not_newer');
    const bad = manifest('2.0.0', { migrationDigest: 'latest' });
    expect(releaseProblem(bad, signManifest(bad), PUBLIC, '1.0.0')).toBe('manifest_invalid');
    const weird = manifest('2.0.0', { images: [{ name: 'api; rm -rf /', digest: `sha256:${'a'.repeat(64)}` }] });
    expect(releaseProblem(weird, signManifest(weird), PUBLIC, '1.0.0')).toBe('manifest_invalid');
  });
});

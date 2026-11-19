import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const pem = (): string => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('configuration from a hosting panel', () => {
  it('accepts keys written on one line with \\n for the line breaks, and treats empty optional settings as unset', () => {
    const oneLine = pem().trim().replace(/\n/g, '\\n');
    const c = loadConfig({ DATABASE_URL: 'postgres://x/y', LICENCE_PRIVATE_KEY: oneLine, RELEASE_PRIVATE_KEY: oneLine, NODE_ENV: 'production', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), GATEWAY_TOKEN: 'g'.repeat(40), ESCROW_PUBLIC_KEY: '', REQUIRE_STAFF_MFA: '' } as NodeJS.ProcessEnv);
    expect(c.LICENCE_PRIVATE_KEY).toContain('\n'); expect(c.LICENCE_PRIVATE_KEY).not.toContain('\\n');
    expect(c.ESCROW_PUBLIC_KEY).toBeUndefined(); expect(c.REQUIRE_STAFF_MFA).toBeUndefined();
  });
});

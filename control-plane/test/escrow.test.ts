import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateEscrowKeys, openEscrow, sealToEscrow } from '../src/escrow.js';
import { testApp } from './support.js';

describe('escrow', () => {
  const keys = generateEscrowKeys();
  it('seals a key that only both shares together can open', () => {
    const sealed = sealToEscrow('client-backup-key-123', keys.publicKey);
    expect(sealed).not.toContain('client-backup-key');
    expect(openEscrow(sealed, keys.shares[0], keys.shares[1])).toBe('client-backup-key-123');
    expect(openEscrow(sealed, keys.shares[1], keys.shares[0])).toBe('client-backup-key-123'); // order does not matter
    expect(() => openEscrow(sealed, keys.shares[0], keys.shares[0])).toThrow(); // one share twice is nothing
    const other = generateEscrowKeys();
    expect(() => openEscrow(sealed, other.shares[0], other.shares[1])).toThrow(); // another escrow's shares do not fit
  });
  it('seals differently each time, so equal keys do not look equal', () => { expect(sealToEscrow('x', keys.publicKey)).not.toBe(sealToEscrow('x', keys.publicKey)); });
});

describe('backup keys in the control plane', () => {
  let t: Awaited<ReturnType<typeof testApp>>; let admin: { token: string }; let support: { token: string };
  const keys = generateEscrowKeys();
  beforeAll(async () => { t = await testApp({ ESCROW_PUBLIC_KEY: keys.publicKey }); admin = await t.staff('admin'); support = await t.staff('support'); });
  afterAll(async () => { await t.close(); });
  const site = async () => { const c = (await t.call('POST', '/clients', support.token, { name: 'C', tier: 'hybrid' })).json; return (await t.call('POST', '/sites', support.token, { clientId: c.id, code: `K-${Math.floor(Math.random() * 1e6)}`, name: 'S' })).json.id as string; };

  it('makes a key once, stores it only sealed, and lets two custodians open it', async () => {
    const id = await site();
    const made = await t.call('POST', `/sites/${id}/backup-key`, admin.token, {});
    expect(made.status).toBe(201); expect(made.json).toMatchObject({ version: 1 }); expect(made.json.passphrase).toHaveLength(43);
    const stored = (await t.pool.query('SELECT sealed FROM backup_keys WHERE site_id = $1', [id])).rows[0].sealed as string;
    expect(stored).not.toContain(made.json.passphrase);
    const escrow = (await t.call('GET', `/sites/${id}/backup-key/escrow`, admin.token)).json.items[0];
    expect(openEscrow(escrow.sealed, keys.shares[0], keys.shares[1])).toBe(made.json.passphrase);
    expect((await t.call('POST', `/sites/${id}/backup-key`, admin.token, {})).json.code).toBe('key_exists');
    const again = await t.call('POST', `/sites/${id}/backup-key`, admin.token, { rotate: true });
    expect(again.json).toMatchObject({ version: 2 }); expect(again.json.passphrase).not.toBe(made.json.passphrase);
    const log = (await t.call('GET', '/audit', admin.token)).json.items as { action: string }[];
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['backup_key.created', 'backup_key.escrow_read']));
  });
  it('is for admins only, and refuses without an escrow key or a site', async () => {
    const id = await site();
    expect((await t.call('POST', `/sites/${id}/backup-key`, support.token, {})).status).toBe(403);
    expect((await t.call('GET', `/sites/${id}/backup-key/escrow`, support.token)).status).toBe(403);
    expect((await t.call('POST', `/sites/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/backup-key`, admin.token, {})).json.code).toBe('not_found');
    const bare = await testApp(); const a = await bare.staff('admin');
    const c = (await bare.call('POST', '/clients', a.token, { name: 'C', tier: 'local' })).json;
    const s = (await bare.call('POST', '/sites', a.token, { clientId: c.id, code: 'NOESC', name: 'S' })).json.id;
    expect((await bare.call('POST', `/sites/${s}/backup-key`, a.token, {})).json.code).toBe('escrow_not_configured');
    await bare.close();
  });
});

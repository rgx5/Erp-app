import { describe, expect, it } from 'vitest';
import type { ControlPlane, SupportSessionInfo } from '../src/controlPlane.js';
import { MAX_ATTEMPTS, superviseSupport, type SupportPorts } from '../src/support.js';
import { tempState } from './helpers.js';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoFKLnBJyw5Ky+1HbM5H4Aa7yzP s@example.com';
function world() {
  let session: SupportSessionInfo | null = null;
  const states: string[] = [];
  const cp = {
    support: async () => ({ session, endedSessionIds: [] as string[] }),
    supportState: async (_id: string, b: { state: string; expiresAt?: string }) => { states.push(b.state); if (session) { if (b.state === 'awaiting_code') session = { ...session, status: 'awaiting_code', enteredCode: null }; if (b.state === 'open') session = { ...session, status: 'open', enteredCode: null, expiresAt: b.expiresAt ?? null }; if (b.state === 'refused' || b.state === 'closed') session = null; } },
  } as unknown as ControlPlane;
  let shown: string | null = null; let access: { key: string; until: Date } | null = null;
  const ports: SupportPorts = { showCode: async (c) => { shown = c; }, openAccess: async (key, until) => { access = { key, until }; }, closeAccess: async () => { access = null; } };
  return { cp, ports, states, state: tempState(), request: (o: Partial<SupportSessionInfo> = {}) => { session = { id: 's1', status: 'requested', reason: 'Printer problem', minutes: 30, publicKey: KEY, enteredCode: null, expiresAt: null, ...o }; },
    enter: (code: string) => { if (session) session = { ...session, enteredCode: code }; }, get shown() { return shown; }, get access() { return access; }, get session() { return session; }, endSession: () => { session = null; } };
}

describe('approved remote support', () => {
  it('shows the customer a code, and opens access only when that code comes back', async () => {
    const w = world(); w.request();
    expect(await superviseSupport(w.cp, w.ports, w.state)).toBe('awaiting_code');
    expect(w.shown).toMatch(/^\d{6}$/); expect(w.access).toBeNull(); expect(w.states).toEqual(['awaiting_code']);
    const now = new Date('2026-11-22T02:00:00Z');
    expect(await superviseSupport(w.cp, w.ports, w.state, now)).toBe('awaiting_code'); // nothing entered yet
    expect(w.access).toBeNull();
    w.enter(w.shown as string);
    expect(await superviseSupport(w.cp, w.ports, w.state, now)).toBe('opened');
    expect(w.access).toMatchObject({ key: KEY }); expect(w.access?.until.toISOString()).toBe('2026-11-22T02:30:00.000Z');
    expect(w.shown).toBeNull(); // the code is withdrawn once used
    expect(w.state.read().support).toMatchObject({ open: true, codeHash: null });
  });

  it('closes access by itself when the time is up, and when staff end the session', async () => {
    const w = world(); w.request();
    await superviseSupport(w.cp, w.ports, w.state); w.enter(w.shown as string);
    const start = new Date('2026-11-22T02:00:00Z');
    await superviseSupport(w.cp, w.ports, w.state, start);
    expect(await superviseSupport(w.cp, w.ports, w.state, new Date('2026-11-22T02:20:00Z'))).toBe('open');
    expect(await superviseSupport(w.cp, w.ports, w.state, new Date('2026-11-22T02:31:00Z'))).toBe('closed');
    expect(w.access).toBeNull(); expect(w.state.read().support).toBeNull();
    const w2 = world(); w2.request();
    await superviseSupport(w2.cp, w2.ports, w2.state); w2.enter(w2.shown as string);
    await superviseSupport(w2.cp, w2.ports, w2.state, start);
    w2.endSession(); // staff closed it
    expect(await superviseSupport(w2.cp, w2.ports, w2.state, new Date('2026-11-22T02:05:00Z'))).toBe('closed');
    expect(w2.access).toBeNull();
  });

  it('refuses the session after three wrong codes and never opens', async () => {
    const w = world(); w.request();
    await superviseSupport(w.cp, w.ports, w.state);
    const wrong = w.shown === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_ATTEMPTS; i++) { w.enter(wrong); expect(await superviseSupport(w.cp, w.ports, w.state)).toBe('wrong_code'); }
    w.enter(wrong);
    expect(await superviseSupport(w.cp, w.ports, w.state)).toBe('refused');
    expect(w.access).toBeNull(); expect(w.shown).toBeNull(); expect(w.states.at(-1)).toBe('refused');
  });

  it('does not open for a code entered before one was shown, and clears a stale display when the request disappears', async () => {
    const w = world(); w.request({ status: 'awaiting_code', enteredCode: '123456' }); // we never showed a code for this session
    expect(await superviseSupport(w.cp, w.ports, w.state)).not.toBe('opened');
    expect(w.access).toBeNull();
    const w2 = world(); w2.request();
    await superviseSupport(w2.cp, w2.ports, w2.state); expect(w2.shown).not.toBeNull();
    w2.endSession();
    expect(await superviseSupport(w2.cp, w2.ports, w2.state)).toBe('idle');
    expect(w2.shown).toBeNull();
  });
});

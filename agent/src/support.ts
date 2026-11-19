import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { ControlPlane } from './controlPlane.js';
import type { StateStore } from './state.js';

export interface SupportPorts {
  /** Shows the code to the customer (on the server console and in the product). */
  showCode(code: string | null): Promise<void>;
  /** Lets this public key in, until expiresAt. */
  openAccess(publicKey: string, expiresAt: Date): Promise<void>;
  closeAccess(): Promise<void>;
}
export const MAX_ATTEMPTS = 3;
const hashOf = (code: string): string => createHash('sha256').update(code).digest('hex');

/**
 * Approved remote support. Access opens only after the customer has read a code, shown on this site, to the person asking for it; it closes by
 * itself at the end; three wrong codes refuse the session. The code never goes to the control plane, so staff cannot approve themselves.
 */
export async function superviseSupport(cp: ControlPlane, ports: SupportPorts, state: StateStore, now: Date = new Date()): Promise<string> {
  const { session } = await cp.support();

  // Access that is open must close when the session ended, ran out of time, or is not the one we opened.
  let local = state.read().support;
  if (local?.open) {
    const expired = local.expiresAt !== null && new Date(local.expiresAt) <= now;
    const same = session?.id === local.sessionId;
    if (same && !expired) return 'open';
    await ports.closeAccess();
    await ports.showCode(null);
    state.update((s) => { s.support = null; });
    if (same) await cp.supportState(local.sessionId, { state: 'closed' }).catch(() => undefined);
    if (!session || same) return 'closed';
    local = null; // a different session is waiting: handle it below
  }
  if (!session) {
    if (local) { await ports.showCode(null); state.update((s) => { s.support = null; }); }
    return 'idle';
  }

  if (session.status === 'requested') {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    state.update((s) => { s.support = { sessionId: session.id, codeHash: hashOf(code), attempts: 0, open: false, expiresAt: null }; });
    await ports.showCode(code);
    await cp.supportState(session.id, { state: 'awaiting_code' });
    return 'awaiting_code';
  }
  if (session.status === 'awaiting_code' && session.enteredCode && local?.sessionId === session.id && local.codeHash && !local.open) {
    const a = Buffer.from(hashOf(session.enteredCode)); const b = Buffer.from(local.codeHash);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      const expiresAt = new Date(now.getTime() + session.minutes * 60_000);
      await ports.openAccess(session.publicKey, expiresAt);
      state.update((s) => { if (s.support) { s.support.open = true; s.support.expiresAt = expiresAt.toISOString(); s.support.codeHash = null; } });
      await ports.showCode(null);
      await cp.supportState(session.id, { state: 'open', expiresAt: expiresAt.toISOString() });
      return 'opened';
    }
    const attempts = local.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      state.update((s) => { s.support = null; });
      await ports.showCode(null);
      await cp.supportState(session.id, { state: 'refused' });
      return 'refused';
    }
    state.update((s) => { if (s.support) s.support.attempts = attempts; });
    await cp.supportState(session.id, { state: 'awaiting_code' }); // clears the wrong code so it can be entered again
    return 'wrong_code';
  }
  return session.status;
}

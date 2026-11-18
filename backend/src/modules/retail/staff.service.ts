import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { Recorder } from '../masterdata/helpers.js';
import { hashPassword, verifyPassword } from '../identity/password.js';
import { posSaleApprovals, posSaleStaff, posStaffPins } from './retail.schema.js';
import { users } from '../identity/identity.schema.js';

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

/** Counter PINs: each user may set a short PIN; a user holding `pos:approve` can then approve a discount at the till by entering it. */
@Injectable()
export class StaffService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  setPin(tenantId: string, userId: string, pin: string) {
    if (!/^[0-9]{4,8}$/.test(pin)) throw validationFailed([{ path: 'pin', message: 'A PIN is 4 to 8 digits' }]);
    return this.uow.inTenant(tenantId, async (tx) => {
      const pinHash = await hashPassword(pin);
      await tx.insert(posStaffPins).values({ tenantId, userId, pinHash }).onConflictDoUpdate({ target: [posStaffPins.tenantId, posStaffPins.userId], set: { pinHash, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() } });
      await this.recorder.record(tx, tenantId, 'pos_pin', 'set', { id: userId }, {});
      return { set: true };
    });
  }

  /** People who can approve at the till: holders of `pos:approve` who have set a PIN. */
  approvers(tenantId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.execute<{ id: string; display_name: string }>(sql`
        SELECT u.id, u.display_name FROM erp.users u
         JOIN erp.pos_staff_pins p ON p.tenant_id = u.tenant_id AND p.user_id = u.id
        WHERE u.tenant_id = ${tenantId}::uuid AND u.status = 'active'
          AND EXISTS (SELECT 1 FROM erp.user_roles ur JOIN erp.roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
                       WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL AND ('pos:approve' = ANY (r.permissions) OR '*' = ANY (r.permissions)))
        ORDER BY u.display_name`);
      return rows.rows.map((r) => ({ id: r.id, displayName: r.display_name }));
    }, { readOnly: true });
  }

  /** A check on its own: wrong PINs are counted and lock the approver after a few tries, so a till cannot be used to guess a manager's PIN. */
  async verify(tenantId: string, input: { userId: string; pin: string }): Promise<{ approvedBy: string; displayName: string }> {
    const result = await this.uow.inTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(posStaffPins).where(and(eq(posStaffPins.tenantId, tenantId), eq(posStaffPins.userId, input.userId))).for('update');
      if (row?.lockedUntil && row.lockedUntil > new Date()) return { error: 'approver_locked' as const };
      const good = row ? await verifyPassword(row.pinHash, input.pin) : false;
      if (!row || !good) {
        if (row) {
          const fails = row.failedAttempts + 1;
          await tx.update(posStaffPins).set({ failedAttempts: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null }).where(and(eq(posStaffPins.tenantId, tenantId), eq(posStaffPins.userId, input.userId)));
        }
        return { error: 'approval_refused' as const };
      }
      if (row.failedAttempts > 0) await tx.update(posStaffPins).set({ failedAttempts: 0 }).where(and(eq(posStaffPins.tenantId, tenantId), eq(posStaffPins.userId, input.userId)));
      return { ok: await this.requireApprover(tx, tenantId, input.userId) };
    });
    if ('error' in result) {
      if (result.error === 'approver_locked') throw new AppError(429, 'approver_locked', `That approver is locked for ${LOCK_MINUTES} minutes after too many wrong PINs`);
      throw new AppError(403, 'approval_refused', 'The PIN is wrong, or that person cannot approve');
    }
    return { approvedBy: input.userId, displayName: result.ok };
  }

  private async requireApprover(tx: Tx, tenantId: string, userId: string): Promise<string> {
    const r = await tx.execute<{ display_name: string }>(sql`
      SELECT u.display_name FROM erp.users u
       WHERE u.tenant_id = ${tenantId}::uuid AND u.id = ${userId}::uuid AND u.status = 'active'
         AND EXISTS (SELECT 1 FROM erp.user_roles ur JOIN erp.roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
                      WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id AND ur.revoked_at IS NULL AND ('pos:approve' = ANY (r.permissions) OR '*' = ANY (r.permissions)))`);
    const row = r.rows[0];
    if (!row) throw new AppError(403, 'approval_refused', 'The PIN is wrong, or that person cannot approve');
    return row.display_name;
  }

  /** Inside a sale: checks the approver's PIN again (without counting failures: the verify call above does that) and records the approval. */
  async approveSale(tx: Tx, tenantId: string, saleId: string, input: { userId: string; pin: string }, highest: string): Promise<void> {
    const [row] = await tx.select().from(posStaffPins).where(and(eq(posStaffPins.tenantId, tenantId), eq(posStaffPins.userId, input.userId)));
    if (!row || (row.lockedUntil && row.lockedUntil > new Date()) || !(await verifyPassword(row.pinHash, input.pin))) throw new AppError(403, 'approval_refused', 'The PIN is wrong, or that person cannot approve');
    await this.requireApprover(tx, tenantId, input.userId);
    await tx.insert(posSaleApprovals).values({ tenantId, posSaleId: saleId, approvedBy: input.userId, highestDiscount: highest });
  }

  /** Credits each line to the salesperson named on it. */
  async creditLines(tx: Tx, tenantId: string, saleId: string, lines: { salespersonId?: string | undefined }[]): Promise<void> {
    const rows = lines.flatMap((l, i) => (l.salespersonId ? [{ tenantId, posSaleId: saleId, lineNo: i + 1, salespersonId: l.salespersonId }] : []));
    if (rows.length === 0) return;
    const ids = [...new Set(rows.map((r) => r.salespersonId))];
    const found = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)));
    if (found.length !== ids.length) throw validationFailed([{ path: 'lines.salespersonId', message: 'A salesperson is not a user of this business' }]);
    await tx.insert(posSaleStaff).values(rows);
  }
}

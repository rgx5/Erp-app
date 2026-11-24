import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { Recorder } from '../masterdata/helpers.js';

/** The log of payment reminders sent (by WhatsApp, SMS, email, a call, or text copied out), so people can see who was chased and when. */
@Injectable()
export class RemindersService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  record(tenantId: string, actorId: string, input: { companyId: string; customerId: string; channel: string; amountDue: string; message: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const customer = await tx.execute(sql`SELECT 1 FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${input.customerId}::uuid AND is_customer`);
      if (customer.rows.length === 0) throw new AppError(404, 'not_found', 'Customer not found');
      const id = uuidv7();
      const r = await tx.execute<{ created_at: string }>(sql`INSERT INTO erp.payment_reminders (tenant_id, id, company_id, customer_id, channel, amount_due, message, created_by) VALUES (${tenantId}::uuid, ${id}::uuid, ${input.companyId}::uuid, ${input.customerId}::uuid, ${input.channel}, ${input.amountDue}::numeric, ${input.message}, ${actorId}::uuid) RETURNING created_at`);
      await this.recorder.record(tx, tenantId, 'payment_reminder', 'sent', { id }, { customerId: input.customerId, channel: input.channel, amountDue: input.amountDue });
      return { id, ...input, createdAt: new Date(r.rows[0]?.created_at ?? Date.now()).toISOString() };
    });
  }

  /** The latest reminder for each customer. */
  latest(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ customer_id: string; channel: string; amount_due: string; created_at: string; sent_by: string | null }>(sql`
      SELECT DISTINCT ON (r.customer_id) r.customer_id, r.channel, r.amount_due::text AS amount_due, r.created_at, u.display_name AS sent_by
        FROM erp.payment_reminders r LEFT JOIN erp.users u ON u.tenant_id = r.tenant_id AND u.id = r.created_by
       WHERE r.tenant_id = ${tenantId}::uuid AND r.company_id = ${companyId}::uuid ORDER BY r.customer_id, r.created_at DESC`)).rows
      .map((r) => ({ customerId: r.customer_id, channel: r.channel, amountDue: r.amount_due, sentAt: new Date(r.created_at).toISOString(), sentBy: r.sent_by })), { readOnly: true });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { Recorder } from '../masterdata/helpers.js';

/** What can carry attachments, which table to check the record in, and what a person needs to see or change them. */
export const ENTITIES = {
  item: { table: 'items', read: 'masterdata:read', write: 'masterdata:write' },
  party: { table: 'parties', read: 'masterdata:read', write: 'masterdata:write' },
  sales_invoice: { table: 'sales_invoices', read: 'sales:read', write: 'sales:post' },
  sales_order: { table: 'sales_orders', read: 'sales:read', write: 'sales:post' },
  sales_quote: { table: 'sales_quotes', read: 'sales:read', write: 'sales:post' },
  purchase_order: { table: 'purchase_orders', read: 'purchasing:read', write: 'purchasing:post' },
  supplier_bill: { table: 'supplier_bills', read: 'payables:read', write: 'payables:post' },
  expense_voucher: { table: 'expense_vouchers', read: 'accounting:read', write: 'accounting:post' },
} as const;
export type EntityType = keyof typeof ENTITIES;
export const ENTITY_TYPES = Object.keys(ENTITIES) as [EntityType, ...EntityType[]];
export const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_PER_RECORD = 20;

/** Looks like what it claims to be: the first bytes of a JPEG, PNG, WebP or PDF. */
export function matchesType(bytes: Buffer, type: string): boolean {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/webp') return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  return false;
}

export interface AttachmentMeta { id: string; entityType: string; entityId: string; kind: string; filename: string; contentType: string; sizeBytes: number; createdAt: string }

@Injectable()
export class AttachmentsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  async add(tenantId: string, actorId: string, input: { entityType: EntityType; entityId: string; kind: 'file' | 'photo'; filename: string; contentType: string; dataBase64: string }): Promise<AttachmentMeta> {
    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length === 0) throw validationFailed([{ path: 'dataBase64', message: 'The file is empty' }]);
    if (bytes.length > MAX_FILE_BYTES) throw new AppError(413, 'file_too_large', `A file can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    if (!matchesType(bytes, input.contentType)) throw validationFailed([{ path: 'contentType', message: `The file is not really ${input.contentType}` }]);
    if (input.kind === 'photo' && !input.contentType.startsWith('image/')) throw validationFailed([{ path: 'kind', message: 'A photo must be an image' }]);
    const name = input.filename.replace(/[\\/\u0000-\u001f]+/g, '_').trim().slice(0, 200);
    return this.uow.inTenant(tenantId, async (tx) => {
      const exists = await tx.execute(sql`SELECT 1 FROM ${sql.raw(`erp.${ENTITIES[input.entityType].table}`)} WHERE tenant_id = ${tenantId}::uuid AND id = ${input.entityId}::uuid`);
      if (exists.rows.length === 0) throw new AppError(404, 'not_found', 'That record does not exist');
      if (input.kind === 'photo') await tx.execute(sql`DELETE FROM erp.attachments WHERE tenant_id = ${tenantId}::uuid AND entity_type = ${input.entityType} AND entity_id = ${input.entityId}::uuid AND kind = 'photo'`); // one photo: a new one replaces it
      const count = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM erp.attachments WHERE tenant_id = ${tenantId}::uuid AND entity_type = ${input.entityType} AND entity_id = ${input.entityId}::uuid`);
      if ((count.rows[0]?.n ?? 0) >= MAX_PER_RECORD) throw new AppError(409, 'too_many_files', `A record can hold at most ${MAX_PER_RECORD} files`);
      const id = uuidv7();
      const sha = createHash('sha256').update(bytes).digest('hex');
      const r = await tx.execute<{ created_at: string }>(sql`INSERT INTO erp.attachments (tenant_id, id, entity_type, entity_id, kind, filename, content_type, size_bytes, sha256, data, created_by) VALUES (${tenantId}::uuid, ${id}::uuid, ${input.entityType}, ${input.entityId}::uuid, ${input.kind}, ${name || 'file'}, ${input.contentType}, ${bytes.length}, ${sha}, ${bytes}, ${actorId}::uuid) RETURNING created_at`);
      await this.recorder.record(tx, tenantId, 'attachment', 'added', { id }, { entityType: input.entityType, entityId: input.entityId, filename: name, sizeBytes: bytes.length });
      return { id, entityType: input.entityType, entityId: input.entityId, kind: input.kind, filename: name || 'file', contentType: input.contentType, sizeBytes: bytes.length, createdAt: new Date(r.rows[0]?.created_at ?? Date.now()).toISOString() };
    });
  }

  list(tenantId: string, entityType: EntityType, entityId: string): Promise<AttachmentMeta[]> {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ id: string; entity_type: string; entity_id: string; kind: string; filename: string; content_type: string; size_bytes: number; created_at: string }>(sql`
      SELECT id, entity_type, entity_id, kind, filename, content_type, size_bytes, created_at FROM erp.attachments WHERE tenant_id = ${tenantId}::uuid AND entity_type = ${entityType} AND entity_id = ${entityId}::uuid ORDER BY created_at`)).rows
      .map((r) => ({ id: r.id, entityType: r.entity_type, entityId: r.entity_id, kind: r.kind, filename: r.filename, contentType: r.content_type, sizeBytes: r.size_bytes, createdAt: new Date(r.created_at).toISOString() })), { readOnly: true });
  }

  /** The file itself, and the record it belongs to (so the caller can check the person may see that kind of record). */
  async content(tenantId: string, id: string): Promise<{ entityType: EntityType; filename: string; contentType: string; data: Buffer }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute<{ entity_type: EntityType; filename: string; content_type: string; data: Buffer }>(sql`SELECT entity_type, filename, content_type, data FROM erp.attachments WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const row = r.rows[0];
      if (!row) throw new AppError(404, 'not_found', 'Attachment not found');
      return { entityType: row.entity_type, filename: row.filename, contentType: row.content_type, data: Buffer.from(row.data) };
    }, { readOnly: true });
  }

  async remove(tenantId: string, id: string): Promise<{ entityType: EntityType }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute<{ entity_type: EntityType; entity_id: string; filename: string }>(sql`DELETE FROM erp.attachments WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid RETURNING entity_type, entity_id, filename`);
      const row = r.rows[0];
      if (!row) throw new AppError(404, 'not_found', 'Attachment not found');
      await this.recorder.record(tx, tenantId, 'attachment', 'removed', { id }, { entityType: row.entity_type, entityId: row.entity_id, filename: row.filename });
      return { entityType: row.entity_type };
    });
  }

  /** The type of an attachment, to decide whether the person may remove it. */
  async typeOf(tenantId: string, id: string): Promise<EntityType> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute<{ entity_type: EntityType }>(sql`SELECT entity_type FROM erp.attachments WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      if (!r.rows[0]) throw new AppError(404, 'not_found', 'Attachment not found');
      return r.rows[0].entity_type;
    }, { readOnly: true });
  }
}

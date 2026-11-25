import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { SECRET_BOX } from '../identity/crypto.providers.js';
import type { SecretBox } from '../identity/secret-box.js';
import { Recorder } from '../masterdata/helpers.js';

export type ConnectorKind = 'website' | 'meta' | 'google' | 'webhook';
export interface ConnectorConfig { allowedDomains?: string[]; pageId?: string; formIds?: string[]; verifyToken?: string; googleKey?: string; hasPageToken?: boolean; hasAppSecret?: boolean; source?: string; defaultCampaign?: string }
type Row = { id: string; kind: ConnectorKind; name: string; status: string; public_id: string; config: ConnectorConfig; secret_sealed: string | null; lead_count: number; last_lead_at: string | null; last_error: string | null; created_at: string };

const token = (bytes: number): string => randomBytes(bytes).toString('base64url');
const present = (r: Row) => ({
  id: r.id, kind: r.kind, name: r.name, status: r.status, publicId: r.public_id, path: `/v1/ingest/${r.kind === 'webhook' ? 'website' : r.kind}/${r.public_id}`,
  config: { allowedDomains: r.config.allowedDomains ?? [], pageId: r.config.pageId ?? null, formIds: r.config.formIds ?? [], verifyToken: r.config.verifyToken ?? null, googleKey: r.config.googleKey ?? null, hasPageToken: Boolean(r.secret_sealed), hasAppSecret: Boolean(r.config.hasAppSecret), defaultCampaign: r.config.defaultCampaign ?? null },
  leadCount: r.lead_count, lastLeadAt: r.last_lead_at ? new Date(r.last_lead_at).toISOString() : null, lastError: r.last_error, createdAt: new Date(r.created_at).toISOString(),
});

/** The secrets a connector holds are sealed with the server's key and bound to this business and connector: a database copy alone does not give them up. */
@Injectable()
export class ConnectorsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder, @Inject(SECRET_BOX) private readonly box: SecretBox) {}
  readonly aad = (tenantId: string, id: string, what: string): string => `lead-connector:${tenantId}:${id}:${what}`;

  list(tenantId: string) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.execute<Row>(sql`SELECT id, kind, name, status, public_id, config, secret_sealed, lead_count, last_lead_at, last_error, created_at FROM erp.lead_connectors WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at`)).rows.map(present), { readOnly: true });
  }

  create(tenantId: string, actorId: string, input: { kind: ConnectorKind; name: string; allowedDomains?: string[] | undefined; pageId?: string | undefined; formIds?: string[] | undefined; pageAccessToken?: string | undefined; appSecret?: string | undefined; defaultCampaign?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const id = uuidv7(); const publicId = token(18);
      if (input.kind === 'meta' && !input.pageAccessToken) throw validationFailed([{ path: 'pageAccessToken', message: 'A Meta connector needs the page access token' }]);
      const config: ConnectorConfig = {
        ...(input.allowedDomains?.length ? { allowedDomains: input.allowedDomains.map((d) => d.trim().toLowerCase()) } : {}), ...(input.pageId ? { pageId: input.pageId.trim() } : {}), ...(input.formIds?.length ? { formIds: input.formIds } : {}), ...(input.defaultCampaign ? { defaultCampaign: input.defaultCampaign } : {}),
        ...(input.kind === 'meta' ? { verifyToken: token(18) } : {}), ...(input.kind === 'google' ? { googleKey: token(18) } : {}),
        ...(input.appSecret ? { hasAppSecret: true } : {}),
      };
      const sealed = input.pageAccessToken ? this.box.seal(input.pageAccessToken, this.aad(tenantId, id, 'token')) : null;
      await tx.execute(sql`INSERT INTO erp.lead_connectors (tenant_id, id, kind, name, public_id, config, secret_sealed, created_by) VALUES (${tenantId}::uuid, ${id}::uuid, ${input.kind}, ${input.name.trim()}, ${publicId}, ${JSON.stringify(config)}::jsonb, ${sealed}, ${actorId}::uuid)`);
      if (input.appSecret) await tx.execute(sql`UPDATE erp.lead_connectors SET config = config || ${JSON.stringify({ appSecretSealed: this.box.seal(input.appSecret, this.aad(tenantId, id, 'app')) })}::jsonb WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await tx.execute(sql`INSERT INTO erp.lead_ingest_keys (public_id, tenant_id, connector_id) VALUES (${publicId}, ${tenantId}::uuid, ${id}::uuid)`);
      await this.recorder.record(tx, tenantId, 'lead_connector', 'created', { id }, { kind: input.kind, name: input.name });
      const r = (await tx.execute<Row>(sql`SELECT id, kind, name, status, public_id, config, secret_sealed, lead_count, last_lead_at, last_error, created_at FROM erp.lead_connectors WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`)).rows[0] as Row;
      return present(r);
    });
  }

  update(tenantId: string, id: string, input: { name?: string | undefined; status?: 'active' | 'paused' | undefined; allowedDomains?: string[] | undefined; pageId?: string | undefined; formIds?: string[] | undefined; pageAccessToken?: string | undefined; defaultCampaign?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cur = (await tx.execute<Row>(sql`SELECT id, kind, name, status, public_id, config, secret_sealed, lead_count, last_lead_at, last_error, created_at FROM erp.lead_connectors WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw new AppError(404, 'not_found', 'Connector not found');
      const config = { ...cur.config, ...(input.allowedDomains ? { allowedDomains: input.allowedDomains.map((d) => d.trim().toLowerCase()) } : {}), ...(input.pageId !== undefined ? { pageId: input.pageId.trim() || undefined } : {}), ...(input.formIds ? { formIds: input.formIds } : {}), ...(input.defaultCampaign !== undefined ? { defaultCampaign: input.defaultCampaign || undefined } : {}) };
      const sealed = input.pageAccessToken ? this.box.seal(input.pageAccessToken, this.aad(tenantId, id, 'token')) : cur.secret_sealed;
      await tx.execute(sql`UPDATE erp.lead_connectors SET name = ${input.name?.trim() || cur.name}, status = ${input.status ?? cur.status}, config = ${JSON.stringify(config)}::jsonb, secret_sealed = ${sealed}, last_error = ${input.pageAccessToken ? null : cur.last_error} WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.recorder.record(tx, tenantId, 'lead_connector', 'updated', { id }, { fields: Object.keys(input).filter((k) => k !== 'pageAccessToken') });
      return { ok: true };
    });
  }

  remove(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute(sql`DELETE FROM erp.lead_ingest_keys WHERE tenant_id = ${tenantId}::uuid AND connector_id = ${id}::uuid`);
      const del = await tx.execute(sql`DELETE FROM erp.lead_connectors WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      if ((del.rowCount ?? 0) === 0 && (r.rowCount ?? 0) === 0) throw new AppError(404, 'not_found', 'Connector not found');
      await tx.execute(sql`DELETE FROM erp.lead_deliveries WHERE tenant_id = ${tenantId}::uuid AND connector_id = ${id}::uuid`);
      await this.recorder.record(tx, tenantId, 'lead_connector', 'deleted', { id });
      return { ok: true };
    });
  }

  deliveries(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ id: string; outcome: string; detail: string | null; external_id: string | null; created_at: string }>(sql`SELECT id, outcome, detail, external_id, created_at FROM erp.lead_deliveries WHERE tenant_id = ${tenantId}::uuid AND connector_id = ${id}::uuid ORDER BY created_at DESC LIMIT 50`)).rows.map((d) => ({ id: d.id, outcome: d.outcome, detail: d.detail, externalId: d.external_id, createdAt: new Date(d.created_at).toISOString() })), { readOnly: true });
  }
}

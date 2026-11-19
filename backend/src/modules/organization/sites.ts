import { Body, Controller, Get, Headers, Inject, Injectable, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { assertWithinLimit } from '../identity/entitlements.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';
import { first, Recorder, updateVersioned } from '../masterdata/helpers.js';
import { sites } from './organization.schema.js';

export type SiteRow = typeof sites.$inferSelect;
const code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/, 'Letters, digits, - or _ (max 20)');
export const createSiteSchema = z.strictObject({
  code, name: z.string().trim().min(1).max(100),
  /** One or two capital letters or digits added to the prefix of document numbers issued at this site (so sites never clash). The primary site has none. */
  seriesCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,2}$/, 'One or two capital letters or digits').optional(),
  isPrimary: z.boolean().default(false),
}).refine((v) => v.isPrimary || v.seriesCode !== undefined, { path: ['seriesCode'], message: 'A site other than the primary one needs a number series code' }).refine((v) => !v.isPrimary || v.seriesCode === undefined, { path: ['seriesCode'], message: 'The primary site has no series code' });
export const updateSiteSchema = z.strictObject({ name: z.string().trim().min(1).max(100).optional(), status: z.enum(['active', 'closed']).optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
const presentSite = (s: SiteRow) => ({ id: s.id, code: s.code, name: s.name, seriesCode: s.seriesCode, isPrimary: s.isPrimary, status: s.status, version: s.version });

/** The places a client's server runs. A record with no site belongs to the primary site. */
@Injectable()
export class SitesService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  list(tenantId: string) {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(sites).where(eq(sites.tenantId, tenantId)).orderBy(asc(sites.createdAt)), { readOnly: true });
  }
  create(tenantId: string, input: z.infer<typeof createSiteSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await assertWithinLimit(tx, tenantId, 'sites');
      try {
        const row = first(await tx.insert(sites).values({ tenantId, id: uuidv7(), code: input.code, name: input.name, seriesCode: input.isPrimary ? '' : (input.seriesCode as string), isPrimary: input.isPrimary }).returning(), 'Site');
        return await this.recorder.record(tx, tenantId, 'site', 'created', row, { code: row.code, seriesCode: row.seriesCode });
      } catch (e) {
        const c = (e as { cause?: { code?: string; constraint?: string } }).cause;
        if (c?.code === '23505') throw new AppError(409, 'site_exists', c.constraint === 'sites_one_primary' ? 'This business already has a primary site' : c.constraint === 'sites_series_code_unique' ? 'Another site already uses that number series code' : 'A site with that code already exists');
        throw e;
      }
    });
  }
  update(tenantId: string, id: string, version: number, input: { name?: string | undefined; status?: 'active' | 'closed' | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [current] = await tx.select().from(sites).where(and(eq(sites.tenantId, tenantId), eq(sites.id, id)));
      if (current?.isPrimary && input.status === 'closed') throw new AppError(409, 'primary_site', 'The primary site cannot be closed');
      return this.recorder.record(tx, tenantId, 'site', 'updated', await updateVersioned<SiteRow>(tx, sites, tenantId, id, version, input, 'Site'), { fields: Object.keys(input) });
    });
  }
}

@ApiTags('sites')
@ApiBearerAuth()
@Controller('v1/sites')
export class SitesController {
  constructor(@Inject(SitesService) private readonly service: SitesService) {}

  @RequirePermissions('organization:read') @Get()
  async list(@TenantId() t: string) { return { items: (await this.service.list(t)).map(presentSite) }; }
  @RequirePermissions('organization:write') @Idempotent() @Post() @ApiZodBody(createSiteSchema)
  async create(@TenantId() t: string, @Body({ schema: createSiteSchema }) b: z.infer<typeof createSiteSchema>) { return presentSite(await this.service.create(t, b)); }
  /** Requires `If-Match: <version>`. */
  @RequirePermissions('organization:write') @Patch(':id') @ApiZodBody(updateSiteSchema)
  async update(@TenantId() t: string, @Param('id', { schema: z.uuid() }) id: string, @Headers('if-match') m: string | undefined, @Body({ schema: updateSiteSchema }) b: z.infer<typeof updateSiteSchema>) {
    const version = Number((m ?? '').replaceAll('"', ''));
    if (!m || !Number.isInteger(version) || version < 1) throw preconditionRequired('Send the version you read in the If-Match header');
    return presentSite(await this.service.update(t, id, version, b));
  }
}

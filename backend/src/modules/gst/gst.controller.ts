import { Body, Controller, Get, Inject, Module, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { GstReturnsService } from './returns.service.js';

const id = z.uuid();
const monthQuery = z.object({ registrationId: z.uuid(), period: z.string().regex(/^\d{4}-\d{2}$/, 'A month as YYYY-MM') });
const quarterQuery = z.object({ registrationId: z.uuid(), quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'A financial-year quarter as YYYY-Qn') });
const settingsSchema = z.strictObject({ compositionRate: z.string().regex(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/, 'A percentage as a string').nullable() });

@ApiTags('gst returns')
@ApiBearerAuth()
@Controller('v1/gst')
export class GstController {
  constructor(@Inject(GstReturnsService) private readonly returns: GstReturnsService) {}

  @RequirePermissions('gst:read') @Get('registrations/:id/return-settings')
  getSettings(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return this.returns.getSettings(t, i); }
  @RequirePermissions('gst:manage') @Put('registrations/:id/return-settings') @ApiZodBody(settingsSchema)
  putSettings(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: settingsSchema }) b: { compositionRate: string | null }) { return this.returns.putSettings(t, i, b.compositionRate); }

  /** Outward supplies of a month in the GSTR-1 sections (b2b, b2cl, b2cs, exp, cdnr, cdnur, nil, hsn, documents issued). */
  @RequirePermissions('gst:read') @Get('returns/gstr1')
  gstr1(@TenantId() t: string, @Query({ schema: monthQuery }) q: z.infer<typeof monthQuery>) { return this.returns.gstr1(t, q.registrationId, q.period); }
  /** The monthly summary return: outward and inward supplies, input credit, and how the tax is paid. */
  @RequirePermissions('gst:read') @Get('returns/gstr3b')
  gstr3b(@TenantId() t: string, @Query({ schema: monthQuery }) q: z.infer<typeof monthQuery>) { return this.returns.gstr3b(t, q.registrationId, q.period); }
  @RequirePermissions('gst:read') @Get('returns/itc-register')
  itcRegister(@TenantId() t: string, @Query({ schema: monthQuery }) q: z.infer<typeof monthQuery>) { return this.returns.itcRegister(t, q.registrationId, q.period); }
  /** The composition taxpayer's quarterly statement of payment. */
  @RequirePermissions('gst:read') @Get('returns/cmp08')
  cmp08(@TenantId() t: string, @Query({ schema: quarterQuery }) q: z.infer<typeof quarterQuery>) { return this.returns.cmp08(t, q.registrationId, q.quarter); }
}

@Module({ controllers: [GstController], providers: [Recorder, GstReturnsService], exports: [GstReturnsService] })
export class GstModule {}

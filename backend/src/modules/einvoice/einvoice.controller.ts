import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { RequiresModule } from '../identity/entitlements.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { EInvoiceService } from './einvoice.service.js';

const id = z.uuid();
const fileSchema = z.strictObject({ invoiceIds: z.array(z.uuid()).min(1).max(200) });
const replyItem = z.object({
  irn: z.string().max(64).optional(), ackNo: z.union([z.string().max(40), z.number()]).optional(), ackDate: z.string().max(40).optional(),
  signedQr: z.string().max(20_000).optional(), signedInvoice: z.string().max(200_000).optional(), docNo: z.string().max(40).optional(),
});
const replySchema = z.strictObject({ items: z.array(replyItem).min(1).max(500) });
const manualSchema = z.strictObject({ irn: z.string().trim().length(64), ackNo: z.string().trim().min(1).max(40), ackDate: z.string().trim().min(8).max(40), signedQr: z.string().trim().min(10).max(20_000) });
const cancelSchema = z.strictObject({ reason: z.string().trim().min(3).max(200) });
const pendingQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), state: z.enum(['pending', 'issued', 'all']).default('pending') });
const transport = z.strictObject({
  mode: z.enum(['road', 'rail', 'air', 'ship']).default('road'), distanceKm: z.number().int().min(1).max(4000), vehicleNo: z.string().trim().max(15).optional(), vehicleType: z.enum(['regular', 'odc']).optional(),
  transporterId: z.string().trim().length(15).optional(), transporterName: z.string().trim().max(100).optional(), transDocNo: z.string().trim().max(15).optional(), transDocDate: z.iso.date().optional(),
});
const ewayRecord = z.strictObject({
  billNo: z.string().regex(/^[0-9]{12}$/, 'An e-way bill number is 12 digits'), billDate: z.string().trim().min(8).max(40), validUntil: z.string().trim().min(8).max(40).optional(),
  transportMode: z.enum(['road', 'rail', 'air', 'ship']).default('road'), distanceKm: z.number().int().min(1).max(4000).optional(), vehicleNo: z.string().trim().max(15).optional(),
  transporterId: z.string().trim().length(15).optional(), transporterName: z.string().trim().max(100).optional(), transDocNo: z.string().trim().max(15).optional(),
});

@ApiTags('einvoice')
@ApiBearerAuth()
@RequiresModule('sales')
@Controller('v1')
export class EInvoiceController {
  constructor(@Inject(EInvoiceService) private readonly svc: EInvoiceService) {}

  @RequirePermissions('sales:read') @Get('einvoice/pending')
  pending(@TenantId() t: string, @Query({ schema: pendingQuery }) q: z.infer<typeof pendingQuery>) { return this.svc.pending(t, q); }

  /** The e-invoice state of one invoice: what is wrong, the reference number the portal will give, what was recorded, and its e-way bills. */
  @RequirePermissions('sales:read') @Get('einvoice/invoices/:id')
  status(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return this.svc.status(t, i); }

  /** The upload file for the e-invoice portal: one JSON with every chosen invoice that is ready. */
  @RequirePermissions('sales:post') @Post('einvoice/file') @HttpCode(200) @ApiZodBody(fileSchema)
  file(@TenantId() t: string, @Body({ schema: fileSchema }) b: z.infer<typeof fileSchema>) { return this.svc.file(t, b.invoiceIds); }

  /** The portal's reply file, loaded back. */
  @RequirePermissions('sales:post') @Post('einvoice/reply') @HttpCode(200) @ApiZodBody(replySchema)
  reply(@CurrentPrincipal() a: Principal, @Body({ schema: replySchema }) b: z.infer<typeof replySchema>) { return this.svc.recordReply(a.tenantId, a.userId, b.items); }

  @RequirePermissions('sales:post') @Post('einvoice/invoices/:id/record') @ApiZodBody(manualSchema)
  record(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: manualSchema }) b: z.infer<typeof manualSchema>) { return this.svc.recordManual(a.tenantId, a.userId, i, b); }

  /** Records that the IRN was cancelled on the portal, so the invoice can then be cancelled here. */
  @RequirePermissions('sales:cancel') @Post('einvoice/invoices/:id/cancel') @HttpCode(200) @ApiZodBody(cancelSchema)
  cancel(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: cancelSchema }) b: z.infer<typeof cancelSchema>) { return this.svc.cancelRecord(t, i, b.reason); }

  @RequirePermissions('sales:read') @Post('eway/invoices/:id/check') @HttpCode(200) @ApiZodBody(transport)
  ewayCheck(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: transport }) b: z.infer<typeof transport>) { return this.svc.ewayCheck(t, i, b); }

  @RequirePermissions('sales:post') @Post('eway/invoices/:id/file') @HttpCode(200) @ApiZodBody(transport)
  ewayFile(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: transport }) b: z.infer<typeof transport>) { return this.svc.ewayFile(t, i, b); }

  @RequirePermissions('sales:post') @Post('eway/invoices/:id/record') @ApiZodBody(ewayRecord)
  ewayRecord(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: ewayRecord }) b: z.infer<typeof ewayRecord>) { return this.svc.recordEway(a.tenantId, a.userId, i, b); }

  @RequirePermissions('sales:post') @Post('eway/invoices/:id/cancel') @HttpCode(200)
  ewayCancel(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return this.svc.cancelEway(t, i); }
}

@Module({ controllers: [EInvoiceController], providers: [EInvoiceService, Recorder] })
export class EInvoiceModule {}

import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { CountsService, type CountLineRow, type CountRow } from './counts.service.js';
import * as s from './inventory.schemas.js';
import { ReservationsService } from './reservations.service.js';
import { TransfersService, type TransferLineRow, type TransferRow } from './transfers.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};
const presentTransfer = (r: { transfer: TransferRow; lines: TransferLineRow[] }) => ({ ...strip(r.transfer), lines: r.lines.map(strip) });
const presentCount = (r: { count: CountRow; lines: CountLineRow[] }) => ({ ...strip(r.count), lines: r.lines.map(strip) });

@ApiTags('stock operations')
@ApiBearerAuth()
@Controller('v1/stock')
export class StockOperationsController {
  constructor(
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(CountsService) private readonly counts: CountsService,
  ) {}

  // ---- reservations ---------------------------------------------------------------------------------------------
  @RequirePermissions('stock:post') @Idempotent() @Post('reservations') @ApiZodBody(s.createReservationSchema)
  async reserve(@CurrentPrincipal() a: Principal, @Body({ schema: s.createReservationSchema }) b: z.infer<typeof s.createReservationSchema>) { return strip(await this.reservations.create(a.tenantId, a.userId, b)); }
  @RequirePermissions('stock:read') @Get('reservations')
  async listReservations(@TenantId() t: string, @Query({ schema: s.listReservationsQuery }) q: z.infer<typeof s.listReservationsQuery>) { const p = await this.reservations.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('stock:read') @Get('reservations/:id')
  async getReservation(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return strip(await this.reservations.get(t, i)); }
  @RequirePermissions('stock:post') @Post('reservations/:id/release') @HttpCode(200)
  async release(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return strip(await this.reservations.release(t, i)); }
  /** On hand, reserved and available (on hand minus reservations) per warehouse. */
  @RequirePermissions('stock:read') @Get('availability')
  availability(@TenantId() t: string, @Query({ schema: s.availabilityQuery }) q: z.infer<typeof s.availabilityQuery>) { return this.reservations.availability(t, q.companyId, q.itemId, q.warehouseId); }

  // ---- transfers --------------------------------------------------------------------------------------------------
  @RequirePermissions('stock:post') @Idempotent() @Post('transfers') @ApiZodBody(s.createTransferSchema)
  async transfer(@CurrentPrincipal() a: Principal, @Body({ schema: s.createTransferSchema }) b: z.infer<typeof s.createTransferSchema>) { return presentTransfer(await this.transfers.create(a.tenantId, a.userId, b)); }
  @RequirePermissions('stock:read') @Get('transfers')
  async listTransfers(@TenantId() t: string, @Query({ schema: s.listTransfersQuery }) q: z.infer<typeof s.listTransfersQuery>) { const p = await this.transfers.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('stock:read') @Get('transfers/:id')
  async getTransfer(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentTransfer(await this.transfers.get(t, i)); }
  @RequirePermissions('stock:post') @Idempotent() @Post('transfers/:id/receive') @HttpCode(200) @ApiZodBody(s.receiveTransferSchema)
  async receive(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.receiveTransferSchema }) b: z.infer<typeof s.receiveTransferSchema>) { return presentTransfer(await this.transfers.receive(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('stock:post') @Idempotent() @Post('transfers/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelTransferSchema)
  async cancelTransfer(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelTransferSchema }) b: { postingDate: string; reason: string }) { return presentTransfer(await this.transfers.cancel(a.tenantId, a.userId, i, b)); }

  // ---- counts ----------------------------------------------------------------------------------------------------
  @RequirePermissions('stock:post') @Idempotent() @Post('counts') @ApiZodBody(s.createCountSchema)
  async createCount(@CurrentPrincipal() a: Principal, @Body({ schema: s.createCountSchema }) b: z.infer<typeof s.createCountSchema>) { return presentCount(await this.counts.create(a.tenantId, a.userId, b)); }
  @RequirePermissions('stock:read') @Get('counts')
  async listCounts(@TenantId() t: string, @Query({ schema: s.listCountsQuery }) q: z.infer<typeof s.listCountsQuery>) { const p = await this.counts.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('stock:read') @Get('counts/:id')
  async getCount(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentCount(await this.counts.get(t, i)); }
  @RequirePermissions('stock:post') @Post('counts/:id/lines') @ApiZodBody(s.addCountLineSchema)
  async addCountLine(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.addCountLineSchema }) b: { itemId: string; batchId?: string }) { return strip(await this.counts.addLine(t, i, b)); }
  @RequirePermissions('stock:post') @Put('counts/:id/counted') @ApiZodBody(s.recordCountsSchema)
  async recordCounts(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.recordCountsSchema }) b: z.infer<typeof s.recordCountsSchema>) { return presentCount(await this.counts.record(t, i, b.lines)); }
  /** Turns the differences into one adjustment movement (and GL entry) and closes the count. */
  @RequirePermissions('stock:post') @Idempotent() @Post('counts/:id/post') @HttpCode(200) @ApiZodBody(s.postCountSchema)
  async postCount(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.postCountSchema }) b: { postingDate: string }) { return presentCount(await this.counts.post(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('stock:post') @Post('counts/:id/cancel') @HttpCode(200)
  async cancelCount(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentCount(await this.counts.cancel(t, i)); }
}

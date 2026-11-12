import { Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';
import { CatalogService } from './catalog.service.js';
import { ItemsService } from './items.service.js';
import * as s from './masterdata.schemas.js';
import { PartiesService } from './parties.service.js';
import { PricingService } from './pricing.service.js';
import { Recorder } from './helpers.js';

const id = z.uuid();
/** Rows leave the API without their tenant id (it is the caller's own). */
const out = <T extends { tenantId: string }>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _tenant, ...rest } = row;
  return rest;
};
const outPage = <T extends { tenantId: string }>(page: { items: T[]; nextCursor: string | null }) => ({ items: page.items.map(out), nextCursor: page.nextCursor });
const versionOf = (ifMatch: string | undefined): number => {
  if (!ifMatch) throw preconditionRequired('Send the version you read in the If-Match header');
  const version = Number(ifMatch.replaceAll('"', ''));
  if (!Number.isInteger(version) || version < 1) throw preconditionRequired('If-Match must be the integer version you read');
  return version;
};

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('v1')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @RequirePermissions('masterdata:write') @Idempotent() @Post('currencies') @ApiZodBody(s.createCurrencySchema)
  async createCurrency(@TenantId() t: string, @Body({ schema: s.createCurrencySchema }) b: s.CreateCurrencyInput) { return out(await this.catalog.createCurrency(t, b)); }
  @RequirePermissions('masterdata:read') @Get('currencies')
  async listCurrencies(@TenantId() t: string, @Query({ schema: s.pageQuery }) q: z.infer<typeof s.pageQuery>) { return outPage(await this.catalog.listCurrencies(t, q.limit, q.cursor)); }
  @RequirePermissions('masterdata:write') @Patch('currencies/:id') @ApiZodBody(s.updateCurrencySchema)
  async updateCurrency(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updateCurrencySchema }) b: s.UpdateCurrencyInput) { return out(await this.catalog.updateCurrency(t, i, versionOf(m), b)); }

  @RequirePermissions('masterdata:write') @Idempotent() @Post('exchange-rates') @ApiZodBody(s.createExchangeRateSchema)
  async createRate(@TenantId() t: string, @Body({ schema: s.createExchangeRateSchema }) b: s.CreateExchangeRateInput) { return out(await this.catalog.createExchangeRate(t, b)); }
  @RequirePermissions('masterdata:read') @Get('exchange-rates')
  async listRates(@TenantId() t: string, @Query({ schema: s.listExchangeRatesQuery }) q: z.infer<typeof s.listExchangeRatesQuery>) { return outPage(await this.catalog.listExchangeRates(t, q.limit, q.cursor, q.fromCurrency, q.toCurrency)); }
  /** The latest rate on or before `date`. */
  @RequirePermissions('masterdata:read') @Get('exchange-rates/resolve')
  resolveRate(@TenantId() t: string, @Query({ schema: s.resolveRateQuery }) q: z.infer<typeof s.resolveRateQuery>) { return this.catalog.resolveRate(t, q.from, q.to, q.date); }

  @RequirePermissions('masterdata:write') @Idempotent() @Post('units') @ApiZodBody(s.createUnitSchema)
  async createUnit(@TenantId() t: string, @Body({ schema: s.createUnitSchema }) b: s.CreateUnitInput) { return out(await this.catalog.createUnit(t, b)); }
  @RequirePermissions('masterdata:read') @Get('units')
  async listUnits(@TenantId() t: string, @Query({ schema: s.pageQuery }) q: z.infer<typeof s.pageQuery>) { return outPage(await this.catalog.listUnits(t, q.limit, q.cursor)); }
  @RequirePermissions('masterdata:write') @Patch('units/:id') @ApiZodBody(s.updateUnitSchema)
  async updateUnit(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updateUnitSchema }) b: s.UpdateUnitInput) { return out(await this.catalog.updateUnit(t, i, versionOf(m), b)); }

  @RequirePermissions('tax:manage') @Idempotent() @Post('tax-codes') @ApiZodBody(s.createTaxCodeSchema)
  async createTaxCode(@TenantId() t: string, @Body({ schema: s.createTaxCodeSchema }) b: s.CreateTaxCodeInput) { return out(await this.catalog.createTaxCode(t, b)); }
  @RequirePermissions('masterdata:read') @Get('tax-codes')
  async listTaxCodes(@TenantId() t: string, @Query({ schema: s.pageQuery }) q: z.infer<typeof s.pageQuery>) { return outPage(await this.catalog.listTaxCodes(t, q.limit, q.cursor)); }
  @RequirePermissions('masterdata:read') @Get('tax-codes/:id')
  async getTaxCode(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.catalog.getTaxCode(t, i)); }
  @RequirePermissions('tax:manage') @Patch('tax-codes/:id') @ApiZodBody(s.updateTaxCodeSchema)
  async updateTaxCode(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updateTaxCodeSchema }) b: s.UpdateTaxCodeInput) { return out(await this.catalog.updateTaxCode(t, i, versionOf(m), b)); }
  /** Adds a rate version from a date; an open-ended earlier version is closed the day before. */
  @RequirePermissions('tax:manage') @Idempotent() @Post('tax-codes/:id/rates') @ApiZodBody(s.createTaxRateSchema)
  async addRate(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.createTaxRateSchema }) b: s.CreateTaxRateInput) { return out(await this.catalog.addTaxRate(t, i, b)); }
  @RequirePermissions('masterdata:read') @Get('tax-codes/:id/rates')
  async listRatesOf(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return { items: (await this.catalog.listTaxRates(t, i)).map(out) }; }
  /** The rate version in force on `date` (404 if none). */
  @RequirePermissions('masterdata:read') @Get('tax-codes/:id/rate')
  async rateOn(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.dateQuery }) q: z.infer<typeof s.dateQuery>) { return out(await this.catalog.resolveTaxRate(t, i, q.date)); }
}

@ApiTags('items')
@ApiBearerAuth()
@Controller('v1/items')
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}

  @RequirePermissions('masterdata:write') @Idempotent() @Post() @ApiZodBody(s.createItemSchema)
  async create(@TenantId() t: string, @Body({ schema: s.createItemSchema }) b: s.CreateItemInput) { return out(await this.items.create(t, b)); }
  @RequirePermissions('masterdata:read') @Get()
  async list(@TenantId() t: string, @Query({ schema: s.listItemsQuery }) q: s.ListItemsQuery) { return outPage(await this.items.list(t, q)); }
  @RequirePermissions('masterdata:read') @Get(':id')
  async get(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.items.get(t, i)); }
  @RequirePermissions('masterdata:write') @Patch(':id') @ApiZodBody(s.updateItemSchema)
  async update(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updateItemSchema }) b: s.UpdateItemInput) { return out(await this.items.update(t, i, versionOf(m), b)); }
  @RequirePermissions('masterdata:write') @Idempotent() @Post(':id/uom-conversions') @ApiZodBody(s.createConversionSchema)
  async addConversion(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.createConversionSchema }) b: { uomId: string; factor: string }) { return out(await this.items.addConversion(t, i, b)); }
  @RequirePermissions('masterdata:read') @Get(':id/uom-conversions')
  async conversions(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return { items: (await this.items.listConversions(t, i)).map(out) }; }
}

@ApiTags('parties')
@ApiBearerAuth()
@Controller('v1')
export class PartiesController {
  constructor(@Inject(PartiesService) private readonly parties: PartiesService) {}

  @RequirePermissions('masterdata:write') @Idempotent() @Post('payment-terms') @ApiZodBody(s.createPaymentTermSchema)
  async createTerm(@TenantId() t: string, @Body({ schema: s.createPaymentTermSchema }) b: s.CreatePaymentTermInput) { return out(await this.parties.createPaymentTerm(t, b)); }
  @RequirePermissions('masterdata:read') @Get('payment-terms')
  async listTerms(@TenantId() t: string, @Query({ schema: s.pageQuery }) q: z.infer<typeof s.pageQuery>) { return outPage(await this.parties.listPaymentTerms(t, q.limit, q.cursor)); }

  @RequirePermissions('masterdata:write') @Idempotent() @Post('parties') @ApiZodBody(s.createPartySchema)
  async create(@TenantId() t: string, @Body({ schema: s.createPartySchema }) b: s.CreatePartyInput) { return out(await this.parties.create(t, b)); }
  @RequirePermissions('masterdata:read') @Get('parties')
  async list(@TenantId() t: string, @Query({ schema: s.listPartiesQuery }) q: s.ListPartiesQuery) { return outPage(await this.parties.list(t, q)); }
  @RequirePermissions('masterdata:read') @Get('parties/:id')
  async get(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.parties.get(t, i)); }
  @RequirePermissions('masterdata:write') @Patch('parties/:id') @ApiZodBody(s.updatePartySchema)
  async update(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updatePartySchema }) b: s.UpdatePartyInput) { return out(await this.parties.update(t, i, versionOf(m), b)); }
  @RequirePermissions('masterdata:write') @Idempotent() @Post('parties/:id/addresses') @ApiZodBody(s.createAddressSchema)
  async addAddress(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.createAddressSchema }) b: s.CreateAddressInput) { return out(await this.parties.addAddress(t, i, b)); }
  @RequirePermissions('masterdata:read') @Get('parties/:id/addresses')
  async addresses(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return { items: (await this.parties.listAddresses(t, i)).map(out) }; }
}

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('v1/price-lists')
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @RequirePermissions('pricing:manage') @Idempotent() @Post() @ApiZodBody(s.createPriceListSchema)
  async create(@TenantId() t: string, @Body({ schema: s.createPriceListSchema }) b: s.CreatePriceListInput) { return out(await this.pricing.createList(t, b)); }
  @RequirePermissions('masterdata:read') @Get()
  async list(@TenantId() t: string, @Query({ schema: s.pageQuery }) q: z.infer<typeof s.pageQuery>) { return outPage(await this.pricing.listLists(t, q.limit, q.cursor)); }
  @RequirePermissions('masterdata:read') @Get(':id')
  async get(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return out(await this.pricing.getList(t, i)); }
  @RequirePermissions('pricing:manage') @Patch(':id') @ApiZodBody(s.updatePriceListSchema)
  async update(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: s.updatePriceListSchema }) b: s.UpdatePriceListInput) { return out(await this.pricing.updateList(t, i, versionOf(m), b)); }
  @RequirePermissions('pricing:manage') @Idempotent() @Post(':id/prices') @ApiZodBody(s.createPriceSchema)
  async addPrice(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.createPriceSchema }) b: s.CreatePriceInput) { return out(await this.pricing.addPrice(t, i, b)); }
  @RequirePermissions('masterdata:read') @Get(':id/prices')
  async prices(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.listPricesQuery }) q: z.infer<typeof s.listPricesQuery>) { return outPage(await this.pricing.listPrices(t, i, q.limit, q.cursor, q.itemId)); }
  /** Ends a price on a date (history is never edited; add a new price to change it). */
  @RequirePermissions('pricing:manage') @Post(':id/prices/:priceId/close') @HttpCode(200) @ApiZodBody(s.closePriceSchema)
  async close(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Param('priceId', { schema: id }) p: string, @Body({ schema: s.closePriceSchema }) b: { effectiveTo: string }) { return out(await this.pricing.closePrice(t, i, p, b.effectiveTo)); }
  /** The price in force for an item/unit at a quantity on a date. */
  @RequirePermissions('masterdata:read') @Get(':id/price')
  async price(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.resolvePriceQuery }) q: z.infer<typeof s.resolvePriceQuery>) { return out(await this.pricing.resolve(t, { priceListId: i, ...q })); }
}

@Module({
  controllers: [CatalogController, ItemsController, PartiesController, PricingController],
  providers: [Recorder, CatalogService, ItemsService, PartiesService, PricingService],
  exports: [CatalogService, ItemsService, PartiesService, PricingService],
})
export class MasterDataModule {}

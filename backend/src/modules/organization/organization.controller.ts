import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody, pageQuerySchema, type PageQuery } from '../../platform/http/validation.js';
import { DevHeaderTenantGuard, PlatformAdminGuard, TenantId } from '../../platform/tenancy/tenant.js';
import {
  presentBusinessLocation,
  presentCompany,
  presentGstRegistration,
  presentPage,
  presentTenant,
  presentWarehouse,
} from './organization.presenters.js';
import {
  createBusinessLocationSchema,
  createCompanySchema,
  createGstRegistrationSchema,
  createTenantSchema,
  createWarehouseSchema,
  listLocationsQuerySchema,
  listWarehousesQuerySchema,
  updateCompanySchema,
  type CreateBusinessLocationInput,
  type CreateCompanyInput,
  type CreateGstRegistrationInput,
  type CreateTenantInput,
  type CreateWarehouseInput,
  type ListLocationsQuery,
  type ListWarehousesQuery,
  type UpdateCompanyInput,
} from './organization.schemas.js';
import { OrganizationService } from './organization.service.js';

const id = z.uuid();

/** Platform operator endpoint: provisions a tenant. Protected by PLATFORM_ADMIN_TOKEN until the identity slice. */
@ApiTags('platform')
@Controller('v1/platform/tenants')
@UseGuards(PlatformAdminGuard)
export class PlatformTenantsController {
  constructor(@Inject(OrganizationService) private readonly organization: OrganizationService) {}

  @Post()
  @ApiZodBody(createTenantSchema)
  async create(@Body({ schema: createTenantSchema }) body: CreateTenantInput) {
    return presentTenant(await this.organization.createTenant(body));
  }
}

@ApiTags('organization')
@ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Slice 0 only: the tenant to act for (replaced by authentication)' })
@Controller('v1')
@UseGuards(DevHeaderTenantGuard)
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly organization: OrganizationService) {}

  @Get('tenant')
  async tenant(@TenantId() tenantId: string) {
    return presentTenant(await this.organization.getTenant(tenantId));
  }

  @Post('companies')
  @ApiZodBody(createCompanySchema)
  async createCompany(@TenantId() tenantId: string, @Body({ schema: createCompanySchema }) body: CreateCompanyInput) {
    return presentCompany(await this.organization.createCompany(tenantId, body));
  }

  @Get('companies')
  async listCompanies(@TenantId() tenantId: string, @Query({ schema: pageQuerySchema }) query: PageQuery) {
    return presentPage(await this.organization.listCompanies(tenantId, query.limit, query.cursor), presentCompany);
  }

  @Get('companies/:id')
  async getCompany(@TenantId() tenantId: string, @Param('id', { schema: id }) companyId: string) {
    return presentCompany(await this.organization.getCompany(tenantId, companyId));
  }

  /** Requires `If-Match: <version>` (the `version` you read). A stale version answers 412. */
  @Patch('companies/:id')
  @ApiZodBody(updateCompanySchema)
  async updateCompany(
    @TenantId() tenantId: string,
    @Param('id', { schema: id }) companyId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body({ schema: updateCompanySchema }) body: UpdateCompanyInput,
  ) {
    const version = Number((ifMatch ?? '').replaceAll('"', ''));
    if (!ifMatch) throw preconditionRequired('Send the version you read in the If-Match header');
    if (!Number.isInteger(version) || version < 1) throw preconditionRequired('If-Match must be the integer version you read');
    return presentCompany(await this.organization.updateCompany(tenantId, companyId, version, body));
  }

  @Post('companies/:id/gst-registrations')
  @ApiZodBody(createGstRegistrationSchema)
  async createGstRegistration(
    @TenantId() tenantId: string,
    @Param('id', { schema: id }) companyId: string,
    @Body({ schema: createGstRegistrationSchema }) body: CreateGstRegistrationInput,
  ) {
    return presentGstRegistration(await this.organization.createGstRegistration(tenantId, companyId, body));
  }

  @Get('companies/:id/gst-registrations')
  async listGstRegistrations(@TenantId() tenantId: string, @Param('id', { schema: id }) companyId: string, @Query({ schema: pageQuerySchema }) query: PageQuery) {
    return presentPage(await this.organization.listGstRegistrations(tenantId, companyId, query.limit, query.cursor), presentGstRegistration);
  }

  @Post('business-locations')
  @ApiZodBody(createBusinessLocationSchema)
  async createBusinessLocation(@TenantId() tenantId: string, @Body({ schema: createBusinessLocationSchema }) body: CreateBusinessLocationInput) {
    return presentBusinessLocation(await this.organization.createBusinessLocation(tenantId, body));
  }

  @Get('business-locations')
  async listBusinessLocations(@TenantId() tenantId: string, @Query({ schema: listLocationsQuerySchema }) query: ListLocationsQuery) {
    return presentPage(await this.organization.listBusinessLocations(tenantId, query), presentBusinessLocation);
  }

  @Post('warehouses')
  @HttpCode(201)
  @ApiZodBody(createWarehouseSchema)
  async createWarehouse(@TenantId() tenantId: string, @Body({ schema: createWarehouseSchema }) body: CreateWarehouseInput) {
    return presentWarehouse(await this.organization.createWarehouse(tenantId, body));
  }

  @Get('warehouses')
  async listWarehouses(@TenantId() tenantId: string, @Query({ schema: listWarehousesQuerySchema }) query: ListWarehousesQuery) {
    return presentPage(await this.organization.listWarehouses(tenantId, query), presentWarehouse);
  }
}

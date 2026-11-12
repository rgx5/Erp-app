import { Module } from '@nestjs/common';
import { DevHeaderTenantGuard, PlatformAdminGuard } from '../../platform/tenancy/tenant.js';
import { OrganizationController, PlatformTenantsController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

@Module({
  controllers: [PlatformTenantsController, OrganizationController],
  providers: [OrganizationService, DevHeaderTenantGuard, PlatformAdminGuard],
  exports: [OrganizationService],
})
export class OrganizationModule {}

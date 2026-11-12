import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PlatformAdminGuard } from '../../platform/tenancy/platform-admin.guard.js';
import { AccessService } from './access.service.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { cryptoProviders } from './crypto.providers.js';
import { ApiKeysController, AuthController, PlatformTenantsController, RolesController, UsersController } from './identity.controller.js';
import { PrincipalService } from './principal.service.js';

@Module({
  controllers: [PlatformTenantsController, AuthController, UsersController, RolesController, ApiKeysController],
  providers: [...cryptoProviders, PrincipalService, AuthService, AccessService, PlatformAdminGuard, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [PrincipalService],
})
export class IdentityModule {}

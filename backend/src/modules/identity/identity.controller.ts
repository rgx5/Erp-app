import { Body, Controller, Get, Headers, HttpCode, Inject, Ip, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { notFound, preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody, pageQuerySchema, type PageQuery } from '../../platform/http/validation.js';
import { presentPage } from '../organization/organization.presenters.js';
import { AccessService } from './access.service.js';
import { AuthService } from './auth.service.js';
import {
  changePasswordSchema,
  createApiKeySchema,
  createRoleSchema,
  createUserSchema,
  loginSchema,
  mfaActivateSchema,
  mfaDisableSchema,
  provisionTenantSchema,
  refreshSchema,
  setUserRolesSchema,
  updateRoleSchema,
  updateUserSchema,
  type CreateApiKeyInput,
  type CreateRoleInput,
  type CreateUserInput,
  type LoginInput,
  type ProvisionTenantInput,
  type UpdateRoleInput,
  type UpdateUserInput,
} from './identity.schemas.js';
import { presentApiKey, presentRole, presentSession, presentUser } from './identity.presenters.js';
import { Authenticated, CurrentPrincipal, Public, type Principal, RequirePermissions, TenantId } from './principal.js';
import { PlatformAdminGuard } from '../../platform/tenancy/platform-admin.guard.js';
import { UseGuards } from '@nestjs/common';

const id = z.uuid();
const clientOf = (request: { headers: Record<string, string | string[] | undefined> }, ip: string) => ({
  ip,
  userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
});
const versionOf = (ifMatch: string | undefined): number => {
  if (!ifMatch) throw preconditionRequired('Send the version you read in the If-Match header');
  const version = Number(ifMatch.replaceAll('"', ''));
  if (!Number.isInteger(version) || version < 1) throw preconditionRequired('If-Match must be the integer version you read');
  return version;
};

/** Platform operator endpoint (static platform token): provisions a tenant together with its first owner. */
@ApiTags('platform')
@Controller('v1/platform/tenants')
@Public()
@UseGuards(PlatformAdminGuard)
export class PlatformTenantsController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @Post()
  @ApiZodBody(provisionTenantSchema)
  async create(@Body({ schema: provisionTenantSchema }) body: ProvisionTenantInput) {
    const { tenant, user } = await this.access.provisionTenant(body);
    return { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, owner: presentUser(user) };
  }
}

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Anyone can create a tenant here, so it is off (404) unless SELF_SIGNUP_ENABLED=true. */
  @Public()
  @Post('signup')
  @ApiZodBody(provisionTenantSchema)
  async signup(@Body({ schema: provisionTenantSchema }) body: ProvisionTenantInput) {
    if (!this.env.SELF_SIGNUP_ENABLED) throw notFound('This endpoint');
    const { tenant, user } = await this.access.provisionTenant(body);
    return { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, owner: presentUser(user) };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@Body({ schema: loginSchema }) body: LoginInput, @Req() request: { headers: Record<string, string | string[] | undefined> }, @Ip() ip: string) {
    const { user, tokens } = await this.auth.login(body, clientOf(request, ip));
    return presentSession(user, tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiZodBody(refreshSchema)
  async refresh(@Body({ schema: refreshSchema }) body: { refreshToken: string }, @Req() request: { headers: Record<string, string | string[] | undefined> }, @Ip() ip: string) {
    const { user, tokens } = await this.auth.refresh(body.refreshToken, clientOf(request, ip));
    return presentSession(user, tokens);
  }

  @ApiBearerAuth()
  @Authenticated()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.auth.logout(principal);
  }

  @ApiBearerAuth()
  @Authenticated()
  @Get('me')
  async me(@CurrentPrincipal() principal: Principal) {
    const permissions = [...principal.permissions].sort();
    if (principal.kind === 'api_key') return { kind: principal.kind, apiKeyId: principal.apiKeyId, permissions };
    return { kind: principal.kind, user: presentUser(await this.auth.me(principal)), permissions };
  }

  @ApiBearerAuth()
  @Authenticated()
  @Post('password')
  @HttpCode(204)
  @ApiZodBody(changePasswordSchema)
  async changePassword(@CurrentPrincipal() principal: Principal, @Body({ schema: changePasswordSchema }) body: { currentPassword: string; newPassword: string }): Promise<void> {
    await this.auth.changePassword(principal, body.currentPassword, body.newPassword);
  }

  @ApiBearerAuth()
  @Authenticated()
  @Post('mfa/enroll')
  mfaEnroll(@CurrentPrincipal() principal: Principal) {
    return this.auth.mfaEnroll(principal);
  }

  @ApiBearerAuth()
  @Authenticated()
  @Post('mfa/activate')
  @HttpCode(200)
  @ApiZodBody(mfaActivateSchema)
  async mfaActivate(@CurrentPrincipal() principal: Principal, @Body({ schema: mfaActivateSchema }) body: { code: string }) {
    return { recoveryCodes: await this.auth.mfaActivate(principal, body.code) };
  }

  @ApiBearerAuth()
  @Authenticated()
  @Post('mfa/disable')
  @HttpCode(204)
  @ApiZodBody(mfaDisableSchema)
  async mfaDisable(@CurrentPrincipal() principal: Principal, @Body({ schema: mfaDisableSchema }) body: { password: string; code: string }): Promise<void> {
    await this.auth.mfaDisable(principal, body.password, body.code);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('v1/users')
export class UsersController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @RequirePermissions('users:write')
  @Post()
  @ApiZodBody(createUserSchema)
  async create(@CurrentPrincipal() actor: Principal, @Body({ schema: createUserSchema }) body: CreateUserInput) {
    return presentUser(await this.access.createUser(actor, body));
  }

  @RequirePermissions('users:read')
  @Get()
  async list(@TenantId() tenantId: string, @Query({ schema: pageQuerySchema }) query: PageQuery) {
    return presentPage(await this.access.listUsers(tenantId, query.limit, query.cursor), presentUser);
  }

  @RequirePermissions('users:read')
  @Get(':id')
  async get(@TenantId() tenantId: string, @Param('id', { schema: id }) userId: string) {
    return presentUser(await this.access.getUser(tenantId, userId));
  }

  @RequirePermissions('users:write')
  @Patch(':id')
  @ApiZodBody(updateUserSchema)
  async update(
    @CurrentPrincipal() actor: Principal,
    @Param('id', { schema: id }) userId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body({ schema: updateUserSchema }) body: UpdateUserInput,
  ) {
    return presentUser(await this.access.updateUser(actor, userId, versionOf(ifMatch), body));
  }

  @RequirePermissions('users:write')
  @Put(':id/roles')
  @ApiZodBody(setUserRolesSchema)
  async setRoles(@CurrentPrincipal() actor: Principal, @Param('id', { schema: id }) userId: string, @Body({ schema: setUserRolesSchema }) body: { roleIds: string[] }) {
    return presentUser(await this.access.setUserRoles(actor, userId, body.roleIds));
  }
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller('v1/roles')
export class RolesController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @RequirePermissions('roles:write')
  @Post()
  @ApiZodBody(createRoleSchema)
  async create(@CurrentPrincipal() actor: Principal, @Body({ schema: createRoleSchema }) body: CreateRoleInput) {
    return presentRole(await this.access.createRole(actor, body));
  }

  @RequirePermissions('roles:read')
  @Get()
  async list(@TenantId() tenantId: string, @Query({ schema: pageQuerySchema }) query: PageQuery) {
    return presentPage(await this.access.listRoles(tenantId, query.limit, query.cursor), presentRole);
  }

  @RequirePermissions('roles:read')
  @Get(':id')
  async get(@TenantId() tenantId: string, @Param('id', { schema: id }) roleId: string) {
    return presentRole(await this.access.getRole(tenantId, roleId));
  }

  @RequirePermissions('roles:write')
  @Patch(':id')
  @ApiZodBody(updateRoleSchema)
  async update(
    @CurrentPrincipal() actor: Principal,
    @Param('id', { schema: id }) roleId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body({ schema: updateRoleSchema }) body: UpdateRoleInput,
  ) {
    return presentRole(await this.access.updateRole(actor, roleId, versionOf(ifMatch), body));
  }
}

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  /** The only response that ever contains the key itself. */
  @RequirePermissions('api_keys:manage')
  @Post()
  @ApiZodBody(createApiKeySchema)
  async create(@CurrentPrincipal() actor: Principal, @Body({ schema: createApiKeySchema }) body: CreateApiKeyInput) {
    const { key, record } = await this.access.createApiKey(actor, body);
    return { ...presentApiKey(record), key };
  }

  @RequirePermissions('api_keys:manage')
  @Get()
  async list(@TenantId() tenantId: string, @Query({ schema: pageQuerySchema }) query: PageQuery) {
    return presentPage(await this.access.listApiKeys(tenantId, query.limit, query.cursor), presentApiKey);
  }

  @RequirePermissions('api_keys:manage')
  @Post(':id/revoke')
  @HttpCode(200)
  async revoke(@TenantId() tenantId: string, @Param('id', { schema: id }) keyId: string) {
    return presentApiKey(await this.access.revokeApiKey(tenantId, keyId));
  }
}

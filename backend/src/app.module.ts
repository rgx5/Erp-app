import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ENV, type Env } from './config/env.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { HealthModule } from './platform/health/health.module.js';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter.js';
import { RequestInterceptor } from './platform/http/request.interceptor.js';
import { createLogger, LOGGER } from './platform/logging/logger.js';

@Global()
@Module({})
export class CoreModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: createLogger(env) },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_INTERCEPTOR, useClass: RequestInterceptor },
      ],
      exports: [ENV, LOGGER],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return { module: AppModule, imports: [CoreModule.forRoot(env), DatabaseModule, HealthModule, IdentityModule, OrganizationModule] };
  }
}

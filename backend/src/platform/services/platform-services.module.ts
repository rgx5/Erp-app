import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service.js';
import { IdempotencyInterceptor } from './idempotency.js';
import { OutboxRelay, OutboxRegistry } from './outbox.relay.js';
import { OutboxService } from './outbox.service.js';

/** Audit log, transactional outbox and idempotency: infrastructure every domain module can use. */
@Global()
@Module({
  providers: [AuditService, OutboxService, OutboxRegistry, OutboxRelay, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
  exports: [AuditService, OutboxService, OutboxRegistry, OutboxRelay],
})
export class PlatformServicesModule {}

import { CallHandler, ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Logger } from 'pino';
import { tap } from 'rxjs';
import { ENV, type Env } from '../../config/env.js';
import { LOGGER } from '../logging/logger.js';
import { applySecurityHeaders, ensureRequestId } from './http-support.js';

/** Request id, security headers and one structured access-log line per request. */
@Injectable()
export class RequestInterceptor implements NestInterceptor {
  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const adapter = this.host.httpAdapter;
    const http = context.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, string>; method: string; requestId?: string; tenantId?: string }>();
    const response = http.getResponse<{ statusCode: number }>();
    const requestId = ensureRequestId(request, response, adapter);
    applySecurityHeaders(adapter, response, this.env);
    const started = process.hrtime.bigint();
    return next.handle().pipe(
      tap(() => {
        this.logger.info(
          {
            requestId,
            tenantId: request.tenantId,
            method: request.method,
            path: adapter.getRequestUrl(request)?.split('?')[0],
            status: response.statusCode,
            durationMs: Number(process.hrtime.bigint() - started) / 1e6,
          },
          'request completed',
        );
      }),
    );
  }
}

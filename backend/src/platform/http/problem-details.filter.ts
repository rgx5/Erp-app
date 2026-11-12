import { ArgumentsHost, Catch, type ExceptionFilter, Inject } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Logger } from 'pino';
import { ENV, type Env } from '../../config/env.js';
import { LOGGER } from '../logging/logger.js';
import { applySecurityHeaders, ensureRequestId } from './http-support.js';
import { toProblem } from './problem.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  catch(exception: unknown, argumentsHost: ArgumentsHost): void {
    const adapter = this.host.httpAdapter;
    const http = argumentsHost.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, string>; requestId?: string; tenantId?: string }>();
    const response = http.getResponse<unknown>();
    const requestId = ensureRequestId(request, response, adapter);
    const { problem, log } = toProblem(exception);

    if (log !== 'none') {
      this.logger[log]({ err: exception, requestId, tenantId: request.tenantId, status: problem.status, code: problem.code }, 'request failed');
    }
    applySecurityHeaders(adapter, response, this.env);
    adapter.setHeader(response, 'Content-Type', 'application/problem+json; charset=utf-8');
    adapter.reply(response, { ...problem, instance: adapter.getRequestUrl(request)?.split('?')[0], requestId }, problem.status);
  }
}

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { NodeAdapter } from '@nestjs/platform-node';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { addPathParameters } from './platform/http/openapi.js';
import { createValidationPipe } from './platform/http/validation.js';
import { createLogger, PinoLoggerService } from './platform/logging/logger.js';

/**
 * Builds the application on the configured HTTP adapter. Everything adapter-specific lives here; nothing in
 * controllers, guards, filters or interceptors depends on which adapter is in use.
 */
export async function createApplication(env: Env): Promise<INestApplication> {
  const logger = new PinoLoggerService(createLogger(env));
  const options = { logger, bodyParser: true };
  const app: INestApplication =
    env.HTTP_ADAPTER === 'node'
      ? await NestFactory.create(AppModule.forRoot(env), new NodeAdapter(), options)
      : await NestFactory.create<NestFastifyApplication>(
          AppModule.forRoot(env),
          new FastifyAdapter({ bodyLimit: env.REQUEST_BODY_LIMIT_BYTES, trustProxy: false }),
          options,
        );

  if (env.CORS_ALLOWED_ORIGINS.length > 0) {
    app.enableCors({
      origin: env.CORS_ALLOWED_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'If-Match', 'Approval-Id', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'ETag', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
      maxAge: 600,
    });
  }
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('OneSyncERP API')
      .setDescription('Platform foundation, identity and the tenancy hierarchy.')
      .setVersion('0.2.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, addPathParameters(SwaggerModule.createDocument(app, config)), { jsonDocumentUrl: 'openapi.json' });
  }
  return app;
}

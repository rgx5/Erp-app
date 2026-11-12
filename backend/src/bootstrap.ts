import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { NodeAdapter } from '@nestjs/platform-node';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
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

  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('OneSyncERP API')
      .setDescription('Slice 0: platform foundation and the tenancy hierarchy.')
      .setVersion('0.1.0')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), { jsonDocumentUrl: 'openapi.json' });
  }
  return app;
}

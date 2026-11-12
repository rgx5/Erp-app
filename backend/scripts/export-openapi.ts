/** Writes docs/openapi.json from the running application's own OpenAPI document. Needs DATABASE_URL (the runtime role). */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createApplication } from '../src/bootstrap.js';
import { loadEnv } from '../src/config/env.js';

const app = await createApplication(loadEnv({ ...process.env, LOG_LEVEL: 'silent', SWAGGER_ENABLED: 'false' }));
await app.init();
const config = new DocumentBuilder().setTitle('OneSyncERP API').setDescription('Slice 0: platform foundation and the tenancy hierarchy.').setVersion('0.1.0').build();
const document = SwaggerModule.createDocument(app, config);
await writeFile(path.resolve(import.meta.dirname, '../docs/openapi.json'), JSON.stringify(document, null, 2) + '\n');
await app.close();
console.log('wrote docs/openapi.json');

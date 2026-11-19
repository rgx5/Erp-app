import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const applied = await migrate(pool);
if (applied.length) console.log(`applied ${applied.join(', ')}`);
const app = buildApp({ pool, config });
await app.listen({ port: config.PORT, host: config.HOST });

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { ensureFirstAdmin } from './first-admin.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const applied = await migrate(pool);
if (applied.length) console.log(`applied ${applied.join(', ')}`);
const first = await ensureFirstAdmin(pool, config);
if (first) console.log(`created the first admin ${first} (remove BOOTSTRAP_ADMIN_* from the settings now)`);
const app = buildApp({ pool, config });
await app.listen({ port: config.PORT, host: config.HOST });

import { loadEnv } from './config/env.js';
import { createApplication } from './bootstrap.js';

const env = loadEnv();
const app = await createApplication(env);
await app.listen(env.PORT, env.HOST);

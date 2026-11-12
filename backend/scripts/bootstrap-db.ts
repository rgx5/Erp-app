import { bootstrapDatabase } from '../src/db/bootstrap.js';

const admin = process.env['ADMIN_DATABASE_URL'];
const migrator = process.env['MIGRATOR_PASSWORD'];
const app = process.env['APP_PASSWORD'];
if (!admin || !migrator || !app) {
  console.error('ADMIN_DATABASE_URL, MIGRATOR_PASSWORD and APP_PASSWORD are required');
  process.exit(2);
}
await bootstrapDatabase(admin, { migrator, app });
console.log('roles and schema ready');

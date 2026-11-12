import { migrateUp, migrationStatus } from './migrator.js';

const url = process.env['MIGRATOR_DATABASE_URL'];
if (!url) {
  console.error('MIGRATOR_DATABASE_URL is required (the schema-owner role, not the runtime role)');
  process.exit(2);
}
const command = process.argv[2] ?? 'up';
if (command === 'up') {
  const result = await migrateUp(url);
  console.log(result.applied.length ? `applied: ${result.applied.join(', ')}` : 'already up to date');
} else if (command === 'status') {
  const status = await migrationStatus(url);
  console.log(JSON.stringify(status, null, 2));
  process.exit(status.pending.length ? 1 : 0);
} else {
  console.error('usage: migrate.ts [up|status]');
  process.exit(2);
}

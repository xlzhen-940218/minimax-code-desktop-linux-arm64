import { DatabaseClient } from '../dist/infra/db/client.js';
import { initializeDatabase } from '../dist/infra/db/initialize.js';
import { runMigrations } from '../dist/infra/db/migrate.js';
import { ALL_MIGRATIONS } from '../dist/infra/db/migrations.js';
import { assertDatabaseSchemaConsistent } from '../dist/infra/db/schema-consistency.js';
import {
  RehearsalInvariantError,
  resolveRehearsalSourceDataDir,
  runSessionStorageRealDataRehearsal,
} from './session-storage-real-data-rehearsal.mjs';

try {
  const sourceDataDir = resolveRehearsalSourceDataDir(process.env);
  const report = await runSessionStorageRealDataRehearsal({
    sourceDataDir,
    production: {
      DatabaseClient,
      initializeDatabase,
      runMigrations,
      migrations: ALL_MIGRATIONS,
      assertSchemaConsistent: assertDatabaseSchemaConsistent,
    },
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const redacted =
    error instanceof RehearsalInvariantError
      ? error.toJSON()
      : {
          name: error instanceof Error ? error.name : 'Error',
          code: 'UNEXPECTED_REHEARSAL_FAILURE',
        };
  process.stderr.write(`${JSON.stringify({ success: false, error: redacted })}\n`);
  process.exitCode = 1;
}

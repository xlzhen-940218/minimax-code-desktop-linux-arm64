import { DatabaseClient } from '../dist/infra/db/client.js';
import { initializeDatabase } from '../dist/infra/db/initialize.js';
import * as repositories from '../dist/service/session-system/index.js';
import {
  RehearsalInvariantError,
  resolveSessionSystemRehearsalSourceDataDir,
  runSessionSystemRepositoryRealDataRehearsal,
} from './session-system-repository-real-data-rehearsal.mjs';

try {
  const sourceDataDir = resolveSessionSystemRehearsalSourceDataDir(process.env);
  const report = await runSessionSystemRepositoryRealDataRehearsal({
    sourceDataDir,
    production: { DatabaseClient, initializeDatabase, repositories },
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

/**
 * Render the actual pi-history rows the compensation produces for the
 * user's most-impacted legacy session (`mvs_30ea7763e6ac407b972b42982358b90e`,
 * 237 native tool parts that v1 converter silently dropped). Read the
 * data from a snapshot of the live DB after running the compensator, so
 * the user can see the resulting toolCall / toolResult pairing end-to-end.
 */
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { LegacyOpencodeMigrator } from '../../src/infra/legacy-db/legacy-opencode-migrator.js';
import { LegacyOpencodeStore } from '../../src/infra/legacy-db/legacy-opencode-store.js';
import { SqliteLegacyMigrationStore } from '../../src/infra/legacy-db/legacy-migration-store.js';
import {
  SqliteLocalSessionStore,
  SqliteLocalMessageStore,
} from '../../src/infra/legacy-db/sqlite-persistence.js';
import { LocalSessionController } from '../../src/service/session-system/conversation/controller.js';
import { LiveSessionWriter } from '../../src/infra/file/session-writer.js';

const TARGET_SESSION = 'mvs_30ea7763e6ac407b972b42982358b90e';

async function main(): Promise<void> {
  const snapshotDir = process.env.SNAPSHOT_DIR;
  if (!snapshotDir) throw new Error('SNAPSHOT_DIR env var required');

  const migrator = new LegacyOpencodeMigrator({
    legacyStore: new LegacyOpencodeStore({ dataDir: snapshotDir }),
    migrationStore: new SqliteLegacyMigrationStore(snapshotDir),
    controller: new LocalSessionController({
      store: new SqliteLocalSessionStore(snapshotDir),
    }),
    messageStore: new SqliteLocalMessageStore(snapshotDir),
    sessionWriter: new LiveSessionWriter({ messageStore: new SqliteLocalMessageStore(snapshotDir) }),
    primaryAgentName: 'mavis',
    defaultWorkspaceDir: () => '/workspace',
    dataDir: () => snapshotDir,
  });
  await migrator.ensurePiHistoryMigrated(TARGET_SESSION);

  const db = new Database(path.join(snapshotDir, 'v2/sqlite/runtime-state.sqlite'));
  try {
    const record = db
      .prepare(
        `SELECT pi_history_converter_version AS ver, pi_history_strategy AS strategy FROM local_runtime_legacy_migrations WHERE legacy_session_id = ?`,
      )
      .get(TARGET_SESSION);
    console.log(`[verify] record:`, record);

    // Render the first 12 rows in chronological order so the user can
    // eyeball toolCall ↔ toolResult pairing without scrolling.
    const rows = db
      .prepare(
        `SELECT id, role, data_json FROM local_runtime_pi_history_rows WHERE session_id = ? ORDER BY id LIMIT 12`,
      )
      .all(TARGET_SESSION);
    console.log(`[verify] first ${rows.length} pi-history rows for ${TARGET_SESSION}:`);
    for (const row of rows as Array<{ id: number; role: string; data_json: string }>) {
      const parsed = JSON.parse(row.data_json);
      const summary =
        parsed.role === 'assistant'
          ? (parsed.content as Array<{ type: string }>)
              .map((b) => {
                if (b.type === 'text') return 'text';
                if (b.type === 'thinking') return `thinking(${((b as any).thinking as string ?? '').slice(0, 40)}…)`;
                if (b.type === 'toolCall')
                  return `toolCall(${(b as any).id}/${(b as any).name})`;
                return b.type;
              })
              .join(' | ')
          : parsed.role === 'toolResult'
            ? `toolResult toolCallId=${(parsed as any).toolCallId} isError=${(parsed as any).isError}`
            : `user text=${((parsed.content as any[])[0]?.text ?? '').slice(0, 40)}…`;
      console.log(`  [id=${row.id}] role=${row.role} → ${summary}`);
    }
  } finally {
    db.close();
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
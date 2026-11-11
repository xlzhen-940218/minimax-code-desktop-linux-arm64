/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Compensating re-migration verification — runs the v2 migrator end to
 * end against a snapshot of the user's live v2 database, then compares
 * the pre/post pi-history row counts. Tests the exact stale-record
 * compensation path that fires when `ensurePiHistoryMigrated` is called
 * on a `native-*` record with no converter version stamp.
 *
 * This is a one-shot CLI; it does not write back to the user's real
 * `~/.mavis/v2/...` — it points LegacyOpencodeStore + SqliteLegacyMigrationStore
 * at the snapshot via a `DataDirInput` and trashes the snapshot on exit.
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

interface StaleSnapshotRow {
  legacy_session_id: string;
  strategy: string;
  source_count: number;
  pi_before: { assistant: number; user: number; toolCall: number; toolResult: number };
}

interface VerificationResult {
  legacy_session_id: string;
  strategy_before: string;
  source_count: number;
  version_before: number | null;
  version_after: number | null;
  pi_before: { assistant: number; user: number; toolCall: number; toolResult: number };
  pi_after: { assistant: number; user: number; toolCall: number; toolResult: number };
  tool_call_parity: { source: number; converted: number };
  dropped_to_zero: boolean;
  preserved_user_messages: number;
  dropped_v1_rows: number;
}

async function main(): Promise<void> {
  const snapshotDir = process.env.SNAPSHOT_DIR;
  if (!snapshotDir) {
    console.error('SNAPSHOT_DIR env var required (must point to a copy of the user dataDir).');
    process.exit(1);
  }

  const dbPath = path.join(snapshotDir, 'v2/sqlite/runtime-state.sqlite');
  const db = new Database(dbPath);
  try {
    const staleRows = db
      .prepare(
        `
        SELECT
          legacy_session_id,
          pi_history_strategy AS strategy,
          source_message_count AS source_count
        FROM local_runtime_legacy_migrations
        WHERE status = 'migrated'
          AND pi_history_converter_version IS NULL
          AND pi_history_strategy LIKE 'native-%'
        ORDER BY migrated_at_ms ASC
        `,
      )
      .all() as Array<{ legacy_session_id: string; strategy: string; source_count: number }>;

    const before = new Map<string, StaleSnapshotRow>();
    for (const row of staleRows) {
      const counters = db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN data_json LIKE '%"type":"toolCall"%' THEN 1 ELSE 0 END) AS toolCall,
            SUM(CASE WHEN role = 'toolResult' THEN 1 ELSE 0 END) AS toolResult,
            SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant,
            SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user
          FROM local_runtime_pi_history_rows
          WHERE session_id = ?
          `,
        )
        .get(row.legacy_session_id) as { toolCall: number; toolResult: number; assistant: number; user: number };
      before.set(row.legacy_session_id, {
        legacy_session_id: row.legacy_session_id,
        strategy: row.strategy,
        source_count: row.source_count,
        pi_before: {
          toolCall: counters.toolCall ?? 0,
          toolResult: counters.toolResult ?? 0,
          assistant: counters.assistant ?? 0,
          user: counters.user ?? 0,
        },
      });
    }
    console.log(`[compensate] snapshot has ${staleRows.length} stale native-* records`);
    db.close();

    const legacyStore = new LegacyOpencodeStore({ dataDir: snapshotDir });
    const migrationStore = new SqliteLegacyMigrationStore(snapshotDir);
    const sessionStore = new SqliteLocalSessionStore(snapshotDir);
    const messageStore = new SqliteLocalMessageStore(snapshotDir);
    const sessionWriter = new LiveSessionWriter({ messageStore });
    const controller = new LocalSessionController({ store: sessionStore });
    const migrator = new LegacyOpencodeMigrator({
      legacyStore,
      migrationStore,
      controller,
      messageStore,
      sessionWriter,
      primaryAgentName: 'mavis',
      defaultWorkspaceDir: () => '/workspace',
      dataDir: () => snapshotDir,
    });

    const results: VerificationResult[] = [];
    for (const row of staleRows) {
      await migrator.ensurePiHistoryMigrated(row.legacy_session_id);
      const verify = new Database(dbPath);
      try {
        const record = verify
          .prepare(
            `SELECT pi_history_converter_version AS version, pi_history_strategy AS strategy FROM local_runtime_legacy_migrations WHERE legacy_session_id = ?`,
          )
          .get(row.legacy_session_id) as { version: number | null; strategy: string };
        const after = verify
          .prepare(
            `
            SELECT
              SUM(CASE WHEN data_json LIKE '%"type":"toolCall"%' THEN 1 ELSE 0 END) AS toolCall,
              SUM(CASE WHEN role = 'toolResult' THEN 1 ELSE 0 END) AS toolResult,
              SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant,
              SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user
            FROM local_runtime_pi_history_rows
            WHERE session_id = ?
            `,
          )
          .get(row.legacy_session_id) as {
          toolCall: number;
          toolResult: number;
          assistant: number;
          user: number;
        };
        const report = verify
          .prepare(`SELECT report_json FROM local_runtime_legacy_migrations WHERE legacy_session_id = ?`)
          .get(row.legacy_session_id) as { report_json: string };
        const parsed = JSON.parse(report.report_json);
        const counts = parsed?.piHistory?.counts ?? {};
        const beforeRow = before.get(row.legacy_session_id)!;
        const toolCountSource = counts.source?.toolCall ?? 0;
        const toolCountConverted = counts.converted?.toolCall ?? 0;
        results.push({
          legacy_session_id: row.legacy_session_id,
          strategy_before: row.strategy,
          source_count: row.source_count,
          version_before: null,
          version_after: record.version,
          pi_before: beforeRow.pi_before,
          pi_after: {
            toolCall: after.toolCall ?? 0,
            toolResult: after.toolResult ?? 0,
            assistant: after.assistant ?? 0,
            user: after.user ?? 0,
          },
          tool_call_parity: { source: toolCountSource, converted: toolCountConverted },
          dropped_to_zero:
            beforeRow.pi_before.toolCall === 0 && (after.toolCall ?? 0) === 0,
          preserved_user_messages: parsed?.piHistory?.preservedUserMessages ?? 0,
          dropped_v1_rows: parsed?.piHistory?.droppedV1Rows ?? 0,
        });
      } finally {
        verify.close();
      }
    }

    console.log('\n[compensate] per-session results:');
    console.log(
      [
        'session',
        'strategy',
        'verBefore→verAfter',
        'piToolCall(前→后)',
        'piToolResult(前→后)',
        'source.toolCall',
        'converted.toolCall',
        'dropped_to_zero',
        'preservedUserTurns',
        'droppedV1Rows',
      ].join('\t'),
    );
    for (const r of results) {
      console.log(
        [
          r.legacy_session_id,
          r.strategy_before,
          `${r.version_before ?? 'NULL'}→${r.version_after ?? 'NULL'}`,
          `${r.pi_before.toolCall}→${r.pi_after.toolCall}`,
          `${r.pi_before.toolResult}→${r.pi_after.toolResult}`,
          r.tool_call_parity.source,
          r.tool_call_parity.converted,
          r.dropped_to_zero,
          r.preserved_user_messages,
          r.dropped_v1_rows,
        ].join('\t'),
      );
    }
    const allRepaired = results.every((r) => r.version_after === 2);
    const toolCallRecovered = results.filter(
      (r) => r.pi_before.toolCall === 0 && r.pi_after.toolCall > 0,
    );
    const userTurnsPreserved = results.reduce((s, r) => s + r.preserved_user_messages, 0);
    const v1RowsReplaced = results.reduce((s, r) => s + r.dropped_v1_rows, 0);
    console.log(
      `\n[compensate] all 7 records stamped version=2: ${allRepaired}; sessions that recovered tool calls (0 → >0): ${toolCallRecovered.length}/${results.length}; user-continued turns preserved: ${userTurnsPreserved}; v1 broken rows replaced: ${v1RowsReplaced}`,
    );
  } catch (err) {
    console.error('[compensate] failed:', err);
    process.exitCode = 1;
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

void main();
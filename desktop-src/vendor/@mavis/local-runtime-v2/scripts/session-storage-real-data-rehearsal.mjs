import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

const DATABASE_RELATIVE_PATH = join('v2', 'sqlite', 'runtime-state.sqlite');
const SOURCE_ENV = 'MAVIS_REHEARSAL_SOURCE_DATA_DIR';
const SOURCE_FILE_KINDS = [
  ['database', ''],
  ['wal', '-wal'],
  ['shm', '-shm'],
];
const NON_BUSINESS_SNAPSHOT_TABLES = new Set([
  'local_runtime_schema_migrations',
  'local_runtime_v2_schema_migrations',
  'local_runtime_v2_agent_legacy_history_notice_repair',
]);
const LEGACY_V1_EXPECTED_PENDING_VERSIONS = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52,
  53, 54,
]);
const FINAL_EXPECTED_MIGRATION_HISTORY = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52,
  53, 54,
]);
const FINAL_FOREIGN_M0019_MIGRATION_HISTORY = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
  52, 53, 54,
]);
const SUPPORTED_V2_BASELINE_HISTORIES = Object.freeze([
  Object.freeze([1, 2, 3, 4]),
  Object.freeze([1, 2, 3, 4, 5]),
  Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]),
]);

export class RehearsalInvariantError extends Error {
  constructor({ code, table, expected, actual, rowKey, cause }) {
    const fields = [
      `invariant=${code}`,
      ...(table ? [`table=${table}`] : []),
      ...(expected !== undefined ? [`expected=${String(expected)}`] : []),
      ...(actual !== undefined ? [`actual=${String(actual)}`] : []),
      ...(rowKey ? [`row=${rowKey}`] : []),
    ];
    super(`Session storage rehearsal failed: ${fields.join(' ')}`, cause ? { cause } : undefined);
    this.name = 'RehearsalInvariantError';
    this.code = code;
    if (table !== undefined) this.table = table;
    if (expected !== undefined) this.expected = expected;
    if (actual !== undefined) this.actual = actual;
    if (rowKey !== undefined) this.rowKey = rowKey;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      ...(this.table !== undefined ? { table: this.table } : {}),
      ...(this.expected !== undefined ? { expected: this.expected } : {}),
      ...(this.actual !== undefined ? { actual: this.actual } : {}),
      ...(this.rowKey !== undefined ? { rowKey: this.rowKey } : {}),
    };
  }
}

export function resolveRehearsalSourceDataDir(env = process.env) {
  const value = env[SOURCE_ENV]?.trim();
  if (!value) {
    throw new RehearsalInvariantError({ code: 'SOURCE_DATA_DIR_REQUIRED' });
  }
  if (!isAbsolute(value)) {
    throw new RehearsalInvariantError({ code: 'SOURCE_DATA_DIR_NOT_ABSOLUTE' });
  }
  return value;
}

export function redactedRowKey(value, salt) {
  return `sha256:${createHash('sha256')
    .update(String(salt))
    .update('\0')
    .update(String(value))
    .digest('hex')}`;
}

export async function fingerprintSourceDatabase(dataDir) {
  const databasePath = join(dataDir, DATABASE_RELATIVE_PATH);
  const entries = {};
  for (const [kind, suffix] of SOURCE_FILE_KINDS) {
    entries[kind] = await fingerprintFile(`${databasePath}${suffix}`);
  }
  if (!entries.database.exists) {
    throw new RehearsalInvariantError({ code: 'SOURCE_DATABASE_MISSING' });
  }
  return { files: entries };
}

export async function createReadOnlyDatabaseSnapshot({ sourceDataDir }) {
  if (!isAbsolute(sourceDataDir)) {
    throw new RehearsalInvariantError({ code: 'SOURCE_DATA_DIR_NOT_ABSOLUTE' });
  }
  const sourceDatabasePath = join(sourceDataDir, DATABASE_RELATIVE_PATH);
  try {
    await access(sourceDatabasePath);
  } catch (cause) {
    throw new RehearsalInvariantError({ code: 'SOURCE_DATABASE_MISSING', cause });
  }

  const before = await fingerprintSourceDatabase(sourceDataDir);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mavis-session-storage-rehearsal-'));
  const copiedDatabasePath = join(temporaryRoot, 'source-copy.sqlite');
  const snapshotDataDir = join(temporaryRoot, 'data');
  const snapshotDatabasePath = join(snapshotDataDir, DATABASE_RELATIVE_PATH);
  await mkdir(join(snapshotDataDir, 'v2', 'sqlite'), { recursive: true });

  let copiedSource;
  try {
    for (const [, suffix] of SOURCE_FILE_KINDS) {
      const fingerprint =
        before.files[suffix === '' ? 'database' : suffix === '-wal' ? 'wal' : 'shm'];
      if (fingerprint.exists) {
        await copyFile(`${sourceDatabasePath}${suffix}`, `${copiedDatabasePath}${suffix}`);
      }
    }
    const afterCopy = await fingerprintSourceDatabase(sourceDataDir);
    if (stableJson(before) !== stableJson(afterCopy)) {
      throw new RehearsalInvariantError({ code: 'SOURCE_DATABASE_CHANGED_DURING_SNAPSHOT' });
    }

    copiedSource = new BetterSqlite3(copiedDatabasePath, {
      readonly: true,
      fileMustExist: true,
    });
    assertIntegrity(copiedSource, 'SOURCE_DATABASE_INTEGRITY_FAILED');
    await copiedSource.backup(snapshotDatabasePath);
  } catch (cause) {
    await rm(temporaryRoot, { recursive: true, force: true });
    if (cause instanceof RehearsalInvariantError) throw cause;
    throw new RehearsalInvariantError({ code: 'SOURCE_DATABASE_SNAPSHOT_FAILED', cause });
  } finally {
    copiedSource?.close();
  }

  const after = await fingerprintSourceDatabase(sourceDataDir);
  if (stableJson(before) !== stableJson(after)) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw new RehearsalInvariantError({ code: 'SOURCE_DATABASE_CHANGED_DURING_SNAPSHOT' });
  }

  const snapshot = new BetterSqlite3(snapshotDatabasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assertIntegrity(snapshot, 'SNAPSHOT_DATABASE_INTEGRITY_FAILED');
  } finally {
    snapshot.close();
  }

  return {
    dataDir: snapshotDataDir,
    databasePath: snapshotDatabasePath,
    sourceFingerprint: before,
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
  };
}

export function captureLogicalSnapshot(database, selectedTables) {
  const tableNames =
    selectedTables === undefined
      ? database
          .prepare(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table'
             ORDER BY name`,
          )
          .all()
          .map((row) => readString(row, 'name'))
      : [...selectedTables].sort();
  const tables = {};

  for (const tableName of tableNames) {
    if (!tableExists(database, tableName)) continue;
    const columns = database
      .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all()
      .map((row) => readString(row, 'name'));
    if (columns.length === 0) continue;
    const captured = captureOrderedRows(database, {
      tableName,
      columns,
    });
    const schemaRow = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);
    const schemaSql =
      typeof schemaRow === 'object' &&
      schemaRow !== null &&
      'sql' in schemaRow &&
      typeof schemaRow.sql === 'string'
        ? schemaRow.sql
        : '';
    tables[tableName] = {
      columns,
      rowCount: captured.rowCount,
      rowsDigest: captured.rowsDigest,
      rowAssociationsDigest: captured.rowAssociationsDigest,
      schemaDigest: digestText(canonicalizeSql(schemaSql)),
    };
  }

  return {
    digest: digestText(
      stableJson(
        Object.fromEntries(
          Object.entries(tables).map(([tableName, table]) => [
            tableName,
            {
              columns: table.columns,
              rowCount: table.rowCount,
              rowsDigest: table.rowsDigest,
              rowAssociationsDigest: table.rowAssociationsDigest,
              schemaDigest: table.schemaDigest,
            },
          ]),
        ),
      ),
    ),
    tables,
  };
}

export function captureSessionCreateBefore(database) {
  const tableNames = database
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name <> 'local_runtime_v2_schema_migrations'
       ORDER BY name`,
    )
    .all()
    .map((row) => readString(row, 'name'));
  return {
    tables: Object.fromEntries(
      tableNames.map((tableName) => [
        tableName,
        captureTableProjection(database, tableName, readTableColumns(database, tableName)),
      ]),
    ),
  };
}

export function verifySessionCreate(before, database, { assertSchemaConsistent }) {
  assertMigrationMarker(database, 6, 'M0006_MARKER_MISSING');
  try {
    assertSchemaConsistent(database);
  } catch (cause) {
    throw new RehearsalInvariantError({ code: 'M0006_SCHEMA_CONTRACT_FAILED', cause });
  }
  for (const [tableName, expected] of Object.entries(before.tables)) {
    if (!tableExists(database, tableName)) {
      throw new RehearsalInvariantError({
        code: 'M0006_PREEXISTING_TABLE_MISSING',
        table: tableName,
      });
    }
    const actualColumns = new Set(readTableColumns(database, tableName));
    const missingColumn = expected.columns.find((column) => !actualColumns.has(column));
    if (missingColumn) {
      throw new RehearsalInvariantError({
        code: 'M0006_PREEXISTING_COLUMN_MISSING',
        table: tableName,
      });
    }
    const actual = captureTableProjection(database, tableName, expected.columns);
    if (
      actual.rowCount !== expected.rowCount ||
      actual.rowsDigest !== expected.rowsDigest ||
      actual.rowIdsDigest !== expected.rowIdsDigest ||
      actual.rowAssociationsDigest !== expected.rowAssociationsDigest
    ) {
      throw new RehearsalInvariantError({
        code: 'M0006_PREEXISTING_ROWS_CHANGED',
        table: tableName,
        expected: expected.rowCount,
        actual: actual.rowCount,
      });
    }
  }
}

const M0007_OWNED_TABLES = new Set([
  'local_runtime_v2_schema_migrations',
  'local_runtime_sessions',
  'local_runtime_projects',
  'local_runtime_project_migrations',
  'local_runtime_session_fts_keys',
  'local_runtime_sessions_fts',
  'sqlite_sequence',
]);
const SESSION_STATUS = new Set(['idle', 'started', 'error', 'aborted', 'interrupted']);
const SESSION_KIND = new Set(['conversation', 'task', 'peek', 'channel', 'cron', 'unknown']);
const SESSION_RUNTIME = new Set(['pi-agent', 'opencode']);
const SESSION_TYPE = new Set(['root', 'branch']);
const SESSION_VISIBILITY = new Set(['visible', 'hidden']);
const SESSION_EXTRA_KEYS = new Set([
  'runLocation',
  'appMode',
  'errorSource',
  'errorDetail',
  'errorProviderId',
  'effectiveModel',
  'effectiveModelVariant',
  'effectiveModelThinking',
  'effectiveModelContextWindow',
  'effectiveModelMaxOutputTokens',
  'scratchpadPath',
  'origin',
  'sessionDataVersion',
  'sessionOrigin',
]);
const RUN_LOCATION_KEYS = new Set([
  'mode',
  'resolvedDir',
  'resolvedBranch',
  'parentRepoDir',
  'createdAt',
]);
const RUN_LOCATION_MODES = new Set(['current', 'new-worktree', 'existing-worktree']);
const SESSION_STORAGE_TABLES = new Set([
  'local_runtime_sessions',
  'local_runtime_session_schema_migrations',
  'local_runtime_session_fts_keys',
  'local_runtime_session_agent_state',
  'local_runtime_task_session_bindings',
  'local_runtime_projects',
  'local_runtime_project_migrations',
  'local_runtime_messages',
  'local_runtime_message_rows',
  'local_runtime_message_row_migrations',
  'local_runtime_session_assets',
  'local_runtime_session_asset_index_state',
  'local_runtime_queues',
  'local_runtime_queue_items',
  'local_runtime_queue_pauses',
  'local_runtime_queue_row_migrations',
  'local_runtime_preferences',
  'local_runtime_token_usage',
  'local_runtime_session_locks',
  'local_runtime_turn_ingress',
  'local_runtime_turn_ingress_sequences',
  'local_runtime_turn_ingress_client_requests',
  'local_runtime_pi_history_file_migrations',
  'local_runtime_legacy_migrations',
  'local_runtime_file_api_uploads',
  'local_runtime_query_view_states',
  'local_runtime_sessions_fts',
]);
const SESSION_MIGRATION_CORE_TABLES = new Set([
  'local_runtime_sessions',
  'local_runtime_projects',
  'local_runtime_session_fts_keys',
  'local_runtime_sessions_fts',
  'local_runtime_turn_ingress',
  'local_runtime_turn_ingress_sequences',
  'local_runtime_turn_ingress_client_requests',
  'local_runtime_queues',
  'local_runtime_queue_items',
  'local_runtime_queue_pauses',
  'local_runtime_session_locks',
  'local_runtime_file_api_uploads',
  'local_runtime_query_view_states',
  'local_runtime_session_agent_definitions',
  'local_runtime_task_session_bindings',
]);
const E2E_STABLE_PROJECT_COLUMNS = [
  'project_id',
  'project_kind',
  'workspace_dir',
  'pinned',
  'hidden',
  'order_index',
  'recent_at_ms',
  'extra_data_json',
  'created_at_ms',
  'updated_at_ms',
];
const E2E_STABLE_SESSION_COLUMNS = [
  'session_id',
  'columnar_version',
  'agent_name',
  'runtime',
  'session_type',
  'status',
  'archived',
  'visibility',
  'session_kind',
  'purpose',
  'purpose_kind',
  'origin_cron_id',
  'parent_session_id',
  'workspace_dir',
  'project_workspace_dir',
  'is_default_workspace',
  'title',
  'created_at_ms',
  'error_message',
  'error_code',
  'extra_data_json',
  'project_id',
];

function expectedProjectIdentityFromSourceSession(row) {
  const columnarVersion = readSafeInteger(row, 'columnar_version');
  let isDefault;
  let workspaceDir;
  let parentRepoDir;
  if (columnarVersion < 2) {
    const record = parseJsonObject(
      readString(row, 'record_json'),
      'M0007_SOURCE_SESSION_RECORD_INVALID',
    );
    isDefault = record.isDefaultWorkspace === true;
    workspaceDir = typeof record.workspaceDir === 'string' ? record.workspaceDir : null;
    const runLocation = readObjectValue(record.runLocation);
    const createdAt = runLocation?.createdAt ?? record.createdAtMs ?? record.updatedAtMs;
    if (
      typeof runLocation?.mode === 'string' &&
      typeof runLocation.resolvedDir === 'string' &&
      typeof createdAt === 'number' &&
      Number.isSafeInteger(createdAt)
    ) {
      parentRepoDir =
        typeof runLocation.parentRepoDir === 'string' ? runLocation.parentRepoDir : undefined;
    }
  } else {
    const extra = parseJsonObject(
      readString(row, 'extra_data_json'),
      'M0007_SOURCE_SESSION_EXTRA_DATA_INVALID',
    );
    isDefault =
      extra.isDefaultWorkspace === true || readSafeInteger(row, 'is_default_workspace') === 1;
    workspaceDir = readNullableString(row, 'workspace_dir');
    const runLocation = readObjectValue(extra.runLocation);
    if (
      typeof runLocation?.mode === 'string' &&
      typeof runLocation.resolvedDir === 'string' &&
      typeof runLocation.createdAt === 'number' &&
      Number.isSafeInteger(runLocation.createdAt)
    ) {
      parentRepoDir =
        typeof runLocation.parentRepoDir === 'string' ? runLocation.parentRepoDir : undefined;
    }
  }
  if (isDefault) return { kind: 'default', workspaceDir: null };
  const canonicalWorkspace = canonicalProjectWorkspaceForRehearsal(workspaceDir, parentRepoDir);
  return canonicalWorkspace ? { kind: 'workspace', workspaceDir: canonicalWorkspace } : null;
}

function captureHistoricalProjectIdentities(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const projectId = readPositiveSafeInteger(row, 'project_id');
    const projectKind = readNullableString(row, 'project_kind');
    const workspaceDir = readNullableString(row, 'workspace_dir');
    const trimmedWorkspace = workspaceDir?.trim() ?? '';
    let identity;
    if (projectKind === 'default' || !trimmedWorkspace) {
      identity = { kind: 'default', workspaceDir: null };
    } else {
      const canonicalWorkspace = canonicalProjectWorkspaceForRehearsal(trimmedWorkspace);
      if (!canonicalWorkspace) {
        throw new RehearsalInvariantError({
          code: 'M0007_SOURCE_PROJECT_IDENTITY_INVALID',
          table: 'local_runtime_projects',
        });
      }
      identity = { kind: 'workspace', workspaceDir: canonicalWorkspace };
    }
    const key = projectIdentityKey(identity.kind, identity.workspaceDir);
    grouped.set(key, [
      ...(grouped.get(key) ?? []),
      { projectId, projectKind, workspaceDir, identity },
    ]);
  }
  return [...grouped.values()].map((candidates) => {
    const sorted = [...candidates].sort((left, right) => left.projectId - right.projectId);
    const finalized = sorted.find(({ projectKind, workspaceDir, identity }) =>
      identity.kind === 'default'
        ? projectKind === 'default' && !workspaceDir?.trim()
        : projectKind === 'workspace' && workspaceDir === identity.workspaceDir,
    );
    const exactWorkspace = sorted.find(({ workspaceDir, identity }) =>
      identity.kind === 'default' ? !workspaceDir?.trim() : workspaceDir === identity.workspaceDir,
    );
    const selected = finalized ?? exactWorkspace ?? sorted[0];
    return {
      kind: selected.identity.kind,
      workspaceDir: selected.identity.workspaceDir,
      projectId: selected.projectId,
    };
  });
}

export function captureSessionBackfillBefore(database) {
  const salt = createRehearsalSalt();
  const sessions = Array.from(
    database
      .prepare(
        `SELECT rowid AS row_id, session_id, record_json, updated_at_ms, columnar_version,
              workspace_dir, is_default_workspace, extra_data_json
       FROM local_runtime_sessions
       ORDER BY rowid`,
      )
      .iterate(),
    (row) => ({
      rowId: readSafeInteger(row, 'row_id'),
      sessionId: readString(row, 'session_id'),
      recordJsonDigest: digestText(readString(row, 'record_json')),
      updatedAtMs: readSafeInteger(row, 'updated_at_ms'),
      projectIdentity: expectedProjectIdentityFromSourceSession(row),
    }),
  );
  const tables = listTableNames(database).filter(
    (tableName) =>
      !M0007_OWNED_TABLES.has(tableName) && !tableName.startsWith('local_runtime_sessions_fts_'),
  );
  const projectRows = database
    .prepare(
      `SELECT project_id, project_kind, workspace_dir
       FROM local_runtime_projects
       ORDER BY project_id`,
    )
    .all();
  const projectIds = projectRows.map((row) => readSafeInteger(row, 'project_id'));
  const ftsKeys = Array.from(
    database
      .prepare(
        `SELECT fts_rowid, session_id
       FROM local_runtime_session_fts_keys
       ORDER BY fts_rowid`,
      )
      .iterate(),
    (row) => ({
      rowId: readSafeInteger(row, 'fts_rowid'),
      sessionId: readString(row, 'session_id'),
    }),
  );
  return {
    salt,
    sessions,
    nonTarget: captureLogicalSnapshot(database, tables),
    historicalProjectIdentities: captureHistoricalProjectIdentities(projectRows),
    historicalProjectHighWater: Math.max(
      0,
      ...projectIds,
      readSqliteSequence(database, 'local_runtime_projects'),
    ),
    historicalFtsHighWater: Math.max(
      0,
      ...ftsKeys.map(({ rowId }) => rowId),
      readSqliteSequence(database, 'local_runtime_session_fts_keys'),
    ),
    ftsKeys,
  };
}

export function verifySessionBackfill(before, database, { assertSchemaConsistent }) {
  assertMigrationMarker(database, 7, 'M0007_MARKER_MISSING');
  try {
    assertSchemaConsistent(database);
  } catch (cause) {
    throw new RehearsalInvariantError({ code: 'M0007_SCHEMA_CONTRACT_FAILED', cause });
  }
  verifySessionBackfillSessions(before, database);
  verifySessionBackfillProjects(before, database);
  verifySessionBackfillFts(before, database);
  verifyLogicalSnapshotUnchanged(before.nonTarget, database, 'M0007_NON_TARGET_TABLE_CHANGED');
  verifyProjectTriggerProbe(database, before.salt);
  assertIntegrity(database, 'M0007_DATABASE_INTEGRITY_FAILED');
}

function verifySessionBackfillSessions(before, database) {
  const rows = database
    .prepare(
      `SELECT rowid AS row_id, *
       FROM local_runtime_sessions
       ORDER BY rowid`,
    )
    .iterate();
  const expectedById = new Map(before.sessions.map((row) => [row.sessionId, row]));
  const seen = new Set();
  for (const row of rows) {
    const sessionId = readString(row, 'session_id');
    const expected = expectedById.get(sessionId);
    if (
      !expected ||
      seen.has(sessionId) ||
      readSafeInteger(row, 'row_id') !== expected.rowId ||
      digestText(readString(row, 'record_json')) !== expected.recordJsonDigest ||
      readSafeInteger(row, 'updated_at_ms') !== expected.updatedAtMs
    ) {
      throw new RehearsalInvariantError({
        code: 'M0007_SESSION_PRESERVATION_FAILED',
        table: 'local_runtime_sessions',
        rowKey: redactedRowKey(sessionId, before.salt),
      });
    }
    seen.add(sessionId);
    assertExactValue(row, 'columnar_version', 3, 'M0007_SESSION_VERSION_INVALID', before.salt);
    assertEnum(row, 'status', SESSION_STATUS, 'M0007_SESSION_ENUM_INVALID', before.salt);
    assertEnum(row, 'session_kind', SESSION_KIND, 'M0007_SESSION_ENUM_INVALID', before.salt);
    assertEnum(row, 'runtime', SESSION_RUNTIME, 'M0007_SESSION_ENUM_INVALID', before.salt);
    assertEnum(row, 'session_type', SESSION_TYPE, 'M0007_SESSION_ENUM_INVALID', before.salt);
    assertEnum(row, 'visibility', SESSION_VISIBILITY, 'M0007_SESSION_ENUM_INVALID', before.salt);
    assertBit(row, 'archived', 'M0007_SESSION_BIT_INVALID', before.salt);
    assertBit(row, 'is_default_workspace', 'M0007_SESSION_BIT_INVALID', before.salt);
    for (const field of ['updated_at_ms', 'created_at_ms', 'error_code']) {
      assertNullableSafeInteger(row, field, 'M0007_SESSION_INTEGER_INVALID', before.salt);
    }
    const extra = parseJsonObject(
      readString(row, 'extra_data_json'),
      'M0007_SESSION_EXTRA_DATA_INVALID',
    );
    if (
      Object.keys(extra).some((key) => !SESSION_EXTRA_KEYS.has(key)) ||
      !isValidSessionExtraData(extra)
    ) {
      throw new RehearsalInvariantError({
        code: 'M0007_SESSION_EXTRA_DATA_INVALID',
        table: 'local_runtime_sessions',
        rowKey: redactedRowKey(sessionId, before.salt),
      });
    }
  }
  if (seen.size !== expectedById.size) {
    throw new RehearsalInvariantError({
      code: 'M0007_SESSION_SET_CHANGED',
      table: 'local_runtime_sessions',
      expected: expectedById.size,
      actual: seen.size,
    });
  }
}

function verifySessionBackfillProjects(before, database) {
  const projects = database
    .prepare(
      `SELECT project_id, project_kind, workspace_dir, pinned, hidden, order_index,
              recent_at_ms, latest_activity_at_ms, session_count, extra_data_json,
              created_at_ms, updated_at_ms
       FROM local_runtime_projects
       ORDER BY project_id`,
    )
    .all();
  const ids = new Set();
  const workspaces = new Set();
  const projectByIdentity = new Map();
  let defaultCount = 0;
  for (const project of projects) {
    const projectId = readPositiveSafeInteger(project, 'project_id');
    if (ids.has(projectId)) {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_ID_INVALID',
        table: 'local_runtime_projects',
      });
    }
    ids.add(projectId);
    const kind = readString(project, 'project_kind');
    const workspace = readNullableString(project, 'workspace_dir');
    if (kind === 'default') {
      defaultCount += 1;
      if (workspace !== null) {
        throw new RehearsalInvariantError({
          code: 'M0007_PROJECT_IDENTITY_INVALID',
          table: 'local_runtime_projects',
        });
      }
      projectByIdentity.set(projectIdentityKey('default', null), projectId);
    } else if (kind === 'workspace') {
      if (workspace === null || workspace.trim().length === 0 || workspaces.has(workspace)) {
        throw new RehearsalInvariantError({
          code: 'M0007_PROJECT_IDENTITY_INVALID',
          table: 'local_runtime_projects',
        });
      }
      workspaces.add(workspace);
      projectByIdentity.set(projectIdentityKey('workspace', workspace), projectId);
    } else {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_IDENTITY_INVALID',
        table: 'local_runtime_projects',
      });
    }
    assertBit(project, 'pinned', 'M0007_PROJECT_STATE_INVALID', before.salt);
    assertBit(project, 'hidden', 'M0007_PROJECT_STATE_INVALID', before.salt);
    for (const field of [
      'order_index',
      'recent_at_ms',
      'latest_activity_at_ms',
      'session_count',
      'created_at_ms',
      'updated_at_ms',
    ]) {
      assertNullableSafeInteger(project, field, 'M0007_PROJECT_STATE_INVALID', before.salt);
    }
    parseJsonObject(readString(project, 'extra_data_json'), 'M0007_PROJECT_EXTRA_DATA_INVALID');
  }
  if (defaultCount > 1) {
    throw new RehearsalInvariantError({
      code: 'M0007_PROJECT_DEFAULT_DUPLICATE',
      table: 'local_runtime_projects',
      expected: 1,
      actual: defaultCount,
    });
  }

  const sessions = database
    .prepare(
      `SELECT session_id, project_id, project_workspace_dir, is_default_workspace
       FROM local_runtime_sessions
       ORDER BY session_id`,
    )
    .all();
  let needsDefault = false;
  const expectedSessionById = new Map(
    before.sessions.map((session) => [session.sessionId, session]),
  );
  for (const session of sessions) {
    const sessionId = readString(session, 'session_id');
    const projectId = readNullableSafeInteger(session, 'project_id');
    const workspace = readNullableString(session, 'project_workspace_dir');
    const isDefault = readSafeInteger(session, 'is_default_workspace') === 1;
    const expectedIdentity = expectedSessionById.get(sessionId)?.projectIdentity;
    needsDefault ||= expectedIdentity?.kind === 'default';
    if (projectId !== null && projectId > 0 && !ids.has(projectId)) {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_ORPHAN',
        table: 'local_runtime_sessions',
        rowKey: redactedRowKey(sessionId, before.salt),
      });
    }
    if (expectedIdentity?.kind === 'default') {
      const expectedProjectId = projectByIdentity.get(projectIdentityKey('default', null));
      if (!isDefault || expectedProjectId === undefined || projectId !== expectedProjectId) {
        throw new RehearsalInvariantError({
          code: 'M0007_PROJECT_ASSOCIATION_MISMATCH',
          table: 'local_runtime_sessions',
          rowKey: redactedRowKey(sessionId, before.salt),
        });
      }
    } else if (expectedIdentity?.kind === 'workspace') {
      const expectedProjectId = projectByIdentity.get(
        projectIdentityKey('workspace', expectedIdentity.workspaceDir),
      );
      if (
        isDefault ||
        workspace !== expectedIdentity.workspaceDir ||
        expectedProjectId === undefined ||
        projectId !== expectedProjectId
      ) {
        throw new RehearsalInvariantError({
          code: 'M0007_PROJECT_ASSOCIATION_MISMATCH',
          table: 'local_runtime_sessions',
          rowKey: redactedRowKey(sessionId, before.salt),
        });
      }
    } else if (
      isDefault ||
      (workspace !== null && workspace.trim().length > 0) ||
      (projectId !== null && projectId !== 0)
    ) {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_ASSOCIATION_MISMATCH',
        table: 'local_runtime_sessions',
        rowKey: redactedRowKey(sessionId, before.salt),
      });
    }
  }
  if (needsDefault && defaultCount !== 1) {
    throw new RehearsalInvariantError({
      code: 'M0007_PROJECT_DEFAULT_MISSING',
      table: 'local_runtime_projects',
      expected: 1,
      actual: defaultCount,
    });
  }
  for (const expected of before.historicalProjectIdentities) {
    const actualProjectId = projectByIdentity.get(
      projectIdentityKey(expected.kind, expected.workspaceDir),
    );
    if (actualProjectId !== expected.projectId) {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_HISTORICAL_ID_CHANGED',
        table: 'local_runtime_projects',
        rowKey: redactedRowKey(
          projectIdentityKey(expected.kind, expected.workspaceDir),
          before.salt,
        ),
      });
    }
  }

  verifyProjectAggregates(database, before.salt, 'M0007_PROJECT_AGGREGATE_MISMATCH');
  const projectHighWater = Math.max(
    0,
    ...projects.map((project) => readPositiveSafeInteger(project, 'project_id')),
    readSqliteSequence(database, 'local_runtime_projects'),
  );
  if (projectHighWater < before.historicalProjectHighWater) {
    throw new RehearsalInvariantError({
      code: 'M0007_PROJECT_HIGH_WATER_REGRESSED',
      table: 'local_runtime_projects',
      expected: before.historicalProjectHighWater,
      actual: projectHighWater,
    });
  }
}

function verifyProjectAggregates(database, salt, code, { taskSessionsOnly = false } = {}) {
  const sessionTypePredicate = taskSessionsOnly ? "AND s.session_type = 'branch'" : '';
  const aggregates = database
    .prepare(
      `SELECT p.project_id,
              COALESCE(MAX(CASE
                WHEN s.columnar_version = 3
                  ${sessionTypePredicate}
                  AND s.archived = 0
                  AND s.visibility <> 'hidden'
                  AND s.session_kind NOT IN ('peek', 'channel', 'cron')
                THEN s.updated_at_ms END), 0) AS expected_latest_activity_at_ms,
              SUM(CASE
                WHEN s.columnar_version = 3
                  ${sessionTypePredicate}
                  AND s.archived = 0
                  AND s.visibility <> 'hidden'
                  AND s.session_kind NOT IN ('peek', 'channel', 'cron')
                  AND s.parent_session_id IS NULL
                THEN 1 ELSE 0 END) AS expected_session_count,
              p.latest_activity_at_ms,
              p.session_count
       FROM local_runtime_projects p
       LEFT JOIN local_runtime_sessions s ON s.project_id = p.project_id
       GROUP BY p.project_id
       ORDER BY p.project_id`,
    )
    .all();
  for (const aggregate of aggregates) {
    if (
      readSafeInteger(aggregate, 'latest_activity_at_ms') !==
        readSafeInteger(aggregate, 'expected_latest_activity_at_ms') ||
      readSafeInteger(aggregate, 'session_count') !==
        readSafeInteger(aggregate, 'expected_session_count')
    ) {
      throw new RehearsalInvariantError({
        code,
        table: 'local_runtime_projects',
        rowKey: redactedRowKey(readSafeInteger(aggregate, 'project_id'), salt),
      });
    }
  }
}

function verifySessionBackfillFts(before, database) {
  const sessions = database
    .prepare(
      `SELECT session_id, agent_name, title, workspace_dir, purpose, status, session_type
       FROM local_runtime_sessions
       ORDER BY session_id`,
    )
    .all();
  const keys = database
    .prepare(
      `SELECT fts_rowid, session_id
       FROM local_runtime_session_fts_keys
       ORDER BY fts_rowid`,
    )
    .all();
  const documents = database
    .prepare(
      `SELECT rowid AS fts_rowid, session_id, session_id_terms, agent_name_terms, title_terms,
              workspace_dir_terms, purpose_terms, status_terms, session_type_terms
       FROM local_runtime_sessions_fts
       ORDER BY rowid`,
    )
    .all();
  if (keys.length !== sessions.length || documents.length !== sessions.length) {
    throw new RehearsalInvariantError({
      code: 'M0007_FTS_CARDINALITY_MISMATCH',
      table: 'local_runtime_sessions_fts',
      expected: sessions.length,
      actual: Math.min(keys.length, documents.length),
    });
  }
  const keyBySession = new Map();
  const sessionById = new Map(
    sessions.map((session) => [readString(session, 'session_id'), session]),
  );
  for (const key of keys) {
    const rowId = readPositiveSafeInteger(key, 'fts_rowid');
    const sessionId = readString(key, 'session_id');
    if (keyBySession.has(sessionId) || !sessionById.has(sessionId)) {
      throw new RehearsalInvariantError({
        code: 'M0007_FTS_KEY_BIJECTION_FAILED',
        table: 'local_runtime_session_fts_keys',
        rowKey: redactedRowKey(sessionId, before.salt),
      });
    }
    keyBySession.set(sessionId, rowId);
  }
  const seenDocuments = new Set();
  for (const document of documents) {
    const sessionId = readString(document, 'session_id');
    const rowId = readPositiveSafeInteger(document, 'fts_rowid');
    const session = sessionById.get(sessionId);
    if (!session || keyBySession.get(sessionId) !== rowId || seenDocuments.has(sessionId)) {
      throw new RehearsalInvariantError({
        code: 'M0007_FTS_KEY_BIJECTION_FAILED',
        table: 'local_runtime_sessions_fts',
        rowKey: redactedRowKey(sessionId, before.salt),
      });
    }
    seenDocuments.add(sessionId);
    const expected = {
      session_id_terms: sessionSearchTerms(sessionId),
      agent_name_terms: sessionSearchTerms(readNullableString(session, 'agent_name')),
      title_terms: sessionSearchTerms(readNullableString(session, 'title')),
      workspace_dir_terms: sessionSearchTerms(readNullableString(session, 'workspace_dir')),
      purpose_terms: sessionSearchTerms(readNullableString(session, 'purpose')),
      status_terms: sessionSearchTerms(readNullableString(session, 'status')),
      session_type_terms: sessionSearchTerms(readNullableString(session, 'session_type')),
    };
    if (Object.entries(expected).some(([field, value]) => readString(document, field) !== value)) {
      throw new RehearsalInvariantError({
        code: 'M0007_FTS_CONTENT_MISMATCH',
        table: 'local_runtime_sessions_fts',
        rowKey: redactedRowKey(sessionId, before.salt),
      });
    }
  }
  for (const historical of before.ftsKeys) {
    if (keyBySession.get(historical.sessionId) !== historical.rowId) {
      throw new RehearsalInvariantError({
        code: 'M0007_FTS_COMPATIBLE_KEY_CHANGED',
        table: 'local_runtime_session_fts_keys',
        rowKey: redactedRowKey(historical.sessionId, before.salt),
      });
    }
  }
  const highWater = Math.max(
    0,
    ...keys.map((key) => readPositiveSafeInteger(key, 'fts_rowid')),
    readSqliteSequence(database, 'local_runtime_session_fts_keys'),
  );
  if (highWater < before.historicalFtsHighWater || highWater >= Number.MAX_SAFE_INTEGER) {
    throw new RehearsalInvariantError({
      code: 'M0007_FTS_HIGH_WATER_INVALID',
      table: 'local_runtime_session_fts_keys',
      expected: before.historicalFtsHighWater,
      actual: highWater,
    });
  }
}

function verifyProjectTriggerProbe(database, salt) {
  const suffix = redactedRowKey('project-trigger-probe', salt).slice(-16);
  const sessionId = `rehearsal-probe-${suffix}`;
  const workspaceDir = `/__mavis_rehearsal__/${suffix}`;
  database.exec('SAVEPOINT rehearsal_project_trigger_probe');
  try {
    database
      .prepare(
        `INSERT INTO local_runtime_sessions(
           session_id, record_json, updated_at_ms, columnar_version, agent_name, runtime,
           session_type, status, archived, visibility, session_kind, purpose_kind,
           project_workspace_dir, is_default_workspace, title, created_at_ms, extra_data_json
         ) VALUES (?, '{}', 9001, 3, 'rehearsal', 'pi-agent', 'root', 'idle', 0,
                   'visible', 'conversation', '', ?, 0, 'rehearsal', 9000, '{}')`,
      )
      .run(sessionId, workspaceDir);
    const inserted = database
      .prepare(
        `SELECT p.project_id, p.session_count, p.latest_activity_at_ms
         FROM local_runtime_sessions s
         INNER JOIN local_runtime_projects p ON p.project_id = s.project_id
         WHERE s.session_id = ? AND p.workspace_dir = ?`,
      )
      .get(sessionId, workspaceDir);
    if (
      !inserted ||
      readSafeInteger(inserted, 'session_count') !== 1 ||
      readSafeInteger(inserted, 'latest_activity_at_ms') !== 9001
    ) {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_TRIGGER_INSERT_FAILED',
        table: 'local_runtime_projects',
      });
    }
    database
      .prepare('UPDATE local_runtime_sessions SET archived = 1 WHERE session_id = ?')
      .run(sessionId);
    const archived = database
      .prepare(
        `SELECT p.session_count, p.latest_activity_at_ms
         FROM local_runtime_sessions s
         INNER JOIN local_runtime_projects p ON p.project_id = s.project_id
         WHERE s.session_id = ?`,
      )
      .get(sessionId);
    if (
      !archived ||
      readSafeInteger(archived, 'session_count') !== 0 ||
      readSafeInteger(archived, 'latest_activity_at_ms') !== 0
    ) {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_TRIGGER_UPDATE_FAILED',
        table: 'local_runtime_projects',
      });
    }
    database
      .prepare('UPDATE local_runtime_sessions SET archived = 0 WHERE session_id = ?')
      .run(sessionId);
    database.prepare('DELETE FROM local_runtime_sessions WHERE session_id = ?').run(sessionId);
    const deleted = database
      .prepare(
        `SELECT session_count, latest_activity_at_ms
         FROM local_runtime_projects
         WHERE workspace_dir = ?`,
      )
      .get(workspaceDir);
    if (
      !deleted ||
      readSafeInteger(deleted, 'session_count') !== 0 ||
      readSafeInteger(deleted, 'latest_activity_at_ms') !== 0
    ) {
      throw new RehearsalInvariantError({
        code: 'M0007_PROJECT_TRIGGER_DELETE_FAILED',
        table: 'local_runtime_projects',
      });
    }
  } finally {
    database.exec('ROLLBACK TO rehearsal_project_trigger_probe');
    database.exec('RELEASE rehearsal_project_trigger_probe');
  }
}

const M0008_OWNED_TABLES = new Set([
  'local_runtime_v2_schema_migrations',
  'local_runtime_turn_ingress',
  'local_runtime_turn_ingress_sequences',
  'local_runtime_turn_ingress_client_requests',
  'sqlite_sequence',
]);
const INGRESS_IMMUTABLE_FIELDS = [
  'row_id',
  'turn_id',
  'session_id',
  'source',
  'client_request_id',
  'claim_id',
  'claim_source',
  'queue_item_ids_json',
  'status',
  'accepted_at_ms',
  'completed_at_ms',
  'queue_acknowledged_at_ms',
];
const INPUT_METADATA_KEYS = [
  'contentBytes',
  'attachmentCount',
  'queuedMessageCount',
  'hasModelSelection',
  'hasChannelContext',
  'hasQuotedMessage',
];
const LEGACY_SCRUBBED_INPUT_METADATA_KEYS = ['attachmentCount', 'hasContent'];

export function captureIngressNormalizeBefore(database) {
  const salt = createRehearsalSalt();
  const ingress = Array.from(
    database
      .prepare(
        `SELECT rowid AS row_id, turn_id, session_id, source, client_request_id, claim_id,
              claim_source, queue_item_ids_json, input_json, status, accepted_at_ms,
              accepted_sequence, completed_at_ms, queue_acknowledged_at_ms, input_digest,
              input_metadata_json
         FROM local_runtime_turn_ingress
         ORDER BY rowid, turn_id`,
      )
      .iterate(),
    (row) => ({
      turnId: readString(row, 'turn_id'),
      sessionId: readString(row, 'session_id'),
      clientRequestId: readNullableString(row, 'client_request_id'),
      acceptedSequence: row.accepted_sequence,
      immutableDigest: digestText(
        stableJson(INGRESS_IMMUTABLE_FIELDS.map((field) => encodeCell(row[field]))),
      ),
      descriptor: expectedInputDescriptor(row),
    }),
  );
  const sequenceMappings = database
    .prepare(
      `SELECT sequence, turn_id
       FROM local_runtime_turn_ingress_sequences
       ORDER BY sequence, turn_id`,
    )
    .all()
    .map((row) => ({
      sequence: readSafeInteger(row, 'sequence'),
      turnId: readString(row, 'turn_id'),
    }));
  const clientMappings = database
    .prepare(
      `SELECT session_id, client_request_id, turn_id, ordinal
       FROM local_runtime_turn_ingress_client_requests
       ORDER BY turn_id, ordinal, client_request_id`,
    )
    .all()
    .map(readClientMapping);
  const historicalHighWater = Math.max(
    0,
    ...ingress.flatMap((row) => {
      const value = row.acceptedSequence;
      return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? [value] : [];
    }),
    ...sequenceMappings.map(({ sequence }) => sequence),
    readSqliteSequence(database, 'local_runtime_turn_ingress_sequences'),
  );
  const acceptedCounts = frequency(
    ingress.flatMap((row) => {
      const value = row.acceptedSequence;
      return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? [value] : [];
    }),
  );
  const mappingsByTurn = groupBy(sequenceMappings, ({ turnId }) => turnId);
  const mappingsBySequence = groupBy(sequenceMappings, ({ sequence }) => sequence);
  let nextSequence = historicalHighWater;
  const expectedSequences = new Map();
  for (const row of ingress) {
    const turnId = row.turnId;
    const candidate = row.acceptedSequence;
    const turnMappings = mappingsByTurn.get(turnId) ?? [];
    const sequenceMappingsForCandidate =
      typeof candidate === 'number' ? (mappingsBySequence.get(candidate) ?? []) : [];
    const preserve =
      typeof candidate === 'number' &&
      Number.isSafeInteger(candidate) &&
      candidate > 0 &&
      acceptedCounts.get(candidate) === 1 &&
      (turnMappings.length === 0 ||
        (turnMappings.length === 1 && turnMappings[0].sequence === candidate)) &&
      (sequenceMappingsForCandidate.length === 0 ||
        (sequenceMappingsForCandidate.length === 1 &&
          sequenceMappingsForCandidate[0].turnId === turnId));
    if (preserve) {
      expectedSequences.set(turnId, candidate);
    } else {
      nextSequence += 1;
      expectedSequences.set(turnId, nextSequence);
    }
  }
  const durableIdentities = new Map();
  for (const mapping of clientMappings) {
    durableIdentities.set(clientIdentity(mapping.sessionId, mapping.clientRequestId), {
      ...mapping,
    });
  }
  for (const row of ingress) {
    const clientRequestId = row.clientRequestId;
    if (clientRequestId === null) continue;
    const { sessionId, turnId } = row;
    durableIdentities.set(clientIdentity(sessionId, clientRequestId), {
      sessionId,
      clientRequestId,
      turnId,
    });
  }
  const tables = listTableNames(database).filter((tableName) => !M0008_OWNED_TABLES.has(tableName));
  return {
    salt,
    ingress: ingress.map(({ turnId, immutableDigest, descriptor }) => ({
      turnId,
      immutableDigest,
      descriptor,
    })),
    expectedSequences,
    durableIdentities,
    historicalHighWater,
    nonTarget: captureLogicalSnapshot(database, tables),
  };
}

export function verifyIngressNormalize(before, database) {
  assertMigrationMarker(database, 8, 'M0008_MARKER_MISSING');
  const ingressRows = database
    .prepare(
      `SELECT rowid AS row_id, turn_id, session_id, source, client_request_id, claim_id,
              claim_source, queue_item_ids_json, input_json, status, accepted_at_ms,
              accepted_sequence, completed_at_ms, queue_acknowledged_at_ms, input_digest,
              input_metadata_json
       FROM local_runtime_turn_ingress
       ORDER BY rowid, turn_id`,
    )
    .all();
  const beforeByTurn = new Map(before.ingress.map((row) => [row.turnId, row]));
  if (ingressRows.length !== beforeByTurn.size) {
    throw new RehearsalInvariantError({
      code: 'M0008_INGRESS_SET_CHANGED',
      table: 'local_runtime_turn_ingress',
      expected: beforeByTurn.size,
      actual: ingressRows.length,
    });
  }
  for (const row of ingressRows) {
    const turnId = readString(row, 'turn_id');
    const expected = beforeByTurn.get(turnId);
    const immutableDigest = digestText(
      stableJson(INGRESS_IMMUTABLE_FIELDS.map((field) => encodeCell(row[field]))),
    );
    if (!expected || expected.immutableDigest !== immutableDigest) {
      throw new RehearsalInvariantError({
        code: 'M0008_INGRESS_PRESERVATION_FAILED',
        table: 'local_runtime_turn_ingress',
        rowKey: redactedRowKey(turnId, before.salt),
      });
    }
    if (readString(row, 'input_json') !== '{}') {
      throw new RehearsalInvariantError({
        code: 'M0008_INPUT_NOT_SCRUBBED',
        table: 'local_runtime_turn_ingress',
        rowKey: redactedRowKey(turnId, before.salt),
      });
    }
    const actualMetadata = parseInputMetadata(
      readString(row, 'input_metadata_json'),
      'M0008_INPUT_DESCRIPTOR_MISMATCH',
    );
    if (
      readString(row, 'input_digest') !== expected.descriptor.digest ||
      stableJson(actualMetadata) !== stableJson(expected.descriptor.metadata)
    ) {
      throw new RehearsalInvariantError({
        code: 'M0008_INPUT_DESCRIPTOR_MISMATCH',
        table: 'local_runtime_turn_ingress',
        rowKey: redactedRowKey(turnId, before.salt),
      });
    }
  }
  verifyIngressNormalizeSequences(before, database, ingressRows);
  verifyIngressNormalizeClientIdentities(before, database, ingressRows);
  verifyLogicalSnapshotUnchanged(before.nonTarget, database, 'M0008_NON_TARGET_TABLE_CHANGED');
  assertIntegrity(database, 'M0008_DATABASE_INTEGRITY_FAILED');
}

export async function runSessionStorageRealDataRehearsal({ sourceDataDir, production }) {
  const sourceFingerprintBefore = await fingerprintSourceDatabase(sourceDataDir);
  try {
    const sourceSnapshot = await createReadOnlyDatabaseSnapshot({ sourceDataDir });
    let source;
    let sourceSummary;
    try {
      source = new BetterSqlite3(sourceSnapshot.databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      const migrationVersions = assertSourceMigrationPreconditions(source);
      sourceSummary = {
        sourceKind: migrationVersions.length === 0 ? 'legacy-v1' : 'v2-baseline',
        migrationVersions,
        tableCount: listTableNames(source).length,
        sessionCount: readTableCount(source, 'local_runtime_sessions'),
        projectCount: readTableCount(source, 'local_runtime_projects'),
        ingressCount: readTableCount(source, 'local_runtime_turn_ingress'),
        fingerprint: sourceFingerprintBefore,
      };
    } finally {
      source?.close();
      await sourceSnapshot.cleanup();
    }

    const stepwise = await runStepwiseRehearsal({ sourceDataDir, production });
    const initialized = await runProductionInitializeRehearsal({
      sourceDataDir,
      production,
      expectedFinalDigest:
        sourceSummary.sourceKind === 'v2-baseline' ? stepwise.finalDigest : undefined,
      expectedSessionStorageDigest: stepwise.sessionStorageDigest,
    });
    return {
      success: true,
      source: sourceSummary,
      stepwise,
      production: initialized,
    };
  } finally {
    const sourceFingerprintAfter = await fingerprintSourceDatabase(sourceDataDir);
    if (stableJson(sourceFingerprintBefore) !== stableJson(sourceFingerprintAfter)) {
      throw new RehearsalInvariantError({
        code: 'SOURCE_DATABASE_CHANGED_DURING_REHEARSAL',
      });
    }
  }
}

export async function runStepwiseRehearsal({ sourceDataDir, production, captureComparisonState }) {
  const snapshot = await createReadOnlyDatabaseSnapshot({ sourceDataDir });
  const client = new production.DatabaseClient({ dataDir: snapshot.dataDir });
  try {
    const sourceVersions = assertSourceMigrationPreconditions(client.rawDb);
    const byVersion = new Map(
      production.migrations.map((migration) => [migration.version, migration]),
    );
    const baselineMigrations = {};
    if (sourceVersions.length === 0) {
      const beforeBaseline = captureLogicalSnapshot(client.rawDb);
      const baselineEntries = [1, 2, 3, 4].map((version) => requireMigration(byVersion, version));
      production.runMigrations(client.rawDb, baselineEntries);
      verifyLogicalSnapshotUnchanged(
        beforeBaseline,
        client.rawDb,
        'BASELINE_PREEXISTING_TABLE_CHANGED',
      );
      assertMigrationHistory(client.rawDb, [1, 2, 3, 4], 'BASELINE_MIGRATION_HISTORY_INVALID');
      for (const version of [1, 2, 3, 4]) baselineMigrations[version] = 'PASS';
    }
    const pluginMigration = requireMigration(byVersion, 5);
    const sessionCreateMigration = requireMigration(byVersion, 6);
    const sessionBackfillMigration = requireMigration(byVersion, 7);
    const ingressNormalizeMigration = requireMigration(byVersion, 8);
    const queryIndexesMigration = requireMigration(byVersion, 9);
    const queueConvergenceMigration = requireMigration(byVersion, 10);
    const fileApiMigration = requireMigration(byVersion, 11);
    const legacyPrimaryAgentMigration = requireMigration(byVersion, 12);
    const v1SessionRecordJsonMigration = requireMigration(byVersion, 13);
    const agentsMigration = requireMigration(byVersion, 14);
    const legacyDefaultProjectsMigration = requireMigration(byVersion, 15);
    const queryCollapseMigration = requireMigration(byVersion, 16);
    const projectTaskAggregatesMigration = requireMigration(byVersion, 17);
    const projectTriggerCompatibilityMigration = requireMigration(byVersion, 18);
    const taskSessionBindingsMigration = requireMigration(byVersion, 20);
    const sessionHistoryLocationMigration = requireMigration(byVersion, 21);
    const queuePausesMigration = requireMigration(byVersion, 22);
    const miniAppStateMigration = requireMigration(byVersion, 23);
    const canvasMigration = requireMigration(byVersion, 24);
    const sessionResourcesMigration = requireMigration(byVersion, 25);
    const sourceToolCallIndexMigration = requireMigration(byVersion, 26);
    const taskSessionBindingsCollisionRepairMigration = requireMigration(byVersion, 27);
    const sessionHistoryLocationCollisionRepairMigration = requireMigration(byVersion, 28);
    const queuePausesCollisionRepairMigration = requireMigration(byVersion, 29);
    const liveBoardStateCollisionRepairMigration = requireMigration(byVersion, 30);
    const canvasCollisionRepairMigration = requireMigration(byVersion, 31);
    const continuationDurationRepairMigration = requireMigration(byVersion, 32);
    const channelProjectSchemaMigration = requireMigration(byVersion, 33);
    const sharedProjectSchemaCompatibilityMigration = requireMigration(byVersion, 34);
    const publishedSchemaCollisionConvergenceMigration = requireMigration(byVersion, 35);
    const cronManualRequestIndexRepairMigration = requireMigration(byVersion, 36);
    const memoryMigration = requireMigration(byVersion, 37);
    const rebuildMemoryMigration = requireMigration(byVersion, 38);
    const memoryGovernanceMigration = requireMigration(byVersion, 39);
    const memoryExecutionsMigration = requireMigration(byVersion, 40);
    const sessionClioMigration = requireMigration(byVersion, 41);
    const sideChatsMigration = requireMigration(byVersion, 42);
    const cronDeferredDeliveryMigration = requireMigration(byVersion, 43);
    const sourceCollisionMigration = requireMigration(byVersion, 44);
    const goalBranchCollisionMigration = requireMigration(byVersion, 45);
    const goalOwnerMigration = requireMigration(byVersion, 46);
    const goalRequestLedgerMigration = requireMigration(byVersion, 47);
    const goalTokenUsageMigration = requireMigration(byVersion, 48);
    const backgroundTasksMigration = requireMigration(byVersion, 49);
    const pluginMiniAppPermissionMigration = requireMigration(byVersion, 50);
    const goalCacheWriteUnreportedMigration = requireMigration(byVersion, 51);
    const goalLimitsMigration = requireMigration(byVersion, 52);
    const projectDisplayNameMigration = requireMigration(byVersion, 53);
    const pptPreviewMigration = requireMigration(byVersion, 54);

    production.runMigrations(client.rawDb, [pluginMigration]);

    const beforeCreate = captureSessionCreateBefore(client.rawDb);
    production.runMigrations(client.rawDb, [sessionCreateMigration]);
    verifySessionCreate(beforeCreate, client.rawDb, {
      assertSchemaConsistent: production.assertSchemaConsistent,
    });

    const beforeBackfill = captureSessionBackfillBefore(client.rawDb);
    production.runMigrations(client.rawDb, [sessionBackfillMigration]);
    verifySessionBackfill(beforeBackfill, client.rawDb, {
      assertSchemaConsistent: production.assertSchemaConsistent,
    });

    const beforeNormalize = captureIngressNormalizeBefore(client.rawDb);
    production.runMigrations(client.rawDb, [ingressNormalizeMigration]);
    verifyIngressNormalize(beforeNormalize, client.rawDb);

    production.runMigrations(client.rawDb, [queryIndexesMigration]);
    production.runMigrations(client.rawDb, [queueConvergenceMigration]);
    production.runMigrations(client.rawDb, [fileApiMigration]);
    production.runMigrations(client.rawDb, [legacyPrimaryAgentMigration]);
    production.runMigrations(client.rawDb, [v1SessionRecordJsonMigration]);
    production.runMigrations(client.rawDb, [agentsMigration]);
    production.runMigrations(client.rawDb, [legacyDefaultProjectsMigration]);
    production.runMigrations(client.rawDb, [queryCollapseMigration]);
    const hadProjectTaskAggregates = sourceVersions.includes(17);
    production.runMigrations(client.rawDb, [projectTaskAggregatesMigration]);
    if (!hadProjectTaskAggregates) {
      verifyProjectAggregates(
        client.rawDb,
        beforeBackfill.salt,
        'M0017_PROJECT_AGGREGATE_MISMATCH',
        {
          taskSessionsOnly: true,
        },
      );
    }
    const hadProjectTriggerCompatibility = sourceVersions.includes(18);
    production.runMigrations(client.rawDb, [projectTriggerCompatibilityMigration]);
    if (!hadProjectTriggerCompatibility) {
      verifyProjectAggregates(
        client.rawDb,
        beforeBackfill.salt,
        'M0018_PROJECT_AGGREGATE_MISMATCH',
      );
    }
    production.runMigrations(client.rawDb, [taskSessionBindingsMigration]);
    production.runMigrations(client.rawDb, [sessionHistoryLocationMigration]);
    production.runMigrations(client.rawDb, [queuePausesMigration]);
    production.runMigrations(client.rawDb, [miniAppStateMigration]);
    production.runMigrations(client.rawDb, [canvasMigration]);
    production.runMigrations(client.rawDb, [sessionResourcesMigration]);
    production.runMigrations(client.rawDb, [sourceToolCallIndexMigration]);
    production.runMigrations(client.rawDb, [taskSessionBindingsCollisionRepairMigration]);
    production.runMigrations(client.rawDb, [sessionHistoryLocationCollisionRepairMigration]);
    production.runMigrations(client.rawDb, [queuePausesCollisionRepairMigration]);
    production.runMigrations(client.rawDb, [liveBoardStateCollisionRepairMigration]);
    production.runMigrations(client.rawDb, [canvasCollisionRepairMigration]);
    production.runMigrations(client.rawDb, [continuationDurationRepairMigration]);
    production.runMigrations(client.rawDb, [channelProjectSchemaMigration]);
    production.runMigrations(client.rawDb, [sharedProjectSchemaCompatibilityMigration]);
    production.runMigrations(client.rawDb, [publishedSchemaCollisionConvergenceMigration]);
    production.runMigrations(client.rawDb, [cronManualRequestIndexRepairMigration]);
    production.runMigrations(client.rawDb, [memoryMigration]);
    production.runMigrations(client.rawDb, [rebuildMemoryMigration]);
    production.runMigrations(client.rawDb, [memoryGovernanceMigration]);
    production.runMigrations(client.rawDb, [memoryExecutionsMigration]);
    production.runMigrations(client.rawDb, [sessionClioMigration]);
    production.runMigrations(client.rawDb, [sideChatsMigration]);
    production.runMigrations(client.rawDb, [cronDeferredDeliveryMigration]);
    production.runMigrations(client.rawDb, [sourceCollisionMigration]);
    production.runMigrations(client.rawDb, [goalBranchCollisionMigration]);
    production.runMigrations(client.rawDb, [goalOwnerMigration]);
    production.runMigrations(client.rawDb, [goalRequestLedgerMigration]);
    production.runMigrations(client.rawDb, [goalTokenUsageMigration]);
    production.runMigrations(client.rawDb, [backgroundTasksMigration]);
    production.runMigrations(client.rawDb, [pluginMiniAppPermissionMigration]);
    production.runMigrations(client.rawDb, [goalCacheWriteUnreportedMigration]);
    production.runMigrations(client.rawDb, [goalLimitsMigration]);
    production.runMigrations(client.rawDb, [projectDisplayNameMigration]);
    production.runMigrations(client.rawDb, [pptPreviewMigration]);
    production.assertSchemaConsistent(client.rawDb);
    const migrationCore = captureSessionMigrationCoreSnapshot(client.rawDb);

    return {
      baselineMigrations,
      migrations: {
        5: 'PASS',
        6: 'PASS',
        7: 'PASS',
        8: 'PASS',
        9: 'PASS',
        10: 'PASS',
        11: 'PASS',
        12: 'PASS',
        13: 'PASS',
        14: 'PASS',
        15: 'PASS',
        16: 'PASS',
        17: 'PASS',
        18: 'PASS',
        20: 'PASS',
        21: 'PASS',
        22: 'PASS',
        23: 'PASS',
        24: 'PASS',
        25: 'PASS',
        26: 'PASS',
        27: 'PASS',
        28: 'PASS',
        29: 'PASS',
        30: 'PASS',
        31: 'PASS',
        32: 'PASS',
        33: 'PASS',
        34: 'PASS',
        35: 'PASS',
        36: 'PASS',
        37: 'PASS',
        38: 'PASS',
        39: 'PASS',
        40: 'PASS',
        41: 'PASS',
        42: 'PASS',
        43: 'PASS',
        44: 'PASS',
        45: 'PASS',
        46: 'PASS',
        47: 'PASS',
        48: 'PASS',
        49: 'PASS',
        50: 'PASS',
        52: 'PASS',
        53: 'PASS',
      },
      finalDigest: captureBusinessLogicalSnapshot(client.rawDb).digest,
      sessionStorageDigest: captureSessionStorageLogicalSnapshot(client.rawDb).digest,
      migrationCoreDigest: logicalDataDigest(migrationCore),
      sessionCount: readTableCount(client.rawDb, 'local_runtime_sessions'),
      projectCount: readTableCount(client.rawDb, 'local_runtime_projects'),
      ingressCount: readTableCount(client.rawDb, 'local_runtime_turn_ingress'),
      ...(captureComparisonState ? { comparisonState: captureComparisonState(client.rawDb) } : {}),
    };
  } finally {
    client.close();
    await snapshot.cleanup();
  }
}

export async function runProductionInitializeRehearsal({
  sourceDataDir,
  production,
  expectedFinalDigest,
  expectedSessionStorageDigest,
}) {
  const snapshot = await createReadOnlyDatabaseSnapshot({ sourceDataDir });
  // Backups are opt-in per migration entry (ADR v2) and the production
  // catalog declares none; the rehearsal opts the newest entry in so the
  // pre-migration backup invariants keep being exercised against real data.
  const rehearsalCatalog = production.migrations.map((migration, index) =>
    index === production.migrations.length - 1 ? { ...migration, backup: true } : migration,
  );
  let client = new production.DatabaseClient({ dataDir: snapshot.dataDir });
  try {
    const sourceVersions = assertSourceMigrationPreconditions(client.rawDb);
    const before = captureLogicalSnapshot(client.rawDb);
    const first = await production.initializeDatabase({
      database: client,
      dataDir: snapshot.dataDir,
      migrations: rehearsalCatalog,
    });
    const expectedPendingVersions = LEGACY_V1_EXPECTED_PENDING_VERSIONS.filter(
      (version) => !sourceVersions.includes(version),
    );
    if (stableJson(first.pendingVersions) !== stableJson(expectedPendingVersions)) {
      throw new RehearsalInvariantError({
        code: 'PRODUCTION_PENDING_VERSIONS_MISMATCH',
        expected: expectedPendingVersions.join(','),
        actual: first.pendingVersions.join(','),
      });
    }
    if (!first.backup.created) {
      throw new RehearsalInvariantError({ code: 'PRODUCTION_BACKUP_MISSING' });
    }
    const backupPath = join(snapshot.dataDir, 'v2', 'sqlite', 'backups', first.backup.fileName);
    const backup = new BetterSqlite3(backupPath, { readonly: true, fileMustExist: true });
    let backupSnapshot;
    try {
      assertIntegrity(backup, 'PRODUCTION_BACKUP_INTEGRITY_FAILED');
      backupSnapshot = captureLogicalSnapshot(backup);
    } finally {
      backup.close();
    }
    if (backupSnapshot.digest !== before.digest) {
      throw new RehearsalInvariantError({ code: 'PRODUCTION_BACKUP_CONTENT_MISMATCH' });
    }
    production.assertSchemaConsistent(client.rawDb);
    const finalDigest = captureBusinessLogicalSnapshot(client.rawDb).digest;
    const sessionStorageDigest = captureSessionStorageLogicalSnapshot(client.rawDb).digest;
    if (expectedFinalDigest !== undefined && finalDigest !== expectedFinalDigest) {
      throw new RehearsalInvariantError({
        code: 'PRODUCTION_FINAL_STATE_MISMATCH',
        expected: expectedFinalDigest,
        actual: finalDigest,
      });
    }
    if (
      expectedSessionStorageDigest !== undefined &&
      sessionStorageDigest !== expectedSessionStorageDigest
    ) {
      throw new RehearsalInvariantError({
        code: 'PRODUCTION_SESSION_STORAGE_STATE_MISMATCH',
        expected: expectedSessionStorageDigest,
        actual: sessionStorageDigest,
      });
    }
    const backupCount = await countBackupFiles(snapshot.dataDir);
    client.close();
    client = new production.DatabaseClient({ dataDir: snapshot.dataDir });
    const second = await production.initializeDatabase({
      database: client,
      dataDir: snapshot.dataDir,
      migrations: rehearsalCatalog,
    });
    if (second.pendingVersions.length !== 0 || second.backup.created) {
      throw new RehearsalInvariantError({ code: 'PRODUCTION_RESTART_NOT_IDEMPOTENT' });
    }
    const restartDigest = captureBusinessLogicalSnapshot(client.rawDb).digest;
    const restartBackupCount = await countBackupFiles(snapshot.dataDir);
    if (restartDigest !== finalDigest || restartBackupCount !== backupCount) {
      throw new RehearsalInvariantError({ code: 'PRODUCTION_RESTART_NOT_IDEMPOTENT' });
    }
    return {
      pendingVersions: [...first.pendingVersions],
      backupIntegrity: true,
      finalDigest,
      sessionStorageDigest,
      restartIdempotent: true,
    };
  } finally {
    client.close();
    await snapshot.cleanup();
  }
}

export function assertSourceMigrationPreconditions(database) {
  assertIntegrity(database, 'SOURCE_DATABASE_INTEGRITY_FAILED');
  if (!tableExists(database, 'local_runtime_sessions')) {
    throw new RehearsalInvariantError({
      code: 'SOURCE_REQUIRED_TABLE_MISSING',
      table: 'local_runtime_sessions',
    });
  }
  if (!tableExists(database, 'local_runtime_v2_schema_migrations')) {
    const partialBaseline = [
      'local_runtime_v2_scheduler_jobs',
      'local_runtime_v2_cron_definitions',
      'local_runtime_v2_cron_runs',
    ].find((tableName) => tableExists(database, tableName));
    if (partialBaseline) {
      throw new RehearsalInvariantError({
        code: 'SOURCE_MIGRATION_HISTORY_UNSUPPORTED',
        table: partialBaseline,
      });
    }
    return [];
  }
  const versions = database
    .prepare('SELECT version FROM local_runtime_v2_schema_migrations ORDER BY version')
    .all()
    .map((row) => readSafeInteger(row, 'version'));
  if (
    !SUPPORTED_V2_BASELINE_HISTORIES.some((history) => stableJson(versions) === stableJson(history))
  ) {
    throw new RehearsalInvariantError({
      code: 'SOURCE_MIGRATION_HISTORY_UNSUPPORTED',
      expected: ['1,2,3,4', '1,2,3,4,5', '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19'].join(
        ' or ',
      ),
      actual: versions.join(','),
    });
  }
  for (const tableName of ['local_runtime_turn_ingress']) {
    if (!tableExists(database, tableName)) {
      throw new RehearsalInvariantError({
        code: 'SOURCE_REQUIRED_TABLE_MISSING',
        table: tableName,
      });
    }
  }
  return versions;
}

export function inspectFinalSessionStorageDatabase({ databasePath, assertSchemaConsistent }) {
  const database = new BetterSqlite3(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assertIntegrity(database, 'FINAL_DATABASE_INTEGRITY_FAILED');
    try {
      assertSchemaConsistent(database);
    } catch (cause) {
      throw new RehearsalInvariantError({ code: 'FINAL_SCHEMA_CONTRACT_FAILED', cause });
    }
    const versions = database
      .prepare('SELECT version FROM local_runtime_v2_schema_migrations ORDER BY version')
      .all()
      .map((row) => readSafeInteger(row, 'version'));
    if (!isFinalMigrationHistory(versions)) {
      throw new RehearsalInvariantError({
        code: 'FINAL_MIGRATION_HISTORY_INVALID',
        expected: `${FINAL_EXPECTED_MIGRATION_HISTORY.join(',')} or ${FINAL_FOREIGN_M0019_MIGRATION_HISTORY.join(',')}`,
        actual: versions.join(','),
      });
    }
    verifyProjectAggregates(database, createRehearsalSalt(), 'FINAL_PROJECT_AGGREGATE_MISMATCH');
    const migrationCore = captureSessionMigrationCoreSnapshot(database);
    return {
      versions,
      digest: captureBusinessLogicalSnapshot(database).digest,
      sessionStorageDigest: captureSessionStorageLogicalSnapshot(database).digest,
      migrationCoreDigest: logicalDataDigest(migrationCore),
      sessionCount: readTableCount(database, 'local_runtime_sessions'),
      projectCount: readTableCount(database, 'local_runtime_projects'),
      ingressCount: readTableCount(database, 'local_runtime_turn_ingress'),
    };
  } finally {
    database.close();
  }
}

function isFinalMigrationHistory(versions) {
  return [FINAL_EXPECTED_MIGRATION_HISTORY, FINAL_FOREIGN_M0019_MIGRATION_HISTORY].some(
    (history) => stableJson(versions) === stableJson(history),
  );
}

export function readRehearsalSourceSelection(databasePath) {
  const database = new BetterSqlite3(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return {
      sessionIds: database
        .prepare('SELECT session_id FROM local_runtime_sessions ORDER BY rowid, session_id')
        .all()
        .map((row) => readString(row, 'session_id')),
      turnIds: tableExists(database, 'local_runtime_turn_ingress')
        ? database
            .prepare('SELECT turn_id FROM local_runtime_turn_ingress ORDER BY rowid, turn_id')
            .all()
            .map((row) => readString(row, 'turn_id'))
        : [],
    };
  } finally {
    database.close();
  }
}

export function captureSelectedMigrationState(databaseOrPath, selection) {
  const ownsDatabase = typeof databaseOrPath === 'string';
  const database = ownsDatabase
    ? new BetterSqlite3(databaseOrPath, { readonly: true, fileMustExist: true })
    : databaseOrPath;
  try {
    const tables = {};
    tables.local_runtime_sessions = captureFilteredTable(
      database,
      'local_runtime_sessions',
      'session_id',
      selection.sessionIds,
      E2E_STABLE_SESSION_COLUMNS,
    );
    const projectIds = readFilteredRows(
      database,
      `SELECT DISTINCT project_id
       FROM local_runtime_sessions
       WHERE session_id IN (SELECT value FROM json_each(?))
         AND project_id > 0
       ORDER BY project_id`,
      selection.sessionIds,
    ).map((row) => readPositiveSafeInteger(row, 'project_id'));
    tables.local_runtime_projects = captureFilteredTable(
      database,
      'local_runtime_projects',
      'project_id',
      projectIds,
      E2E_STABLE_PROJECT_COLUMNS,
    );
    tables.local_runtime_session_fts_keys = captureFilteredTable(
      database,
      'local_runtime_session_fts_keys',
      'session_id',
      selection.sessionIds,
    );
    tables.local_runtime_sessions_fts = captureFilteredTable(
      database,
      'local_runtime_sessions_fts',
      'session_id',
      selection.sessionIds,
    );
    tables.local_runtime_turn_ingress = captureFilteredTable(
      database,
      'local_runtime_turn_ingress',
      'turn_id',
      selection.turnIds,
    );
    tables.local_runtime_turn_ingress_sequences = captureFilteredTable(
      database,
      'local_runtime_turn_ingress_sequences',
      'turn_id',
      selection.turnIds,
    );
    tables.local_runtime_turn_ingress_client_requests = captureFilteredTable(
      database,
      'local_runtime_turn_ingress_client_requests',
      'turn_id',
      selection.turnIds,
    );
    for (const tableName of [
      'local_runtime_queues',
      'local_runtime_queue_items',
      'local_runtime_session_locks',
    ]) {
      tables[tableName] = captureFilteredTable(
        database,
        tableName,
        'session_id',
        selection.sessionIds,
      );
    }
    return {
      digest: digestText(stableJson(tables)),
      tables,
    };
  } finally {
    if (ownsDatabase) database.close();
  }
}

function verifyIngressNormalizeSequences(before, database, ingressRows) {
  const mappings = database
    .prepare(
      `SELECT sequence, turn_id
       FROM local_runtime_turn_ingress_sequences
       ORDER BY sequence, turn_id`,
    )
    .all();
  if (mappings.length !== ingressRows.length) {
    throw new RehearsalInvariantError({
      code: 'M0008_SEQUENCE_BIJECTION_FAILED',
      table: 'local_runtime_turn_ingress_sequences',
      expected: ingressRows.length,
      actual: mappings.length,
    });
  }
  const mappingByTurn = new Map();
  const used = new Set();
  for (const mapping of mappings) {
    const turnId = readString(mapping, 'turn_id');
    const sequence = readPositiveSafeInteger(mapping, 'sequence');
    if (mappingByTurn.has(turnId) || used.has(sequence)) {
      throw new RehearsalInvariantError({
        code: 'M0008_SEQUENCE_BIJECTION_FAILED',
        table: 'local_runtime_turn_ingress_sequences',
      });
    }
    mappingByTurn.set(turnId, sequence);
    used.add(sequence);
  }
  for (const ingress of ingressRows) {
    const turnId = readString(ingress, 'turn_id');
    const sequence = readPositiveSafeInteger(ingress, 'accepted_sequence');
    if (
      mappingByTurn.get(turnId) !== sequence ||
      before.expectedSequences.get(turnId) !== sequence
    ) {
      throw new RehearsalInvariantError({
        code: 'M0008_SEQUENCE_BIJECTION_FAILED',
        table: 'local_runtime_turn_ingress',
        rowKey: redactedRowKey(turnId, before.salt),
      });
    }
  }
  const maximumSequence = Math.max(0, ...used);
  const allocator = readSqliteSequence(database, 'local_runtime_turn_ingress_sequences');
  if (
    allocator < before.historicalHighWater ||
    allocator < maximumSequence ||
    allocator >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RehearsalInvariantError({
      code: 'M0008_SEQUENCE_HIGH_WATER_INVALID',
      table: 'local_runtime_turn_ingress_sequences',
      expected: Math.max(before.historicalHighWater, maximumSequence),
      actual: allocator,
    });
  }
  database.exec('SAVEPOINT rehearsal_ingress_sequence_probe');
  try {
    const result = database
      .prepare(
        `INSERT INTO local_runtime_turn_ingress_sequences(turn_id)
         VALUES ('__mavis_rehearsal_sequence_probe__')`,
      )
      .run();
    const allocated = Number(result.lastInsertRowid);
    if (!Number.isSafeInteger(allocated) || allocated <= maximumSequence) {
      throw new RehearsalInvariantError({
        code: 'M0008_SEQUENCE_FUTURE_ALLOCATION_FAILED',
        table: 'local_runtime_turn_ingress_sequences',
      });
    }
  } finally {
    database.exec('ROLLBACK TO rehearsal_ingress_sequence_probe');
    database.exec('RELEASE rehearsal_ingress_sequence_probe');
  }
}

function verifyIngressNormalizeClientIdentities(before, database, ingressRows) {
  const mappings = database
    .prepare(
      `SELECT session_id, client_request_id, turn_id, ordinal
       FROM local_runtime_turn_ingress_client_requests
       ORDER BY turn_id, ordinal, client_request_id`,
    )
    .all()
    .map(readClientMapping);
  const ingressByTurn = new Map(
    ingressRows.map((row) => [
      readString(row, 'turn_id'),
      {
        sessionId: readString(row, 'session_id'),
        source: readString(row, 'source'),
        clientRequestId: readNullableString(row, 'client_request_id'),
      },
    ]),
  );
  const actualIdentities = new Map();
  const byTurn = groupBy(mappings, ({ turnId }) => turnId);
  for (const mapping of mappings) {
    const ingress = ingressByTurn.get(mapping.turnId);
    const identity = clientIdentity(mapping.sessionId, mapping.clientRequestId);
    if (!ingress || ingress.sessionId !== mapping.sessionId || actualIdentities.has(identity)) {
      throw new RehearsalInvariantError({
        code: 'M0008_CLIENT_IDENTITY_INVALID',
        table: 'local_runtime_turn_ingress_client_requests',
        rowKey: redactedRowKey(identity, before.salt),
      });
    }
    actualIdentities.set(identity, mapping);
  }
  if (actualIdentities.size !== before.durableIdentities.size) {
    throw new RehearsalInvariantError({
      code: 'M0008_CLIENT_IDENTITY_INVALID',
      table: 'local_runtime_turn_ingress_client_requests',
      expected: before.durableIdentities.size,
      actual: actualIdentities.size,
    });
  }
  for (const [identity, expected] of before.durableIdentities) {
    const actual = actualIdentities.get(identity);
    if (
      !actual ||
      actual.turnId !== expected.turnId ||
      actual.sessionId !== expected.sessionId ||
      actual.clientRequestId !== expected.clientRequestId
    ) {
      throw new RehearsalInvariantError({
        code: 'M0008_CLIENT_IDENTITY_INVALID',
        table: 'local_runtime_turn_ingress_client_requests',
        rowKey: redactedRowKey(identity, before.salt),
      });
    }
  }
  for (const [turnId, turnMappings] of byTurn) {
    const sorted = [...turnMappings].sort((left, right) => left.ordinal - right.ordinal);
    if (sorted.some((mapping, index) => mapping.ordinal !== index)) {
      throw new RehearsalInvariantError({
        code: 'M0008_CLIENT_IDENTITY_INVALID',
        table: 'local_runtime_turn_ingress_client_requests',
        rowKey: redactedRowKey(turnId, before.salt),
      });
    }
    const ingress = ingressByTurn.get(turnId);
    if (
      ingress?.clientRequestId &&
      (sorted[0]?.clientRequestId !== ingress.clientRequestId || sorted[0].ordinal !== 0)
    ) {
      throw new RehearsalInvariantError({
        code: 'M0008_CLIENT_IDENTITY_INVALID',
        table: 'local_runtime_turn_ingress_client_requests',
        rowKey: redactedRowKey(turnId, before.salt),
      });
    }
    if (ingress?.source !== 'dispatcher' && sorted.length > (ingress?.clientRequestId ? 1 : 0)) {
      throw new RehearsalInvariantError({
        code: 'M0008_CLIENT_IDENTITY_INVALID',
        table: 'local_runtime_turn_ingress_client_requests',
        rowKey: redactedRowKey(turnId, before.salt),
      });
    }
  }
}

function expectedInputDescriptor(row) {
  const input = parseJsonObject(readString(row, 'input_json'), 'M0008_INPUT_JSON_INVALID');
  if (Object.keys(input).length === 0) {
    const digest = readNullableString(row, 'input_digest');
    if (digest && /^sha256:[a-f0-9]{64}$/u.test(digest)) {
      return {
        digest,
        metadata: parseInputMetadata(
          readString(row, 'input_metadata_json'),
          'M0008_INPUT_DESCRIPTOR_MISMATCH',
        ),
      };
    }
  }
  if ('content' in input && typeof input.content !== 'string') {
    throw new RehearsalInvariantError({ code: 'M0008_INPUT_JSON_INVALID' });
  }
  if ('attachments' in input && !Array.isArray(input.attachments)) {
    throw new RehearsalInvariantError({ code: 'M0008_INPUT_JSON_INVALID' });
  }
  if ('queuedMessages' in input && !Array.isArray(input.queuedMessages)) {
    throw new RehearsalInvariantError({ code: 'M0008_INPUT_JSON_INVALID' });
  }
  return {
    digest: `sha256:${createHash('sha256').update(stableJson(input)).digest('hex')}`,
    metadata: {
      contentBytes: Buffer.byteLength(input.content ?? '', 'utf8'),
      attachmentCount: input.attachments?.length ?? 0,
      queuedMessageCount: input.queuedMessages?.length ?? 0,
      hasModelSelection: input.model !== undefined,
      hasChannelContext: input.channelContext !== undefined,
      hasQuotedMessage: input.quotedMessage !== undefined,
    },
  };
}

function parseInputMetadata(raw, code) {
  const metadata = parseJsonObject(raw, code);
  if (isCurrentInputMetadata(metadata) || isLegacyScrubbedInputMetadata(metadata)) return metadata;
  throw new RehearsalInvariantError({ code });
}

function isCurrentInputMetadata(metadata) {
  return (
    hasExactMetadataKeys(metadata, INPUT_METADATA_KEYS) &&
    ['contentBytes', 'attachmentCount', 'queuedMessageCount'].every(
      isNonNegativeSafeIntegerField(metadata),
    ) &&
    ['hasModelSelection', 'hasChannelContext', 'hasQuotedMessage'].every(isBooleanField(metadata))
  );
}

function isLegacyScrubbedInputMetadata(metadata) {
  return (
    hasExactMetadataKeys(metadata, LEGACY_SCRUBBED_INPUT_METADATA_KEYS) &&
    isNonNegativeSafeIntegerField(metadata)('attachmentCount') &&
    isBooleanField(metadata)('hasContent')
  );
}

function hasExactMetadataKeys(metadata, expectedKeys) {
  const keys = Object.keys(metadata).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isNonNegativeSafeIntegerField(metadata) {
  return (key) =>
    typeof metadata[key] === 'number' && Number.isSafeInteger(metadata[key]) && metadata[key] >= 0;
}

function isBooleanField(metadata) {
  return (key) => typeof metadata[key] === 'boolean';
}

function readClientMapping(row) {
  return {
    sessionId: readString(row, 'session_id'),
    clientRequestId: readString(row, 'client_request_id'),
    turnId: readString(row, 'turn_id'),
    ordinal: readSafeInteger(row, 'ordinal'),
  };
}

function clientIdentity(sessionId, clientRequestId) {
  return `${sessionId.length}:${sessionId}${clientRequestId}`;
}

function projectIdentityKey(kind, workspaceDir) {
  return kind === 'default' ? 'default' : `workspace:${workspaceDir}`;
}

function canonicalProjectWorkspaceForRehearsal(workspaceDir, parentRepoDir) {
  const parent = normalizeAbsolutePathForRehearsal(parentRepoDir);
  if (parent) return collapseWorktreePathForRehearsal(parent);
  const workspace = normalizeAbsolutePathForRehearsal(workspaceDir);
  return workspace ? collapseWorktreePathForRehearsal(workspace) : undefined;
}

function normalizeAbsolutePathForRehearsal(value) {
  const input = value?.trim();
  if (!input) return undefined;
  const parsed = splitAbsolutePathForRehearsal(input);
  if (!parsed) return undefined;
  const parts = [];
  for (const part of parsed.parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return joinAbsolutePathForRehearsal({ ...parsed, parts });
}

function splitAbsolutePathForRehearsal(value) {
  if (value.startsWith('\\\\')) {
    const parts = value.replaceAll('/', '\\').slice(2).split(/\\+/u).filter(Boolean);
    const server = parts.shift();
    const share = parts.shift();
    if (!server || !share) return undefined;
    return { root: `\\\\${server}\\${share}`, separator: '\\', parts };
  }
  if (/^[A-Za-z]:[\\/]/u.test(value)) {
    const windows = value.replaceAll('/', '\\');
    return {
      root: `${windows.slice(0, 2)}\\`,
      separator: '\\',
      parts: windows.slice(3).split(/\\+/u).filter(Boolean),
    };
  }
  if (!value.startsWith('/')) return undefined;
  return { root: '/', separator: '/', parts: value.slice(1).split(/\/+/u).filter(Boolean) };
}

function joinAbsolutePathForRehearsal(path) {
  if (path.root === '/') return path.parts.length > 0 ? `/${path.parts.join('/')}` : '/';
  if (path.root.endsWith('\\')) return `${path.root}${path.parts.join('\\')}`;
  return path.parts.length > 0
    ? `${path.root}${path.separator}${path.parts.join(path.separator)}`
    : path.root;
}

function collapseWorktreePathForRehearsal(value) {
  const parsed = splitAbsolutePathForRehearsal(value);
  if (!parsed) return value;
  const simple = parsed.parts.findIndex((part) => part === '.worktrees' || part === '.worktree');
  if (simple >= 0 && simple < parsed.parts.length - 1) {
    return joinAbsolutePathForRehearsal({
      ...parsed,
      parts: parsed.parts.slice(0, simple),
    });
  }
  const nestedTool = parsed.parts.findIndex(
    (part, index) =>
      part.startsWith('.') && part.length > 1 && parsed.parts[index + 1] === 'worktrees',
  );
  if (nestedTool >= 0 && nestedTool < parsed.parts.length - 2) {
    return joinAbsolutePathForRehearsal({
      ...parsed,
      parts: parsed.parts.slice(0, nestedTool),
    });
  }
  return value;
}

function readObjectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function frequency(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function groupBy(values, keyOf) {
  const result = new Map();
  for (const value of values) {
    const key = keyOf(value);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function assertIntegrity(database, code) {
  const quickCheck = database.pragma('quick_check');
  if (
    quickCheck.length !== 1 ||
    typeof quickCheck[0] !== 'object' ||
    quickCheck[0] === null ||
    quickCheck[0].quick_check !== 'ok'
  ) {
    throw new RehearsalInvariantError({ code });
  }
  const foreignKeyFailures = database.pragma('foreign_key_check');
  if (foreignKeyFailures.length > 0) {
    throw new RehearsalInvariantError({
      code: 'SOURCE_DATABASE_FOREIGN_KEY_FAILED',
      actual: foreignKeyFailures.length,
      expected: 0,
    });
  }
}

function assertMigrationMarker(database, version, code) {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM local_runtime_v2_schema_migrations
       WHERE version = ?`,
    )
    .get(version);
  const count =
    typeof row === 'object' && row !== null && 'count' in row && typeof row.count === 'number'
      ? row.count
      : -1;
  if (count !== 1) {
    throw new RehearsalInvariantError({ code, expected: 1, actual: count });
  }
}

function assertMigrationHistory(database, expectedVersions, code) {
  const actualVersions = database
    .prepare('SELECT version FROM local_runtime_v2_schema_migrations ORDER BY version')
    .all()
    .map((row) => readSafeInteger(row, 'version'));
  if (stableJson(actualVersions) !== stableJson(expectedVersions)) {
    throw new RehearsalInvariantError({
      code,
      expected: expectedVersions.join(','),
      actual: actualVersions.join(','),
    });
  }
}

function captureOrderedRows(database, { tableName, columns, whereSql, parameters = [] }) {
  const selectedColumns = columns.map(quoteIdentifier).join(', ');
  const orderBy = columns.map((column) => `${quoteIdentifier(column)} COLLATE BINARY`).join(', ');
  const whereClause = whereSql ? `WHERE ${whereSql}` : '';
  let statement;
  let includesRowId = true;
  try {
    statement = database.prepare(
      `SELECT rowid AS "__rehearsal_rowid__", ${selectedColumns}
       FROM ${quoteIdentifier(tableName)}
       ${whereClause}
       ORDER BY ${orderBy}, rowid`,
    );
  } catch (error) {
    if (!String(error).includes('no such column: rowid')) throw error;
    includesRowId = false;
    statement = database.prepare(
      `SELECT ${selectedColumns}
       FROM ${quoteIdentifier(tableName)}
       ${whereClause}
       ORDER BY ${orderBy}`,
    );
  }
  const rowsHash = createHash('sha256');
  const rowIdsHash = includesRowId ? createHash('sha256') : null;
  const rowAssociationsHash = includesRowId ? createHash('sha256') : null;
  let rowCount = 0;
  for (const row of statement.iterate(...parameters)) {
    const encodedCells = columns.map((column) => encodeCell(row[column]));
    updateLineHash(rowsHash, stableJson(encodedCells));
    if (includesRowId) {
      const encodedRowId = encodeCell(row.__rehearsal_rowid__);
      updateLineHash(rowIdsHash, stableJson(encodedRowId));
      updateLineHash(rowAssociationsHash, stableJson([encodedRowId, ...encodedCells]));
    }
    rowCount += 1;
  }
  return {
    rowCount,
    rowsDigest: finishLineHash(rowsHash),
    rowIdsDigest: rowIdsHash ? finishLineHash(rowIdsHash) : null,
    rowAssociationsDigest: rowAssociationsHash ? finishLineHash(rowAssociationsHash) : null,
  };
}

function captureTableProjection(database, tableName, columns) {
  const captured = captureOrderedRows(database, { tableName, columns });
  return {
    columns: [...columns],
    rowCount: captured.rowCount,
    rowsDigest: captured.rowsDigest,
    rowIdsDigest: captured.rowIdsDigest,
    rowAssociationsDigest: captured.rowAssociationsDigest,
  };
}

function captureFilteredTable(database, tableName, filterColumn, values, projectedColumns) {
  if (!tableExists(database, tableName)) {
    throw new RehearsalInvariantError({
      code: 'E2E_SELECTED_TABLE_MISSING',
      table: tableName,
    });
  }
  const availableColumns = readTableColumns(database, tableName);
  const columns = projectedColumns ? [...projectedColumns] : availableColumns;
  if (columns.some((column) => !availableColumns.includes(column))) {
    throw new RehearsalInvariantError({
      code: 'E2E_SELECTED_COLUMN_MISSING',
      table: tableName,
    });
  }
  if (values.length === 0) {
    return { columns, rowCount: 0, rowsDigest: digestLines([]) };
  }
  const captured = captureOrderedRows(database, {
    tableName,
    columns,
    whereSql: `${quoteIdentifier(filterColumn)} IN (SELECT value FROM json_each(?))`,
    parameters: [JSON.stringify(values)],
  });
  const selectedColumns =
    captured.rowAssociationsDigest === null ? columns : ['__rehearsal_rowid__', ...columns];
  return {
    columns: selectedColumns,
    rowCount: captured.rowCount,
    rowsDigest:
      captured.rowAssociationsDigest === null
        ? captured.rowsDigest
        : captured.rowAssociationsDigest,
  };
}

function readFilteredRows(database, sql, values) {
  if (values.length === 0) return [];
  return database.prepare(sql).all(JSON.stringify(values));
}

function verifyLogicalSnapshotUnchanged(expected, database, code) {
  const actual = captureLogicalSnapshot(database, Object.keys(expected.tables));
  for (const [tableName, expectedTable] of Object.entries(expected.tables)) {
    const actualTable = actual.tables[tableName];
    if (
      !actualTable ||
      actualTable.rowCount !== expectedTable.rowCount ||
      actualTable.rowsDigest !== expectedTable.rowsDigest ||
      actualTable.rowAssociationsDigest !== expectedTable.rowAssociationsDigest ||
      actualTable.schemaDigest !== expectedTable.schemaDigest
    ) {
      throw new RehearsalInvariantError({
        code,
        table: tableName,
        expected: expectedTable.rowCount,
        actual: actualTable?.rowCount ?? 0,
      });
    }
  }
}

function captureBusinessLogicalSnapshot(database) {
  return captureLogicalSnapshot(
    database,
    listTableNames(database).filter((tableName) => !NON_BUSINESS_SNAPSHOT_TABLES.has(tableName)),
  );
}

function captureSessionStorageLogicalSnapshot(database) {
  return captureLogicalSnapshot(
    database,
    listTableNames(database).filter(
      (tableName) =>
        SESSION_STORAGE_TABLES.has(tableName) ||
        tableName.startsWith('local_runtime_sessions_fts_'),
    ),
  );
}

function captureSessionMigrationCoreSnapshot(database) {
  return captureLogicalSnapshot(
    database,
    listTableNames(database).filter(
      (tableName) =>
        SESSION_MIGRATION_CORE_TABLES.has(tableName) ||
        tableName.startsWith('local_runtime_sessions_fts_'),
    ),
  );
}

function summarizeLogicalTables(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.tables).map(([tableName, table]) => [
      tableName,
      {
        columns: table.columns,
        rowCount: table.rowCount,
        rowsDigest: table.rowsDigest,
      },
    ]),
  );
}

function logicalDataDigest(snapshot) {
  return digestText(stableJson(summarizeLogicalTables(snapshot)));
}

function requireMigration(byVersion, version) {
  const migration = byVersion.get(version);
  if (!migration) {
    throw new RehearsalInvariantError({
      code: 'MIGRATION_CATALOG_INCOMPLETE',
      expected: version,
      actual: 'missing',
    });
  }
  return migration;
}

function readTableCount(database, tableName) {
  if (!tableExists(database, tableName)) return 0;
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get();
  return readSafeInteger(row, 'count');
}

async function countBackupFiles(dataDir) {
  const directory = join(dataDir, 'v2', 'sqlite', 'backups');
  try {
    const entries = await readdir(directory);
    return entries.filter(
      (entry) =>
        entry.startsWith('runtime-state-before-v2-migration-') && entry.endsWith('.sqlite'),
    ).length;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}

function listTableNames(database) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => readString(row, 'name'));
}

function readTableColumns(database, tableName) {
  return database
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all()
    .map((row) => readString(row, 'name'));
}

function readSqliteSequence(database, tableName) {
  if (!tableExists(database, 'sqlite_sequence')) return 0;
  const row = database.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(tableName);
  if (row === undefined) return 0;
  return readSafeInteger(row, 'seq');
}

function readSafeInteger(row, key) {
  if (
    typeof row !== 'object' ||
    row === null ||
    !(key in row) ||
    typeof row[key] !== 'number' ||
    !Number.isSafeInteger(row[key])
  ) {
    throw new TypeError(`Expected ${key} to be a safe integer`);
  }
  return row[key];
}

function readPositiveSafeInteger(row, key) {
  const value = readSafeInteger(row, key);
  if (value <= 0) throw new TypeError(`Expected ${key} to be a positive safe integer`);
  return value;
}

function readNullableSafeInteger(row, key) {
  if (typeof row !== 'object' || row === null || !(key in row)) {
    throw new TypeError(`Expected ${key} to be present`);
  }
  if (row[key] === null) return null;
  return readSafeInteger(row, key);
}

function readNullableString(row, key) {
  if (typeof row !== 'object' || row === null || !(key in row)) {
    throw new TypeError(`Expected ${key} to be present`);
  }
  if (row[key] === null) return null;
  return readString(row, key);
}

function assertExactValue(row, key, expected, code, salt) {
  if (row[key] !== expected) {
    throw new RehearsalInvariantError({
      code,
      table: 'local_runtime_sessions',
      rowKey: redactedRowKey(readString(row, 'session_id'), salt),
    });
  }
}

function assertEnum(row, key, values, code, salt) {
  if (typeof row[key] !== 'string' || !values.has(row[key])) {
    throw new RehearsalInvariantError({
      code,
      table: 'local_runtime_sessions',
      rowKey: redactedRowKey(readString(row, 'session_id'), salt),
    });
  }
}

function assertBit(row, key, code, salt) {
  if (row[key] !== 0 && row[key] !== 1) {
    throw new RehearsalInvariantError({
      code,
      rowKey:
        'session_id' in row && typeof row.session_id === 'string'
          ? redactedRowKey(row.session_id, salt)
          : undefined,
    });
  }
}

function assertNullableSafeInteger(row, key, code, salt) {
  const value = row[key];
  if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    throw new RehearsalInvariantError({
      code,
      rowKey:
        'session_id' in row && typeof row.session_id === 'string'
          ? redactedRowKey(row.session_id, salt)
          : undefined,
    });
  }
}

function parseJsonObject(raw, code) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new RehearsalInvariantError({ code, cause });
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new RehearsalInvariantError({ code });
  }
  return value;
}

function isValidSessionExtraData(extra) {
  const stringKeys = ['errorSource', 'errorDetail', 'errorProviderId', 'scratchpadPath'];
  if (
    stringKeys.some((key) => key in extra && typeof extra[key] !== 'string') ||
    ['effectiveModel', 'effectiveModelVariant'].some(
      (key) => key in extra && extra[key] !== null && typeof extra[key] !== 'string',
    ) ||
    !isValidModelThinking(extra.effectiveModelThinking) ||
    !['effectiveModelContextWindow', 'effectiveModelMaxOutputTokens'].every((key) =>
      isOptionalPositiveSafeInteger(extra[key]),
    ) ||
    ('appMode' in extra && extra.appMode !== 'coding' && extra.appMode !== 'work') ||
    ('origin' in extra && extra.origin !== 'user' && extra.origin !== 'root-repair') ||
    ('sessionOrigin' in extra &&
      !['local-runtime', 'legacy-opencode', 'unknown'].includes(extra.sessionOrigin)) ||
    ('sessionDataVersion' in extra &&
      (typeof extra.sessionDataVersion !== 'number' ||
        !Number.isSafeInteger(extra.sessionDataVersion)))
  ) {
    return false;
  }
  if (!('runLocation' in extra)) return true;
  const runLocation = readObjectValue(extra.runLocation);
  if (
    !runLocation ||
    Object.keys(runLocation).some((key) => !RUN_LOCATION_KEYS.has(key)) ||
    !RUN_LOCATION_MODES.has(runLocation.mode) ||
    typeof runLocation.resolvedDir !== 'string' ||
    runLocation.resolvedDir.length === 0 ||
    typeof runLocation.createdAt !== 'number' ||
    !Number.isSafeInteger(runLocation.createdAt)
  ) {
    return false;
  }
  return ['resolvedBranch', 'parentRepoDir'].every(
    (key) => !(key in runLocation) || typeof runLocation[key] === 'string',
  );
}

function isValidModelThinking(value) {
  if (value === undefined || value === null) return true;
  if (!readObjectValue(value)) return false;
  if (['effort', 'off_behavior'].some((key) => key in value && typeof value[key] !== 'string')) {
    return false;
  }
  if (!('budgets' in value) || value.budgets === null) return true;
  const budgets = readObjectValue(value.budgets);
  return Boolean(
    budgets &&
    ['minimal', 'low', 'medium', 'high'].every(
      (key) =>
        !(key in budgets) || typeof budgets[key] === 'string' || typeof budgets[key] === 'number',
    ),
  );
}

function isOptionalPositiveSafeInteger(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

function sessionSearchTerms(value) {
  if (!value) return '';
  return [...value.normalize('NFKC').trim().toLowerCase()]
    .map((character) => `c${character.codePointAt(0)?.toString(16) ?? ''}`)
    .join(' ');
}

async function fingerprintFile(filePath) {
  try {
    const before = await stat(filePath);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    const after = await stat(filePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new RehearsalInvariantError({
        code: 'SOURCE_FILE_CHANGED_DURING_FINGERPRINT',
      });
    }
    return {
      exists: true,
      size: after.size,
      mtimeMs: after.mtimeMs,
      digest: `sha256:${hash.digest('hex')}`,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

function encodeCell(value) {
  if (value === null) return ['null'];
  if (Buffer.isBuffer(value)) return ['blob', value.toString('base64')];
  if (typeof value === 'number') {
    return [
      Number.isInteger(value) ? 'integer' : 'real',
      Object.is(value, -0) ? '-0' : String(value),
    ];
  }
  if (typeof value === 'string') return ['text', value];
  throw new TypeError(`Unsupported SQLite cell type: ${typeof value}`);
}

function tableExists(database, tableName) {
  return Boolean(
    database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function readString(row, key) {
  if (typeof row !== 'object' || row === null || !(key in row) || typeof row[key] !== 'string') {
    throw new TypeError(`Expected ${key} to be a string`);
  }
  return row[key];
}

function digestLines(lines) {
  const hash = createHash('sha256');
  for (const line of lines) updateLineHash(hash, line);
  return finishLineHash(hash);
}

function updateLineHash(hash, line) {
  hash.update(line).update('\n');
}

function finishLineHash(hash) {
  return `sha256:${hash.digest('hex')}`;
}

function digestText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalizeSql(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

export function createRehearsalSalt() {
  return randomBytes(32).toString('hex');
}

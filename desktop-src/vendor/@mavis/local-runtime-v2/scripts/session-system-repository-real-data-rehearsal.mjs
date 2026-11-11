import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

const SOURCE_ENV = 'MAVIS_REHEARSAL_SOURCE_DATA_DIR';
const DATABASE_PATH = 'v2/sqlite/runtime-state.sqlite';
const FIXED_DATABASES = [DATABASE_PATH, 'sqlite.db'];
const BUSINESS_TABLES = [
  'local_runtime_sessions',
  'local_runtime_projects',
  'local_runtime_session_fts_keys',
  'local_runtime_sessions_fts',
  'local_runtime_message_rows',
  'local_runtime_session_assets',
  'local_runtime_queue_items',
  'local_runtime_token_usage',
  'local_runtime_pi_history_file_migrations',
  'local_runtime_legacy_migrations',
];

export class RehearsalInvariantError extends Error {
  constructor({ code, cause }) {
    super(`Session System repository rehearsal failed: invariant=${code}`, cause ? { cause } : {});
    this.name = 'RehearsalInvariantError';
    this.code = code;
  }
  toJSON() {
    return { name: this.name, code: this.code };
  }
}

export function resolveSessionSystemRehearsalSourceDataDir(env = process.env) {
  const value = env[SOURCE_ENV]?.trim();
  if (!value) throw new RehearsalInvariantError({ code: 'SOURCE_DATA_DIR_REQUIRED' });
  if (!isAbsolute(value)) {
    throw new RehearsalInvariantError({ code: 'SOURCE_DATA_DIR_NOT_ABSOLUTE' });
  }
  return value;
}

export function assertContainedSourcePath(sourceDataDir, candidate) {
  const root = resolve(sourceDataDir);
  const resolved = resolve(candidate);
  const segment = relative(root, resolved);
  if (segment.startsWith('..') || isAbsolute(segment)) {
    throw new RehearsalInvariantError({ code: 'SOURCE_PATH_ESCAPE' });
  }
  return segment;
}

export async function inventoryAllowlistedArtifacts({ sourceDataDir, nativeCandidates }) {
  requireAbsolute(sourceDataDir);
  const relativePaths = new Set();
  for (const database of FIXED_DATABASES) addTriplet(relativePaths, database);
  for (const candidate of candidateInputs(sourceDataDir, nativeCandidates)) {
    const segment = assertContainedSourcePath(sourceDataDir, candidate.dbPath);
    addTriplet(relativePaths, segment);
  }
  await inventoryFinalSessionArtifacts(sourceDataDir, relativePaths);
  await inventoryLegacyDraftArtifacts(sourceDataDir, relativePaths);
  return Promise.all(
    [...relativePaths].sort().map(async (relativePath) => {
      const sourcePath = join(sourceDataDir, relativePath);
      const metadata = await fingerprintFile(sourcePath);
      return { relativePath, sourcePath, ...metadata };
    }),
  );
}

export async function fingerprintAllowlistedArtifacts(options) {
  const artifacts = await inventoryAllowlistedArtifacts(options);
  return {
    artifactCount: artifacts.filter(({ exists }) => exists).length,
    digest: digest(
      stableJson(
        artifacts.map(({ relativePath, exists, size, mtimeMs, sha256 }) => ({
          relativePath,
          exists,
          ...(exists ? { size, mtimeMs, sha256 } : {}),
        })),
      ),
    ),
  };
}

export async function cloneAllowlistedArtifacts(options) {
  const before = await fingerprintAllowlistedArtifacts(options);
  const artifacts = await inventoryAllowlistedArtifacts(options);
  const root = await mkdtemp(join(tmpdir(), 'mavis-session-system-rehearsal-'));
  const dataDir = join(root, 'data');
  try {
    for (const artifact of artifacts) {
      if (!artifact.exists) continue;
      const targetPath = join(dataDir, artifact.relativePath);
      await mkdir(resolve(targetPath, '..'), { recursive: true });
      await copyFile(artifact.sourcePath, targetPath);
    }
    await consolidateExternalSnapshots(
      dataDir,
      options.sourceDataDir,
      candidateInputs(options.sourceDataDir, options.nativeCandidates),
    );
    const after = await fingerprintAllowlistedArtifacts(options);
    assertEqual(before, after, 'SOURCE_ARTIFACT_CHANGED_DURING_CLONE');
    return {
      dataDir,
      artifacts,
      sourceFingerprint: before,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    if (cause instanceof RehearsalInvariantError) throw cause;
    throw new RehearsalInvariantError({ code: 'SOURCE_ARTIFACT_CLONE_FAILED', cause });
  }
}

async function consolidateExternalSnapshots(dataDir, sourceDataDir, candidates) {
  const databaseSegments = new Set([
    'sqlite.db',
    ...candidates.map(({ dbPath }) => assertContainedSourcePath(sourceDataDir, dbPath)),
  ]);
  for (const segment of databaseSegments) {
    const databasePath = join(dataDir, segment);
    if (!(await fingerprintFile(databasePath)).exists) continue;
    const consolidatedPath = `${databasePath}.rehearsal-snapshot`;
    const database = new BetterSqlite3(databasePath, { fileMustExist: true });
    try {
      await database.backup(consolidatedPath);
    } finally {
      database.close();
    }
    const consolidated = new BetterSqlite3(consolidatedPath, { fileMustExist: true });
    try {
      consolidated.pragma('journal_mode = DELETE');
    } finally {
      consolidated.close();
    }
    await rename(consolidatedPath, databasePath);
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
  }
}

export async function runSessionSystemRepositoryRealDataRehearsal({
  sourceDataDir,
  production,
  nativeCandidates,
}) {
  requireAbsolute(sourceDataDir);
  const sourceCandidates = candidateInputs(sourceDataDir, nativeCandidates);
  const sourceBefore = await fingerprintAllowlistedArtifacts({
    sourceDataDir,
    nativeCandidates: sourceCandidates,
  });
  const clone = await cloneAllowlistedArtifacts({
    sourceDataDir,
    nativeCandidates: sourceCandidates,
  });
  let client = new production.DatabaseClient({ dataDir: clone.dataDir });
  try {
    const firstInitialization = await invariantStep('PRODUCTION_INITIALIZE_FAILED', () =>
      production.initializeDatabase({
        database: client,
        dataDir: clone.dataDir,
      }),
    );
    assertIntegrity(client.rawDb);
    const secondInitialization = await invariantStep('PRODUCTION_REINITIALIZE_FAILED', () =>
      production.initializeDatabase({
        database: client,
        dataDir: clone.dataDir,
      }),
    );
    assertTrue(
      secondInitialization.pendingVersions.length === 0 && !secondInitialization.backup.created,
      'PRODUCTION_INITIALIZE_NOT_IDEMPOTENT',
    );

    const beforeReads = logicalDigest(client.rawDb);
    const readEvidence = await invariantStep('REAL_DATA_REPOSITORY_READ_FAILED', () =>
      exerciseReads({
        db: client.db,
        rawDb: client.rawDb,
        repositories: production.repositories,
        dataDir: clone.dataDir,
        nativeCandidates: cloneCandidates(clone.dataDir, sourceDataDir, sourceCandidates),
        artifacts: clone.artifacts,
      }),
    );
    assertEqual(beforeReads, logicalDigest(client.rawDb), 'REPOSITORY_READ_CHANGED_DATABASE');
    const beforeWrites = logicalDigest(client.rawDb);
    const probe = await invariantStep('SYNTHETIC_WRITE_PROBE_FAILED', () =>
      exerciseSyntheticWrites({
        db: client.db,
        repositories: production.repositories,
        dataDir: clone.dataDir,
      }),
    );
    client.close();
    client = new production.DatabaseClient({ dataDir: clone.dataDir });
    await invariantStep('PRODUCTION_REOPEN_FAILED', () =>
      production.initializeDatabase({ database: client, dataDir: clone.dataDir }),
    );
    assertIntegrity(client.rawDb);
    const reopened = production.repositories.createSessionRepository({ db: client.db });
    assertTrue(await reopened.has(probe.sessionId), 'SYNTHETIC_REOPEN_MISSING');
    await cleanupSynthetic({
      db: client.db,
      rawDb: client.rawDb,
      repositories: production.repositories,
      probe,
    });
    assertEqual(beforeWrites, logicalDigest(client.rawDb), 'SYNTHETIC_CLEANUP_NOT_CONVERGED');

    return {
      success: true,
      invariants: [
        invariant('SOURCE_ALLOWLIST_STABLE', true),
        invariant('CLONE_INTEGRITY_OK', true),
        invariant('INITIALIZE_IDEMPOTENT', true),
        invariant('REPOSITORY_READ_SEMANTICALLY_STABLE', true),
        invariant('SESSION_PAGINATION_EXACT', readEvidence.sessionPaginationExact),
        invariant('FTS_KEY_DOCUMENT_PARITY', readEvidence.ftsParity),
        invariant('PROJECT_AGGREGATE_READABLE', readEvidence.projectsReadable),
        invariant('MESSAGE_QUEUE_USAGE_HISTORY_READABLE', readEvidence.domainReads),
        invariant('CANONICAL_HISTORY_CONTRACT', readEvidence.historyReadable),
        invariant('LEGACY_SOURCE_FULL_CONTRACT', readEvidence.legacyReadable),
        invariant('SYNTHETIC_STATE_MACHINES', probe.stateMachines),
        invariant('TRANSACTION_ROLLBACK', probe.rollback),
        invariant('PUBLICATION_WINNER_REVISION', probe.publicationWinner),
        invariant('CLOSE_REOPEN_PERSISTENCE', true),
        invariant('SYNTHETIC_CLEANUP_CONVERGED', true),
      ],
      counts: {
        sourceArtifactCount: sourceBefore.artifactCount,
        sessionCount: readEvidence.sessionCount,
        projectCount: readEvidence.projectCount,
        messageCount: readEvidence.messageCount,
        queueCount: readEvidence.queueCount,
        usageCount: readEvidence.usageCount,
        checkpointCount: readEvidence.checkpointCount,
        legacyAuditCount: readEvidence.legacyAuditCount,
        legacySessionCount: readEvidence.legacySessionCount,
        canonicalArtifactCount: readEvidence.canonicalArtifactCount,
      },
      versions: { migrationsApplied: [...firstInitialization.pendingVersions], report: 1 },
      digests: {
        sourceArtifacts: sourceBefore.digest,
        repositoryRead: readEvidence.digest,
        cloneDatabase: logicalDigest(client.rawDb),
      },
    };
  } finally {
    client.close();
    await clone.cleanup();
    const sourceAfter = await fingerprintAllowlistedArtifacts({
      sourceDataDir,
      nativeCandidates: sourceCandidates,
    });
    assertEqual(sourceBefore, sourceAfter, 'SOURCE_ARTIFACT_CHANGED_DURING_REHEARSAL');
  }
}

async function exerciseReads({ db, rawDb, repositories, dataDir, nativeCandidates, artifacts }) {
  const sessions = repositories.createSessionRepository({ db });
  const projects = repositories.createProjectRepository({ db });
  const messages = repositories.createMessageRepository({ db });
  const assets = repositories.createSessionAssetRepository({ db });
  const queue = repositories.createQueueRepository({ db });
  const usage = repositories.createSessionUsageRepository({ db });
  const history = repositories.createHistoryPersistenceRepository({ db });
  const audits = repositories.createLegacySessionMigrationRepository({ db });
  const sessionRows = await invariantStep('REAL_SESSION_READ_FAILED', () =>
    readAllPages((cursor) => sessions.listPage({ cursor, limit: 7 })),
  );
  const repeatedSessionRows = await invariantStep('REAL_SESSION_REREAD_FAILED', () =>
    readAllPages((cursor) => sessions.listPage({ cursor, limit: 7 })),
  );
  const sqlSessionCount = tableCount(rawDb, 'local_runtime_sessions', 'columnar_version = 3');
  const ids = sessionRows.map(({ sessionId }) => sessionId);
  const sqlIds = rawDb
    .prepare(
      'SELECT session_id FROM local_runtime_sessions WHERE columnar_version = 3 ORDER BY session_id',
    )
    .all()
    .map(({ session_id: sessionId }) => sessionId);
  const messageRows = [];
  let messageSemanticsValid = true;
  for (const sessionId of ids) {
    const rows = await invariantStep('REAL_MESSAGE_READ_FAILED', () =>
      readAllPages((before) => messages.list(sessionId, { before, limit: 11 })),
    );
    messageRows.push(...rows);
    const anchor = rows[0]?.msg_id;
    if (anchor) {
      const replay = await invariantStep('REAL_MESSAGE_REPLAY_FAILED', () =>
        messages.listAfter(sessionId, anchor),
      );
      messageSemanticsValid &&= replay.status === 'ok' && replay.messages.length <= rows.length;
    }
    for (const row of rows) {
      if (typeof row.turnId === 'string') {
        await invariantStep('REAL_MESSAGE_SOURCE_FAILED', () =>
          messages.resolveTurnSource(sessionId, row.turnId),
        );
      }
    }
    await invariantStep('REAL_ASSET_STATE_READ_FAILED', () => assets.getIndexState(sessionId));
    await invariantStep('REAL_HISTORY_CHECKPOINT_READ_FAILED', () =>
      history.getCheckpoint(sessionId),
    );
  }
  const projectRows = await invariantStep('REAL_PROJECT_READ_FAILED', () =>
    readAllPages((cursor) => projects.listPage({ cursor, limit: 7 })),
  );
  // Recomputes each Project's sessionCount independently and compares it with
  // the repository read. Mirrors `projectTaskRootPredicate`: parentless
  // conversation-tree roots count whether they are branch roots or ordinary
  // Agent roots (session_type IN ('branch','root')); peek/cron/channel kinds
  // and hidden/archived rows stay out, matching the session_count trigger.
  const projectAggregatesValid = projectRows.every(
    ({ projectId, sessionCount, latestActivityAtMs }) => {
      const row = rawDb
        .prepare(
          `SELECT
             COUNT(*) FILTER (WHERE session_type IN ('branch', 'root') AND parent_session_id IS NULL) AS count,
             COALESCE(MAX(updated_at_ms), 0) AS latest
           FROM local_runtime_sessions
           WHERE project_id = ?
             AND columnar_version = 3
             AND archived = 0
             AND visibility <> 'hidden'
             AND session_kind NOT IN ('peek', 'channel', 'cron')`,
        )
        .get(projectId);
      return Number(row.count) === sessionCount && Number(row.latest) === latestActivityAtMs;
    },
  );
  const pendingIds = await invariantStep('REAL_QUEUE_READ_FAILED', () =>
    queue.listPendingSessionIds(),
  );
  const queueRows = (
    await Promise.all(pendingIds.map(async (id) => (await queue.list(id)).value))
  ).flat();
  const usageRows = await invariantStep('REAL_USAGE_READ_FAILED', async () =>
    (await Promise.all(ids.map((id) => usage.listBySession(id)))).flat(),
  );
  const globalUsage = await invariantStep('REAL_USAGE_SUMMARY_FAILED', () =>
    usage.summarizeGlobal(),
  );
  await invariantStep('REAL_USAGE_GROUP_FAILED', () =>
    Promise.all(['agent', 'session', 'model', 'day'].map((group) => usage.summarizeGroupBy(group))),
  );
  const checkpointRows = await invariantStep('REAL_HISTORY_CHECKPOINT_LIST_FAILED', async () =>
    (await Promise.all(ids.map((id) => history.getCheckpoint(id)))).filter(Boolean),
  );
  const auditRows = await invariantStep('REAL_LEGACY_AUDIT_READ_FAILED', () => audits.listAll());
  const fileAdapter = repositories.createCanonicalHistoryFileAdapter();
  const canonical = artifacts.filter(
    ({ exists, relativePath }) => exists && relativePath.endsWith('/ledger.jsonl'),
  );
  const historyEvidence = [];
  for (const artifact of canonical) {
    const clonePath = join(dataDir, artifact.relativePath);
    const active = await invariantStep('REAL_CANONICAL_HISTORY_READ_FAILED', () =>
      fileAdapter.readActive(clonePath),
    );
    try {
      const strict = await fileAdapter.readStrict(clonePath);
      historyEvidence.push({ active: active.length, strict: strict.length });
    } catch {
      historyEvidence.push({ active: active.length, strictRejected: true });
    }
  }
  const externalBefore = await fingerprintExternalArtifacts(dataDir, nativeCandidates);
  const legacy = repositories.createLegacyOpencodeReadonlySource({
    sourceDataDir: dataDir,
    nativeCandidates,
  });
  const absentLegacySession = legacySessionProbe();
  await invariantStep('REAL_LEGACY_ABSENT_CONTRACT_FAILED', async () => {
    await legacy.getSession(absentLegacySession.sessionId);
    await legacy.listMessages(absentLegacySession.sessionId, 1);
    await legacy.listMessagePage(absentLegacySession.sessionId, { limit: 1 });
    await legacy.countMessages(absentLegacySession.sessionId);
    await legacy.scanMessages(absentLegacySession.sessionId);
    await legacy.listNativeMessages(absentLegacySession);
    await legacy.getAgent(absentLegacySession.agentName);
  });
  const legacySessions = await invariantStep('REAL_LEGACY_SOURCE_READ_FAILED', () =>
    legacy.listSessions(),
  );
  let legacyMessageCount = 0;
  const legacyScanEvidence = [];
  for (const session of legacySessions) {
    await invariantStep('REAL_LEGACY_SESSION_CONTRACT_FAILED', () =>
      legacy.getSession(session.sessionId),
    );
    const expected = await invariantStep('REAL_LEGACY_MESSAGE_COUNT_FAILED', () =>
      legacy.countMessages(session.sessionId),
    );
    const paged = await invariantStep('REAL_LEGACY_MESSAGE_PAGE_FAILED', () =>
      readLegacyPages(legacy, session.sessionId),
    );
    const listed = await invariantStep('REAL_LEGACY_MESSAGE_LIST_FAILED', () =>
      legacy.listMessages(session.sessionId),
    );
    const scan = await invariantStep('REAL_LEGACY_MESSAGE_SCAN_FAILED', () =>
      legacy.scanMessages(session.sessionId),
    );
    await invariantStep('REAL_LEGACY_NATIVE_READ_FAILED', () => legacy.listNativeMessages(session));
    legacyMessageCount += expected;
    assertTrue(
      paged.length === expected &&
        listed.length === expected &&
        scan.sourceCount === expected &&
        stableJson(paged) === stableJson(listed),
      'LEGACY_PAGE_COUNT_INVALID',
    );
    legacyScanEvidence.push({
      count: expected,
      rawChecksum: scan.rawChecksum,
      parsedChecksum: scan.parsedChecksum,
    });
    await invariantStep('REAL_LEGACY_AGENT_READ_FAILED', () => legacy.getAgent(session.agentName));
  }
  const manifest = await invariantStep('REAL_LEGACY_MANIFEST_FAILED', () =>
    legacy.getSourceManifest(),
  );
  const manifestMessageCount = manifest.tableCounts?.session_messages;
  assertTrue(
    manifestMessageCount === undefined || manifestMessageCount >= legacyMessageCount,
    'LEGACY_MANIFEST_COUNT_INVALID',
  );
  const externalAfter = await fingerprintExternalArtifacts(dataDir, nativeCandidates);
  const legacyReader = repositories.createLegacyHistorySourceReader({
    db,
    readLedgerSnapshot: async (sessionId) => {
      if (sessionId === 'rehearsal-empty') return [];
      if (sessionId === 'rehearsal-present') return [envelope('msg-rehearsal-present')];
      return undefined;
    },
  });
  const optionalHistory = [
    await legacyReader.readLedgerSnapshot('rehearsal-absent'),
    await legacyReader.readLedgerSnapshot('rehearsal-empty'),
    await legacyReader.readLedgerSnapshot('rehearsal-present'),
  ];
  for (const sessionId of ids) {
    await invariantStep('REAL_LEGACY_HISTORY_ROWS_FAILED', () =>
      legacyReader.readSqliteRows(sessionId),
    );
    await invariantStep('REAL_LEGACY_HISTORY_BLOB_FAILED', () =>
      legacyReader.readSqliteBlob(sessionId),
    );
  }
  const ftsKeys = tableColumnValues(rawDb, 'local_runtime_session_fts_keys', 'session_id');
  const ftsDocuments = tableColumnValues(rawDb, 'local_runtime_sessions_fts', 'session_id');
  assertTrue(Boolean(manifest.opencodeNative), 'LEGACY_MANIFEST_CONTRACT_INVALID');
  assertEqual(externalBefore, externalAfter, 'LEGACY_EXTERNAL_SOURCE_CHANGED');
  assertTrue(
    optionalHistory[0] === undefined &&
      optionalHistory[1]?.length === 0 &&
      optionalHistory[2]?.length === 1,
    'LEGACY_OPTIONAL_SOURCE_SEMANTICS_INVALID',
  );
  return {
    sessionCount: sessionRows.length,
    projectCount: projectRows.length,
    messageCount: messageRows.length,
    queueCount: queueRows.length,
    usageCount: usageRows.length,
    checkpointCount: tableCount(rawDb, 'local_runtime_pi_history_file_migrations'),
    legacyAuditCount: auditRows.length,
    legacySessionCount: legacySessions.length,
    canonicalArtifactCount: canonical.length,
    sessionPaginationExact:
      sessionRows.length === sqlSessionCount &&
      new Set(ids).size === ids.length &&
      stableJson([...ids].sort()) === stableJson(sqlIds) &&
      stableJson(sessionRows) === stableJson(repeatedSessionRows),
    ftsParity: stableJson(ftsKeys) === stableJson(ftsDocuments),
    projectsReadable:
      projectAggregatesValid &&
      projectRows.every(({ workspaceDir }) => workspaceDir === null || isAbsolute(workspaceDir)),
    domainReads:
      checkpointRows.length <= ids.length &&
      globalUsage.turns === usageRows.length &&
      messageSemanticsValid,
    historyReadable: historyEvidence.length === canonical.length,
    legacyReadable: Number.isSafeInteger(legacyMessageCount),
    digest: digest(
      stableJson({
        sessions: sessionRows,
        projects: projectRows,
        messages: messageRows,
        queueRows,
        usageRows,
        auditRows,
        historyEvidence,
        legacyMessageCount,
        legacyScanEvidence,
      }),
    ),
  };
}

async function exerciseSyntheticWrites({ db, repositories, dataDir }) {
  const suffix = createHash('sha256').update(dataDir).digest('hex').slice(0, 16);
  const sessionId = `rehearsal-session-${suffix}`;
  const sessions = repositories.createSessionRepository({ db, nowMs: () => 2_000_000_000_000 });
  const projects = repositories.createProjectRepository({ db });
  const messages = repositories.createMessageRepository({ db, nowMs: () => 2_000_000_000_001 });
  const assets = repositories.createSessionAssetRepository({ db });
  let idSequence = 0;
  const queue = repositories.createQueueRepository({
    db,
    nowMs: () => 2_000_000_000_002,
    makeId: (prefix) => `rehearsal-${prefix}-${suffix}-${String((idSequence += 1))}`,
    claimOwnerId: `rehearsal-owner-${suffix}`,
    isClaimOwnerAlive: () => false,
  });
  const usage = repositories.createSessionUsageRepository({ db });
  const history = repositories.createHistoryPersistenceRepository({ db });
  const audits = repositories.createLegacySessionMigrationRepository({ db });
  const workspaceDir = `/rehearsal/workspace-${suffix}`;
  const existingProject = await projects.getByWorkspaceDir(workspaceDir);
  const probeProject = await projects.ensureByWorkspaceDir(workspaceDir, 2_000_000_000_000);
  assertTrue(Boolean(probeProject), 'SYNTHETIC_PROJECT_FAILED');
  await projects.setPinned(probeProject.projectId, true, 2_000_000_000_000);
  await projects.setHidden(probeProject.projectId, false, 2_000_000_000_000);
  await projects.putOrder([probeProject.projectId], 2_000_000_000_000);
  await projects.touchRecent(probeProject.projectId, 2_000_000_000_000);
  await sessions.create({
    sessionId,
    agentName: 'rehearsal-agent',
    workspaceDir,
    runtime: 'pi-agent',
    agentDefinition: {
      definition: {
        definitionVersion: 2,
        exactOwnerName: 'rehearsal-agent',
        systemPrompt: 'rehearsal prompt',
        capabilities: { tools: [], mcpServers: [], skills: [], extensionSkills: [] },
        model: { providerId: 'rehearsal-provider', modelId: 'rehearsal-model' },
        project: { workspaceDir, isDefaultWorkspace: false },
      },
    },
    sessionType: 'branch',
    title: 'rehearsal-title',
  });
  assertTrue(
    (await sessions.searchPage({ keyword: 'rehearsal-title' })).sessions.length === 1,
    'SYNTHETIC_FTS_FAILED',
  );
  await sessions.update(sessionId, { title: 'rehearsal-title-updated', status: 'started' });
  await sessions.touch(sessionId, 2_000_000_000_001);
  await messages.upsert({
    sessionId,
    turnId: `rehearsal-turn-${suffix}`,
    source: 'api',
    message: {
      msg_id: `rehearsal-message-${suffix}`,
      role: 'assistant',
      timestamp: 2_000_000_000_001,
      msg_content:
        '<deliver-assets><item><path>/rehearsal/result.txt</path><name>result</name></item></deliver-assets>',
    },
  });
  await assets.rebuild(sessionId, 2_000_000_000_001);
  assertTrue((await assets.listPage({ sessionId })).assets.length === 1, 'SYNTHETIC_ASSET_FAILED');
  const queued = (
    await queue.enqueue({
      session: { sessionId, agentName: 'rehearsal-agent' },
      message: { content: 'rehearsal-message', attachments: [] },
      source: 'api',
    })
  ).value;
  assertTrue(Boolean(queued), 'SYNTHETIC_QUEUE_ENQUEUE_FAILED');
  const second = (
    await queue.enqueue({
      session: { sessionId, agentName: 'rehearsal-agent' },
      message: { content: 'rehearsal-second', attachments: [] },
      source: 'api',
    })
  ).value;
  assertTrue(Boolean(second), 'SYNTHETIC_QUEUE_SECOND_ENQUEUE_FAILED');
  await queue.updateQueued({
    sessionId,
    itemId: second.item.itemId,
    message: { content: 'rehearsal-second-updated', attachments: [] },
  });
  await queue.reorder({ sessionId, itemIds: [second.item.itemId, queued.item.itemId] });
  await queue.cancel(sessionId, second.item.itemId);
  await queue.promoteQueuedSource(sessionId, queued.item.itemId, 'task');
  const claim = (await queue.claimNext({ sessionId })).value;
  assertTrue(Boolean(claim), 'SYNTHETIC_QUEUE_CLAIM_FAILED');
  await queue.releaseClaim(sessionId, claim.claimId);
  const rollbackClaim = (await queue.claimNext({ sessionId })).value;
  let rollback = false;
  try {
    await queue.acknowledgeClaim(sessionId, rollbackClaim.claimId, 'rehearsal-turn', {
      isAcceptedInTransaction: () => true,
      markAcknowledgedInTransaction: () => {
        throw new Error('injected');
      },
    });
  } catch {
    rollback = (await queue.get(sessionId, queued.item.itemId)).value?.status === 'claimed';
  }
  await queue.releaseClaim(sessionId, rollbackClaim.claimId);
  const accepted = (await queue.claimNext({ sessionId })).value;
  await queue.acknowledgeClaim(sessionId, accepted.claimId, 'rehearsal-turn', {
    isAcceptedInTransaction: () => true,
    markAcknowledgedInTransaction: () => undefined,
  });
  const rejectedItem = (
    await queue.enqueue({
      session: { sessionId, agentName: 'rehearsal-agent' },
      message: { content: 'rehearsal-reject', attachments: [] },
      source: 'task',
    })
  ).value;
  const rejectedClaim = (await queue.claimNext({ sessionId })).value;
  await queue.rejectClaim(sessionId, rejectedClaim.claimId, 'invalid-session');
  const recoverItem = (
    await queue.enqueue({
      session: { sessionId, agentName: 'rehearsal-agent' },
      message: { content: 'rehearsal-recover', attachments: [] },
      source: 'task',
    })
  ).value;
  await queue.claimNext({ sessionId });
  const recovered = (
    await queue.recoverClaims(sessionId, {
      isAcceptedInTransaction: () => false,
      markAcknowledgedInTransaction: () => undefined,
    })
  ).value;
  await queue.claimNext({ sessionId });
  const recoveredAccepted = (
    await queue.recoverClaims(sessionId, {
      isAcceptedInTransaction: () => true,
      markAcknowledgedInTransaction: () => undefined,
    })
  ).value;
  const composer = (
    await queue.enqueue({
      session: { sessionId, agentName: 'rehearsal-agent' },
      message: { content: 'rehearsal-composer', attachments: [] },
      source: 'api',
    })
  ).value;
  const drained = (await queue.drainComposerInjectable(sessionId)).value;
  assertTrue(
    Boolean(rejectedItem) &&
      Boolean(recoverItem) &&
      Boolean(composer) &&
      recovered.released.length === 1 &&
      recoveredAccepted.acknowledged.length === 1 &&
      drained.length === 1,
    'SYNTHETIC_QUEUE_TRANSITIONS_FAILED',
  );
  await queue.replaceSession(sessionId, [drained[0]]);
  await queue.deleteSession(sessionId);
  await usage.append({
    sessionId,
    agentName: 'rehearsal-agent',
    frameworkType: 'pi-agent',
    turnId: null,
    model: null,
    ts: 2_000_000_000_003,
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    raw: null,
  });
  await audits.upsert({
    legacySessionId: `rehearsal-legacy-${suffix}`,
    localSessionId: sessionId,
    sourceRuntime: 'opencode',
    status: 'migrated',
    migratedAtMs: 2_000_000_000_004,
  });
  const adapter = repositories.createCanonicalHistoryFileAdapter();
  const target = join(dataDir, 'v2', 'rehearsal-probe', 'active.jsonl');
  const left = envelope(`msg-rehearsal-history-left-${suffix}`);
  const right = envelope(`msg-rehearsal-history-right-${suffix}`);
  const publications = await Promise.all([
    adapter.publishInitial(target, [left]),
    adapter.publishInitial(target, [right]),
  ]);
  const winner = publications[0].records;
  const publicationWinner =
    publications[0].records === publications[1].records ||
    stableJson(publications[0].records) === stableJson(publications[1].records);
  const snapshot = join(dataDir, 'v2', 'rehearsal-probe', 'snapshot.jsonl');
  const firstSnapshot = await adapter.publishSnapshot(snapshot, winner);
  const repeatedSnapshot = await adapter.publishSnapshot(snapshot, winner);
  let conflictingSnapshotRejected = false;
  try {
    await adapter.publishSnapshot(snapshot, [envelope(`msg-rehearsal-conflict-${suffix}`)]);
  } catch {
    conflictingSnapshotRejected = true;
  }
  await history.upsertCheckpoint({
    sessionId,
    migratedAtMs: 2_000_000_000_005,
    source: 'empty',
    messageCount: winner.length,
    targetRevision: repositories.canonicalHistoryRevision(winner),
  });
  return {
    sessionId,
    auditId: `rehearsal-legacy-${suffix}`,
    ...(existingProject ? {} : { createdProjectId: probeProject.projectId }),
    stateMachines: (await queue.list(sessionId)).value.length === 0,
    rollback,
    publicationWinner:
      publicationWinner &&
      firstSnapshot === 'published' &&
      repeatedSnapshot === 'already-exists' &&
      conflictingSnapshotRejected,
  };
}

async function cleanupSynthetic({ repositories, probe, db, rawDb }) {
  await repositories.createMessageRepository({ db }).deleteSessionData(probe.sessionId);
  await repositories.createHistoryPersistenceRepository({ db }).deleteSessionData(probe.sessionId);
  await repositories.createQueueRepository({ db }).deleteSession(probe.sessionId);
  await repositories.createSessionUsageRepository({ db }).deleteSession(probe.sessionId);
  await repositories.createSessionRepository({ db }).delete(probe.sessionId);
  rawDb
    .prepare(
      'DELETE FROM local_runtime_legacy_migrations WHERE legacy_session_id = ? AND local_session_id = ?',
    )
    .run(probe.auditId, probe.sessionId);
  if (probe.createdProjectId !== undefined) {
    rawDb
      .prepare('DELETE FROM local_runtime_projects WHERE project_id = ? AND session_count = 0')
      .run(probe.createdProjectId);
  }
}

async function inventoryFinalSessionArtifacts(root, paths) {
  const sessionsRoot = join(root, 'v2', 'sessions');
  for (const year of await directories(sessionsRoot))
    for (const month of await directories(join(sessionsRoot, year)))
      for (const day of await directories(join(sessionsRoot, year, month)))
        for (const session of await directories(join(sessionsRoot, year, month, day)))
          for (const file of ['manifest.json', 'ledger.jsonl', 'snapshot.json'])
            paths.add(join('v2', 'sessions', year, month, day, session, file));
}

async function inventoryLegacyDraftArtifacts(root, paths) {
  await addAllowedFiles(
    root,
    join('v2', 'chats', 'ledgers'),
    paths,
    (name) => name.endsWith('.jsonl') && !name.endsWith('.display.jsonl'),
  );
  await addAllowedFiles(root, join('v2', 'chats', 'snapshots'), paths, (name) =>
    ['latest.json', 'snapshot.json'].includes(name),
  );
}

async function addAllowedFiles(root, segment, paths, accepted) {
  const directory = join(root, segment);
  for (const entry of await entries(directory)) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) await addAllowedFiles(root, relative(root, child), paths, accepted);
    else if (entry.isFile() && accepted(entry.name)) paths.add(relative(root, child));
  }
}

async function readAllPages(read) {
  const rows = [];
  let cursor;
  for (;;) {
    const page = await read(cursor);
    const values = page.sessions ?? page.projects ?? page.messages ?? [];
    rows.push(...values);
    if (!page.hasMore) return rows;
    assertTrue(Boolean(page.nextCursor) && page.nextCursor !== cursor, 'PAGINATION_CURSOR_INVALID');
    cursor = page.nextCursor;
  }
}

function logicalDigest(database) {
  const tables = {};
  for (const table of BUSINESS_TABLES) {
    if (!tableExists(database, table)) continue;
    tables[table] = database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
  }
  return digest(stableJson(tables));
}
function tableCount(database, table, where) {
  if (!tableExists(database, table)) return 0;
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM "${table}"${where ? ` WHERE ${where}` : ''}`)
    .get();
  return Number(row.count);
}
function tableColumnValues(database, table, column) {
  if (!tableExists(database, table)) return [];
  return database
    .prepare(`SELECT "${column}" AS value FROM "${table}" ORDER BY "${column}"`)
    .all()
    .map(({ value }) => value);
}
function tableExists(database, table) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}
function assertIntegrity(database) {
  const rows = database.prepare('PRAGMA integrity_check').all();
  assertTrue(rows.length === 1 && Object.values(rows[0])[0] === 'ok', 'CLONE_INTEGRITY_FAILED');
}
function cloneCandidates(cloneRoot, sourceRoot, candidates) {
  return candidates.map(({ kind, dbPath }) => ({
    kind,
    dbPath: join(cloneRoot, assertContainedSourcePath(sourceRoot, dbPath)),
  }));
}
function candidateInputs(sourceDataDir, candidates) {
  return (
    candidates ?? [
      {
        kind: 'sandbox-data',
        dbPath: join(sourceDataDir, 'opencode', 'data', 'opencode', 'opencode.db'),
      },
      {
        kind: 'sandbox-state',
        dbPath: join(sourceDataDir, 'opencode', 'state', 'opencode', 'opencode.db'),
      },
    ]
  );
}
async function fingerprintExternalArtifacts(dataDir, candidates) {
  const paths = new Set();
  addTriplet(paths, 'sqlite.db');
  for (const { dbPath } of candidates) addTriplet(paths, relative(dataDir, dbPath));
  const fingerprints = [];
  for (const path of [...paths].sort()) {
    fingerprints.push({ path, ...(await fingerprintFile(join(dataDir, path))) });
  }
  return fingerprints;
}
async function readLegacyPages(legacy, sessionId) {
  const messages = [];
  let before;
  for (;;) {
    const page = await legacy.listMessagePage(sessionId, { limit: 13, before });
    messages.unshift(...page.messages);
    if (!page.nextCursor) return messages;
    assertTrue(page.nextCursor !== before, 'LEGACY_CURSOR_INVALID');
    before = page.nextCursor;
  }
}
function legacySessionProbe() {
  return {
    sessionId: 'rehearsal-absent',
    agentName: 'rehearsal-agent',
    workspaceDir: '/rehearsal/workspace',
    runtime: 'opencode',
    sessionType: 'branch',
    archived: false,
    pinned: false,
    status: 'idle',
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}
function addTriplet(paths, database) {
  paths.add(database);
  paths.add(`${database}-wal`);
  paths.add(`${database}-shm`);
}
async function entries(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}
async function directories(path) {
  return (await entries(path))
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
}
async function fingerprintFile(path) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return { exists: false };
    return {
      exists: true,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      sha256: await streamDigest(path),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
}
async function streamDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}
function envelope(messageId) {
  return {
    message_id: messageId,
    turn_id: 'rehearsal-turn',
    message: {
      role: 'user',
      timestamp: 2_000_000_000_000,
      content: [{ type: 'text', text: 'rehearsal' }],
    },
  };
}
function invariant(code, pass) {
  assertTrue(pass, code);
  return { code, pass: true };
}
async function invariantStep(code, operation) {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof RehearsalInvariantError) throw cause;
    throw new RehearsalInvariantError({ code, cause });
  }
}
function assertTrue(value, code) {
  if (!value) throw new RehearsalInvariantError({ code });
}
function assertEqual(left, right, code) {
  assertTrue(stableJson(left) === stableJson(right), code);
}
function requireAbsolute(path) {
  if (!isAbsolute(path))
    throw new RehearsalInvariantError({ code: 'SOURCE_DATA_DIR_NOT_ABSOLUTE' });
}
function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function stableJson(value) {
  return JSON.stringify(sortJson(value));
}
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

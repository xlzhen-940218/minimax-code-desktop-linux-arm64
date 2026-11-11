import { access, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import lockfile from 'proper-lockfile';
import {
  positiveInteger,
  reasoningEffort,
  candidateSummary,
  roundOutcome,
  logNames,
  readReport,
} from './memory-headless/report.mjs';
import { resolveMemoryConfig } from './memory-headless/config.mjs';
import yaml from 'js-yaml';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import {
  getPrimaryDataDirPath,
  loadConfigFromFile,
  readLocalRuntimeAuthContext,
  setLegacyByokProviderMigrationEnabled,
  setManagedPresetBaseUrlSyncEnabled,
} from '@mavis/config';
import { DatabaseClient } from '../src/infra/db/client.js';
import { initializeDatabase } from '../src/infra/db/initialize.js';
import { LocalModelResolver } from '../src/service/model-system/index.js';
import { createProductionAgentPreparation } from '../src/service/turn-system/index.js';
import { resolveBuiltinPromptAssetsDir } from '../src/service/prompt-config/index.js';
import { initializeProductionMemoryV2System } from '../src/service/memory-system/index.js';
import { MEMORY_DIAGNOSTICS_DIR } from '../src/service/memory-system/diagnostics.js';
import {
  createSessionRepository,
  createProjectRepository,
  createSessionHistoryLocationResolver,
  createReleasedSessionHistoryReader,
  createHistoryPersistenceRepository,
  createLegacyHistorySourceReader,
  createSessionSystemCanonicalHistoryProvider,
} from '../src/service/session-system/index.js';

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    'reasoning-effort': { type: 'string' },
    'capture-limit': { type: 'string' },
    'capture-concurrency': { type: 'string' },
    'max-selected-sessions': { type: 'string' },
    'config-dir': { type: 'string' },
    rounds: { type: 'string' },
    all: { type: 'boolean', default: false },
    'list-candidates': { type: 'boolean', default: false },
    'migrate-legacy': { type: 'boolean', default: false },
    'data-dir': { type: 'string' },
    'skip-migration': { type: 'boolean', default: false },
    'maintenance-only': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`完整记忆模块运行入口（指定目录原地运行）
pnpm --filter @mavis/local-runtime-v2 memory:headless --data-dir <dir> [选项]
  --data-dir <dir>        必填；直接使用目录内数据库、会话历史和记忆
  --config-dir <dir>      配置与认证目录，默认系统主数据目录
  --model <provider/id>   本次模型覆盖，省略时沿用系统配置
  --reasoning-effort <level>  迁移、抽取、整理共用 low/medium/high；省略时沿用配置
  --list-candidates      列出候选与历史输入估算，不调用生成模型
  --capture-limit <n>     每轮最多抽取的历史会话数，省略时沿用配置（默认 6）
  --capture-concurrency <n>  每轮抽取并发数，省略时沿用配置（默认 2）
  --max-selected-sessions <n>  整理选集文档数上限，省略时沿用配置
  --rounds <n>            最多运行轮数，默认 1
  --all                  持续处理符合资格的积压；与 rounds 互斥
  --migrate-legacy       登记选择迁移并迁完主 Agent 旧记忆与用户资料，然后抽取与整理
  --skip-migration       兼容旧命令，默认即跳过迁移
  --maintenance-only     只维护与整理已有 V2 记忆，执行一轮
本次进程启用详细日志、整理成功冷却设为 0；保留其余生产筛选与预算。
完整报告与日志保留在指定数据目录。`);
} else {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function main() {
  if (!values['data-dir']) throw new Error('请通过 --data-dir 指定已有数据目录');
  if (values.all && values.rounds) throw new Error('--all 与 --rounds 互斥');
  if (values['maintenance-only'] && (values.all || values.rounds))
    throw new Error('--maintenance-only 只执行一轮');
  if (values['migrate-legacy'] && values['skip-migration']) throw new Error('迁移开关互斥');
  if (values['capture-limit'] !== undefined)
    positiveInteger(values['capture-limit'], 'capture-limit');
  if (values['capture-concurrency'] !== undefined)
    positiveInteger(values['capture-concurrency'], 'capture-concurrency');
  reasoningEffort(values['reasoning-effort']);
  if (values['max-selected-sessions'])
    positiveInteger(values['max-selected-sessions'], 'max-selected-sessions');
  const rounds = values.all ? Infinity : positiveInteger(values.rounds ?? '1', 'rounds');
  const configDir = await realpath(resolve(values['config-dir'] ?? getPrimaryDataDirPath()));
  const dataDir = await realpath(resolve(values['data-dir']));
  if (
    !(await exists(join(dataDir, 'v2/sqlite/runtime-state.sqlite'))) &&
    !(await exists(join(dataDir, 'sqlite.db')))
  )
    throw new Error('指定目录内没有持久化会话数据库');
  const release = await lockfile.lock(dataDir, {
    lockfilePath: join(dataDir, 'memory-headless.lock'),
    retries: 0,
  });
  try {
    await run({ rounds, configDir, dataDir });
  } finally {
    await release();
  }
}

async function run({ rounds, configDir, dataDir }) {
  let memoryConfig;
  console.log(`[memory-headless] ${dataDir}`);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const runDir = await mkdtemp(join(dataDir, 'run-'));
  console.log(`[memory-headless] report ${runDir}`);
  const startedAtMs = Date.now();
  await save(runDir, 'started.json', { startedAtMs, configDir, dataDir });
  let system;
  let database;
  let failure;
  let inspection;
  let initialCandidates;
  let outcome = values['list-candidates'] ? 'listed' : 'deferred';
  const roundReports = [];
  const beforeLogs = await logNames(join(dataDir, MEMORY_DIAGNOSTICS_DIR));
  try {
    for (const file of ['MEMORY.md', 'memory_summary.md']) {
      const path = join(dataDir, 'memories', 'scopes', 'global', file);
      if (await exists(path)) await copyFile(path, join(runDir, `before-${file}`));
    }
    setLegacyByokProviderMigrationEnabled(false);
    setManagedPresetBaseUrlSyncEnabled(false);
    const appConfig = loadConfigFromFile(join(configDir, 'config.yaml'), { dataDir: configDir });
    memoryConfig = resolveMemoryConfig(appConfig.memory.v2, values);
    await save(runDir, 'input.json', {
      configDir,
      dataDir,
      startedAtMs,
      modelOverride: values.model,
      memoryConfig,
      migrateLegacy: values['migrate-legacy'],
      listCandidates: values['list-candidates'],
      rounds: values.all ? 'all' : rounds,
      configuredPublicationCooldownMs: appConfig.memory.v2.publicationCooldownMs,
      maintenanceOnly: values['maintenance-only'],
    });
    if (!memoryConfig.writeEnabled && !values['list-candidates'])
      throw new Error('系统配置 memory.v2.writeEnabled 为 false');
    database = new DatabaseClient({ dataDir });
    console.log('[memory-headless] initialize database');
    await save(
      runDir,
      'database-initialization.json',
      await initializeDatabase({ database, dataDir }),
    );
    const resolver = new LocalModelResolver({
      providerConfigGetter: () => appConfig.provider,
      byokConfigGetter: () => ({
        minimax_api: appConfig.minimax_api,
        custom_provider: appConfig.custom_provider,
        minimaxModelSource: appConfig.minimaxModelSource,
      }),
      authContextGetter: () => readLocalRuntimeAuthContext(configDir),
      providerAuthGetter: (provider) =>
        AuthStorage.create(join(configDir, 'codex-auth.json')).getApiKey(provider, {
          includeFallback: false,
        }),
    });
    const resolvedModels = new Map();
    const preparation = createProductionAgentPreparation({
      configBuilder: {
        config: () => appConfig,
        skills: {
          listRuntimeSkills: async () => ({ skills: [] }),
          renderCatalog: async () => '',
        },
      },
      modelResolver: {
        async resolveModel(input) {
          const resolved = await resolver.resolveModel(input);
          const record = {
            provider: resolved.model.provider,
            id: resolved.model.id,
            reasoning: resolved.model.reasoning,
            thinkingLevel: resolved.thinkingLevel,
            requestedEffort: input.agentConfig.model?.capabilities?.selected_thinking_effort,
          };
          resolvedModels.set(JSON.stringify(record), record);
          await save(runDir, 'resolved-models.json', [...resolvedModels.values()]);
          return resolved;
        },
      },
    });
    const sessions = createSessionRepository({ db: database.db });
    const projects = createProjectRepository({ db: database.db });
    const locations = createSessionHistoryLocationResolver({ dataDir, sessions });
    const released = createReleasedSessionHistoryReader({ dataDir, sessions, locations });
    const history = createSessionSystemCanonicalHistoryProvider({
      dataDir,
      sessions,
      locations,
      legacyHistory: {
        sources: createLegacyHistorySourceReader({
          db: database.db,
          readLedgerSnapshot: (id) => released.readLedgerSnapshot(id),
        }),
        checkpoints: createHistoryPersistenceRepository({ db: database.db }),
      },
    });
    const assets = await resolveBuiltinPromptAssetsDir();
    system = initializeProductionMemoryV2System({
      db: database.db,
      dataDir,
      sessions,
      projects,
      history,
      preparation,
      appConfig: () => memoryConfig,
      defaultModelName: () => appConfig.defaultModel ?? 'minimax/MiniMax-M3',
      readPrompt: (key) => readFile(join(assets, key), 'utf8'),
      disableLegacyRecall: (agentName) => disableLegacyRecall(dataDir, agentName),
    });
    async function inspect(name) {
      const state = await system.inspect(startedAtMs);
      for (const candidate of state.captures) {
        const session = await sessions.get(candidate.sessionId);
        candidate.title = session?.title;
        candidate.sessionType = session?.sessionType;
      }
      await save(runDir, name, state);
      const summary = candidateSummary(state);
      console.log(`[memory-headless] candidates ${JSON.stringify(summary)}`);
      return state;
    }
    inspection = await inspect('candidates-before.json');
    initialCandidates = candidateSummary(inspection);
    if (values['list-candidates']) {
      console.table(
        inspection.captures.map((item) => ({
          sessionId: item.sessionId,
          title: item.title,
          type: item.sessionType,
          status: item.inspection.status,
          inputTokens: item.inspection.historyInputTokens,
        })),
      );
      console.table(inspection.consolidation.documents);
      console.table(inspection.consolidation.notes);
    } else {
      // 迁移完成后开放准入，第一轮即可读取全部迁移产物。
      if (values['migrate-legacy']) await migrate(system, runDir);
      await system.ready();
      for (let round = 1; round <= rounds; round += 1) {
        const beforeRound = await logNames(join(dataDir, MEMORY_DIAGNOSTICS_DIR));
        console.log(
          `[memory-headless] round ${round}, capture limit ${memoryConfig.maxCaptureSessionsPerWake}, concurrency ${memoryConfig.maxCaptureConcurrency}`,
        );
        system.reconciler.kick(
          values['maintenance-only']
            ? { kind: 'maintenance' }
            : { kind: 'manual-capture', createdBeforeMs: startedAtMs },
        );
        await system.reconciler.drain(new AbortController().signal);
        inspection = await inspect(`candidates-round-${round}.json`);
        const files = (await logNames(join(dataDir, MEMORY_DIAGNOSTICS_DIR))).filter(
          (name) => !beforeRound.includes(name),
        );
        const report = await readReport(join(dataDir, MEMORY_DIAGNOSTICS_DIR), files);
        outcome = roundOutcome(report, inspection, values['maintenance-only']);
        const result = {
          round,
          outcome,
          ...report,
          candidates: candidateSummary(inspection),
          logFiles: files,
        };
        roundReports.push(result);
        await save(runDir, `round-${round}.json`, result);
        console.log(
          `[memory-headless] round ${round}: ${outcome}, tokens ${report.usage.totalTokens}`,
        );
        if (outcome !== 'more') break;
      }
      if (outcome === 'more') outcome = 'round-limit';
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      await system?.close();
    } catch (error) {
      failure ??= error instanceof Error ? error.message : String(error);
    } finally {
      database?.close();
    }
    const logFiles = (await logNames(join(dataDir, MEMORY_DIAGNOSTICS_DIR))).filter(
      (name) => !beforeLogs.includes(name),
    );
    const { stages, failures, decisions, usage } = await readReport(
      join(dataDir, MEMORY_DIAGNOSTICS_DIR),
      logFiles,
    );
    const status = failure || failures.length ? 'failed' : outcome;
    await save(runDir, 'result.json', {
      status,
      failure,
      startedAtMs,
      finishedAtMs: Date.now(),
      configDir,
      dataDir,
      memoryConfig,
      stages,
      failures,
      logFiles,
      decisions,
      usage,
      rounds: roundReports,
      candidates: inspection ? candidateSummary(inspection) : undefined,
      estimate: {
        tokenizer: 'o200k_base',
        coverage: 'pending-capture-history-only',
        initialHistoryInputTokens: initialCandidates?.historyInputTokens,
        remainingHistoryInputTokens: inspection
          ? candidateSummary(inspection).historyInputTokens
          : undefined,
      },
    });
    for (const file of ['MEMORY.md', 'memory_summary.md']) {
      const path = join(dataDir, 'memories', 'scopes', 'global', file);
      if (await exists(path)) await copyFile(path, join(runDir, file));
    }
    const artifactLinks = ['[完整状态与跳过原因](result.json)'];
    for (const [file, label] of [
      ['migration-report.md', '迁移逐文件对照'],
      ['MEMORY.md', '最终索引'],
      ['memory_summary.md', '最终摘要'],
    ]) {
      if (await exists(join(runDir, file))) artifactLinks.push(`[${label}](${file})`);
    }
    await writeFile(
      join(runDir, 'report.md'),
      [
        '# 记忆模块运行记录',
        '',
        `运行结果：${status}。已运行 ${roundReports.length} 轮，每轮最多抽取 ${memoryConfig?.maxCaptureSessionsPerWake ?? '配置加载失败'} 个历史会话，并发 ${memoryConfig?.maxCaptureConcurrency ?? '配置加载失败'}。`,
        `数据目录：${dataDir}`,
        `配置与认证：${configDir}`,
        `累计模型用量：${usage.totalTokens} token；输入 ${usage.input}，输出 ${usage.output}，缓存读取 ${usage.cacheRead}，缓存写入 ${usage.cacheWrite}。`,
        `请求 ${usage.requests} 次，响应 ${usage.responses} 次，缺少用量的响应 ${usage.missingUsage} 次。`,
        `最终候选：${JSON.stringify(inspection ? candidateSummary(inspection) : {})}`,
        '运行前输入估算见 candidates-before.json；实际用量见 result.json 的 usage，按阶段分组。',
        '[运行前候选](candidates-before.json)',
        ...roundReports.map(
          (round) =>
            `[第 ${round.round} 轮](round-${round.round}.json) · [候选](candidates-round-${round.round}.json)`,
        ),
        '',
        '| 阶段 | 结果 |',
        '| --- | --- |',
        ...stages.map((stage) => `| ${stage.operation} | ${stage.result?.status} |`),
        '',
        artifactLinks.join(' · '),
        '',
        '## 完整日志',
        '',
        ...logFiles.map((name) => `- [${name}](../${MEMORY_DIAGNOSTICS_DIR}/${name})`),
      ].join('\n'),
    );
    console.log(`[memory-headless] ${status}: ${join(runDir, 'result.json')}`);
    console.log(
      `[memory-headless] total tokens ${usage.totalTokens}: ${JSON.stringify(usage.byStage)}`,
    );
    if (!['completed', 'listed', 'round-limit'].includes(status)) process.exitCode = 1;
  }
}

/** 与启用引导选择迁移等价：登记选择后逐个迁移待迁文件，结果与生产 Reconciler 调用同一服务。 */
async function migrate(system, runDir) {
  const { record } = await system.onboarding.inspect();
  if (!record) await system.onboarding.complete({ legacyChoice: 'migrate', backfillChoice: 'extract' });
  else if (record.legacyChoice !== 'migrate') {
    throw new Error(`引导已选择 ${record.legacyChoice}，不再迁移旧记忆`);
  }
  const pending = await system.legacyMigration.listPending();
  const records = [];
  for (const candidate of pending) {
    const result = await system.legacyMigration.migrate(candidate);
    records.push({
      sourceFile: candidate.sourceFile,
      sessionId: candidate.sessionId,
      inputBytes: Buffer.byteLength(candidate.content),
      inputSha256: createHash('sha256').update(candidate.content).digest('hex'),
      outputFile:
        result.status === 'migrated'
          ? `memories/scopes/global/sessions/${candidate.sessionId}.md`
          : undefined,
      ...result,
    });
  }
  await save(runDir, 'migration-record.json', records);
  const migrated = records.filter((r) => r.status === 'migrated').length;
  await writeFile(
    join(runDir, 'migration-report.md'),
    [
      '# 旧记忆迁移记录',
      '',
      `待迁 ${pending.length} 个文件，迁入 ${migrated} 份文档。`,
      '',
      '| 原文件 | 输入字节 | 结果 |',
      '| --- | ---: | --- |',
      ...records.map(
        (r) =>
          `| ${r.sourceFile} | ${r.inputBytes} | ${r.outputFile ? `[查看产物](../${r.outputFile})` : `${r.status}${r.reason ? `：${r.reason}` : ''}`} |`,
      ),
    ].join('\n'),
  );
  console.log(`[memory-headless] migration: ${pending.length} files -> ${migrated} documents`);
}

async function disableLegacyRecall(dataDir, agentName) {
  const path = join(dataDir, 'config.yaml');
  const config = (await exists(path)) ? yaml.load(await readFile(path, 'utf8')) : {};
  config.memory ??= {};
  config.memory.legacyRecallDisabledAgents ??= {};
  for (const name of ['main', 'mavis'].includes(agentName) ? ['main', 'mavis'] : [agentName]) {
    config.memory.legacyRecallDisabledAgents[name] = true;
  }
  await writeFile(path, yaml.dump(config, { lineWidth: -1 }), { mode: 0o600 });
}

async function save(dir, name, value) {
  await writeFile(join(dir, name), JSON.stringify(value, null, 2));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

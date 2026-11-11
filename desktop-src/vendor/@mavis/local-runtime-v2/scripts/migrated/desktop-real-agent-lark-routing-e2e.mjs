#!/usr/bin/env node
/**
 * Real-LLM E2E for Feishu/Lark link routing.
 *
 * This harness intentionally keeps the user prompts natural. A dataDir-local
 * `lark-cli` executable records the real command argv and returns a unique fact
 * for each document fixture. Independent evidence combines the SSE tool
 * trajectory, captured lark-cli argv, and a unique final fact.
 *
 * Usage:
 *   MAVIS_E2E_USER_AUTH_PATH=/path/to/local-runtime.auth.json \
 *     node packages/local-runtime-v2/scripts/migrated/desktop-real-agent-lark-routing-e2e.mjs
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

import {
  assertBareLarkRoute,
  assertCompleteToolLifecycle,
  recordAssistantMessage,
} from './desktop-real-agent-lark-routing-assertions.mjs';

const RespDataType = {
  AgentMessage: 2,
  AgentMessageChunk: 6,
  Heartbeat: 10,
};
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);
const defaultProviderId = 'minimax-internal';
const defaultModelId = 'MiniMax-M3';
const supportedModelIds = ['MiniMax-M3', 'MiniMax-M2.7'];
const defaultPlatformApiBaseUrl = 'https://api.ohmyrouter.com/v1';
const platformApiBaseUrl = normalizeBaseUrlForMatch(
  process.env.MAVIS_E2E_LLM_BASE_URL || defaultPlatformApiBaseUrl,
);
const platformApiSubModule = (
  process.env.MAVIS_E2E_LLM_SUB_MODULE || 'claude-code-internal'
).trim();
const userDataDir = path.join(os.homedir(), '.minimax');
const userConfigPath = path.resolve(
  process.env.MAVIS_E2E_USER_CONFIG_PATH ||
    process.env.MAVIS_E2E_CONFIG_PATH ||
    path.join(userDataDir, 'config.yaml'),
);
const caseTimeoutMs = readIntEnv('MAVIS_E2E_CASE_TIMEOUT_MS', 6 * 60 * 1000);
const firstEventTimeoutMs = readIntEnv('MAVIS_E2E_FIRST_EVENT_TIMEOUT_MS', 180 * 1000);
const streamIdleTimeoutMs = readIntEnv('MAVIS_E2E_STREAM_IDLE_TIMEOUT_MS', 120 * 1000);
const artifactDir = path.resolve(
  process.env.MAVIS_E2E_ARTIFACT_DIR ||
    path.join(repoRoot, 'artifacts/e2e/desktop-real-agent-lark-routing'),
);
const selectedCases = readCsvEnv('MAVIS_E2E_CASES');
const startedAt = Date.now();
const runId = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const runArtifactDir = path.join(artifactDir, runId);
const repositoryEvidence = collectRepositoryEvidence([
  'packages/local-runtime-v2/scripts/migrated/desktop-real-agent-lark-routing-e2e.mjs',
  'packages/local-runtime-v2/scripts/migrated/desktop-real-agent-lark-routing-assertions.mjs',
  'packages/local-runtime-v2/assets/skills/lark-tools/SKILL.md',
  'packages/local-runtime-v2/dist/index.js',
  'packages/local-runtime-v2/dist/service/turn-system/product-tools/host-turn-tools.js',
  'packages/agent-modules/context-manager/dist/skill-catalog.js',
  'packages/agent-tools/dist/index.js',
  'packages/agent-tools/dist/desktop/builtin-defs.js',
  'packages/agent-tools/dist/desktop/local-skill.js',
  'packages/config/dist/index.js',
]);
const dataDir = await mkdtemp(path.join(getShortTmpRoot(), `mavis-lark-e2e-data-${runId}-`));
const workspaceDir = await mkdtemp(
  path.join(getShortTmpRoot(), `mavis-lark-e2e-workspace-${runId}-`),
);
const originalPath = process.env.PATH;

const docxUrl =
  'https://vrfi1sk8a0.feishu.cn/docx/LarkRoutingDocxFixture20260722';
const wikiUrl =
  'https://vrfi1sk8a0.feishu.cn/wiki/LarkRoutingWikiFixture20260722';
const docxFact = 'DOCX_LARK_ROUTE_FACT_7Q4M';
const wikiFact = 'WIKI_LARK_ROUTE_FACT_9V2K';
const wikiObjToken = 'doxcnLarkRoutingWikiFixture20260722';
const larkCommandLogPath = path.join(dataDir, 'lark-cli-invocations.ndjson');
const bundledSkillsRoot = path.join(repoRoot, 'packages/local-runtime-v2/assets/skills');
const skillIsolationEvidence = {
  runtimeConfig: { skills: { external: { enabled: false } } },
  bundledSkillsSource: bundledSkillsRoot,
  seededSkillsRoot: path.join(dataDir, '.builtin-skills'),
};

const caseArtifacts = [];
let runtimeHost;
let selectedModel;

const cases = [
  {
    id: 'lark-bare-docx-routing',
    gateId: 'bare-docx-uses-bundled-lark-route',
    kind: 'lark',
    url: docxUrl,
    fact: docxFact,
    prompt: `请读取并总结这个飞书文档：${docxUrl}`,
  },
  {
    id: 'lark-bare-wiki-routing',
    gateId: 'bare-wiki-uses-bundled-lark-route',
    kind: 'lark',
    url: wikiUrl,
    fact: wikiFact,
    prompt: `请读取并总结这个飞书知识库页面：${wikiUrl}`,
  },
];

await main();

async function main() {
  await mkdir(artifactDir, { recursive: true });
  await mkdir(runArtifactDir, { recursive: false });
  console.log(`[lark-routing-real-agent] artifacts: ${runArtifactDir}`);
  try {
    const unknownCases = [...selectedCases].filter(
      (caseId) => !cases.some((testCase) => testCase.id === caseId),
    );
    if (unknownCases.length > 0) {
      throw new Error(`Unknown MAVIS_E2E_CASES: ${unknownCases.join(', ')}`);
    }
    await provisionLarkCliFixture();
    selectedModel = await readDesktopLlmConfig(dataDir);
    await startLocalRuntime(selectedModel);
    await assertLocalRuntimeAlive('startup');

    for (const testCase of cases) {
      if (selectedCases.size > 0 && !selectedCases.has(testCase.id)) continue;
      await runCase(testCase);
    }
    if (caseArtifacts.length === 0) {
      throw new Error(`No cases matched MAVIS_E2E_CASES=${[...selectedCases].join(',')}`);
    }
    const expectedCaseCount = selectedCases.size > 0 ? selectedCases.size : cases.length;
    if (caseArtifacts.length !== expectedCaseCount) {
      throw new Error(
        `Expected ${expectedCaseCount} independent case artifacts, got ${caseArtifacts.length}`,
      );
    }
    const failedCases = caseArtifacts.filter((item) => !item.ok);
    if (failedCases.length > 0) {
      throw new Error(`Failed cases: ${failedCases.map((item) => item.name).join(', ')}`);
    }
    await writeJson('summary.json', {
      ok: true,
      runId,
      startedAt,
      finishedAt: Date.now(),
      model: selectedModel.modelRef,
      repository: repositoryEvidence,
      fullRun: selectedCases.size === 0,
      expectedCases:
        selectedCases.size > 0 ? [...selectedCases] : cases.map((testCase) => testCase.id),
      skillIsolation: skillIsolationEvidence,
      artifactDir: runArtifactDir,
      cases: caseArtifacts,
    });
    const runLabel = selectedCases.size === 0 ? 'full' : 'selected';
    console.log(
      `[lark-routing-real-agent] PASS ${caseArtifacts.length}/${expectedCaseCount} (${runLabel} run)`,
    );
  } catch (error) {
    await writeJson('summary.json', {
      ok: false,
      runId,
      startedAt,
      failedAt: Date.now(),
      error: errorSummary(error),
      fullRun: selectedCases.size === 0,
      expectedCases:
        selectedCases.size > 0 ? [...selectedCases] : cases.map((testCase) => testCase.id),
      repository: repositoryEvidence,
      skillIsolation: skillIsolationEvidence,
      artifactDir: runArtifactDir,
      cases: caseArtifacts,
    }).catch(() => undefined);
    console.error(
      `[lark-routing-real-agent] FAIL: ${error instanceof Error ? error.stack : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await runtimeHost?.apiHost?.shutdownChannelSubsystem?.();
    await runtimeHost?.apiHost?.close?.();
    await runtimeHost?.metricsClient?.close?.();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (process.env.MAVIS_E2E_KEEP_TMP !== '1') {
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    } else {
      console.log(`[lark-routing-real-agent] kept dataDir: ${dataDir}`);
      console.log(`[lark-routing-real-agent] kept workspaceDir: ${workspaceDir}`);
    }
  }
}

async function runCase(testCase) {
  console.log(`[lark-routing-real-agent] case ${testCase.id} start`);
  const caseStartedAt = Date.now();
  const commandStart = (await readLarkCommandLog()).length;
  let session;
  let stream;
  try {
    session = await createSession(testCase.id);
    stream = await withTimeout(
      sendMessageStream(session.sessionId, {
        content: testCase.prompt,
        turnId: `turn-${testCase.id}-${runId}`,
        caseName: testCase.id,
      }),
      caseTimeoutMs,
      `${testCase.id} timed out`,
    );
    await assertFinished(session.sessionId);
    await assertLocalRuntimeAlive(testCase.id);

    const commands = (await readLarkCommandLog()).slice(commandStart);
    assertCompleteToolLifecycle(stream, testCase.id);
    assertBareLarkRoute(testCase, stream, commands);

    const artifact = {
      name: testCase.id,
      ok: true,
      startedAt: caseStartedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - caseStartedAt,
      sessionId: session.sessionId,
      gateId: testCase.gateId,
      targetUrl: testCase.url,
      repository: repositoryEvidence,
      skillIsolation: skillIsolationEvidence,
      larkCliInvocations: commands,
      bashCommands: captureBashCommands(stream),
      stream,
      verdict: {
        gateId: testCase.gateId,
        status: 'PASS',
        checks: [
          'exactly-one-lark-tools-skill',
          'exactly-one-direct-bash-lark-cli-route',
          'no-read-auth-or-shell-preflight',
          'bash-body-matches-captured-argv',
          'complete-tool-lifecycle',
          'exact-document-fetched',
        ],
      },
    };
    caseArtifacts.push({
      name: testCase.id,
      gateId: testCase.gateId,
      ok: true,
      artifact: `${runId}/${testCase.id}.json`,
    });
    await writeJson(`${testCase.id}.json`, artifact);
    console.log(`[lark-routing-real-agent] case ${testCase.id} PASS`);
  } catch (error) {
    const commands = (await readLarkCommandLog()).slice(commandStart);
    const artifact = {
      name: testCase.id,
      ok: false,
      startedAt: caseStartedAt,
      failedAt: Date.now(),
      durationMs: Date.now() - caseStartedAt,
      sessionId: session?.sessionId,
      gateId: testCase.gateId,
      targetUrl: testCase.url,
      repository: repositoryEvidence,
      skillIsolation: skillIsolationEvidence,
      larkCliInvocations: commands,
      ...(stream ? { bashCommands: captureBashCommands(stream) } : {}),
      ...(stream ? { stream } : {}),
      error: errorSummary(error),
      verdict: { gateId: testCase.gateId, status: 'FAIL' },
    };
    caseArtifacts.push({
      name: testCase.id,
      gateId: testCase.gateId,
      ok: false,
      artifact: `${runId}/${testCase.id}.json`,
    });
    await writeJson(`${testCase.id}.json`, artifact);
    console.error(
      `[lark-routing-real-agent] case ${testCase.id} FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function captureBashCommands(stream) {
  return stream.toolStarts
    .filter((call) => call.name === 'bash')
    .map((call) => ({ callId: call.callId, command: call.input?.command }));
}

async function provisionLarkCliFixture() {
  const binDir = path.join(dataDir, 'bin');
  const fixturePath = path.join(binDir, 'lark-cli');
  await mkdir(binDir, { recursive: true });
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(larkCommandLogPath)}, JSON.stringify({ argv, at: Date.now() }) + '\\n');
const documents = new Map(${JSON.stringify([
    [
      docxUrl,
      {
        title: '飞书 Docx 路由测试',
        markdown: `# 飞书 Docx 路由测试\\n\\n唯一事实：${docxFact}`,
      },
    ],
    [
      wikiUrl,
      {
        title: '飞书 Wiki 路由测试',
        markdown: `# 飞书 Wiki 路由测试\\n\\n唯一事实：${wikiFact}`,
      },
    ],
    [
      wikiObjToken,
      {
        title: '飞书 Wiki 路由测试',
        markdown: `# 飞书 Wiki 路由测试\\n\\n唯一事实：${wikiFact}`,
      },
    ],
  ])});
function output(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
if (argv.length === 0 || argv.includes('--help') || argv[0] === 'help') {
  process.stdout.write('fixture lark-cli: auth status | docs +fetch --doc <url>\\n');
  process.exit(0);
}
if (argv.includes('--version') || argv[0] === 'version') {
  process.stdout.write('lark-cli fixture 0.0.0\\n');
  process.exit(0);
}
if (argv[0] === 'auth' && argv[1] === 'status') {
  output({ appId: 'cli_fixture_app', identity: 'user', userOpenId: 'ou_cli_fixture', userName: 'Lark Route Fixture', tokenStatus: 'valid', verified: true, scope: ['docx:document:readonly', 'wiki:wiki:readonly'] });
  process.exit(0);
}
if (argv[0] === 'wiki' && argv[1] === 'spaces' && argv[2] === 'get_node') {
  const paramsIndex = argv.indexOf('--params');
  let token;
  try { token = paramsIndex >= 0 ? JSON.parse(argv[paramsIndex + 1]).token : undefined; } catch {}
  if (token !== 'LarkRoutingWikiFixture20260722') {
    process.stderr.write('fixture rejected unknown wiki token\\n');
    process.exit(65);
  }
  output({ ok: true, data: { node: { node_token: token, obj_token: ${JSON.stringify(wikiObjToken)}, obj_type: 'docx', title: '飞书 Wiki 路由测试' } } });
  process.exit(0);
}
if (argv[0] === 'wiki' && argv[1] === '+node-get') {
  const tokenIndex = argv.indexOf('--node-token');
  const token = tokenIndex >= 0 ? argv[tokenIndex + 1] : undefined;
  if (token !== ${JSON.stringify(wikiUrl)} && token !== 'LarkRoutingWikiFixture20260722') {
    process.stderr.write('fixture rejected unknown wiki node\\n');
    process.exit(65);
  }
  output({ ok: true, data: { node: { node_token: 'LarkRoutingWikiFixture20260722', obj_token: ${JSON.stringify(wikiObjToken)}, obj_type: 'docx', title: '飞书 Wiki 路由测试' } } });
  process.exit(0);
}
if (argv[0] === 'docs' && argv[1] === '+fetch') {
  const docIndex = argv.indexOf('--doc');
  const target = docIndex >= 0 ? argv[docIndex + 1] : undefined;
  const document = documents.get(target);
  if (!document) {
    process.stderr.write('fixture rejected unknown --doc URL\\n');
    process.exit(65);
  }
  output({ ok: true, doc: target, ...document });
  process.exit(0);
}
process.stderr.write('fixture rejected unsupported lark-cli command: ' + JSON.stringify(argv) + '\\n');
process.exit(64);
`;
  await writeFile(fixturePath, source, 'utf8');
  await chmod(fixturePath, 0o755);
  await writeFile(larkCommandLogPath, '', 'utf8');
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
}

async function readLarkCommandLog() {
  if (!existsSync(larkCommandLogPath)) return [];
  const text = await readFile(larkCommandLogPath, 'utf8');
  return text
    .split(/\r?\n/gu)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function startLocalRuntime(llm) {
  process.env.MAVIS_DATA_DIR = dataDir;
  process.env.__MAVIS_RUNTIME_MANAGED = '0';
  process.env.MAVIS_BUILD_ENV = process.env.MAVIS_BUILD_ENV || 'dev';
  process.env.NEXT_PUBLIC_BUILD_ENV = process.env.NEXT_PUBLIC_BUILD_ENV || 'dev';
  const runtimeEntry = path.join(repoRoot, 'packages/local-runtime-v2/dist/index.js');
  if (!existsSync(runtimeEntry)) {
    throw new Error(`Missing ${runtimeEntry}; build local-runtime-v2 before this E2E.`);
  }
  const runtime = await import(pathToFileURL(runtimeEntry));
  if (llm.runtimeConfig.skills?.external?.enabled !== false) {
    throw new Error('Lark routing E2E must run with skills.external.enabled=false');
  }
  process.env.MAVIS_BUILTIN_SKILLS_DIR = bundledSkillsRoot;
  runtimeHost = await runtime.createLocalRuntimeHostV2({
    dataDir,
    runtimeOwnerKind: 'cli',
    runtimeMode: 'clean',
    capabilities: { cliEmbedded: true },
    configGetter: () => llm.runtimeConfig,
    authContextGetter: () => llm.authContext,
    defaultWorkspaceDir: workspaceDir,
    enableLiveMcp: false,
  });
}

async function createSession(title) {
  const response = await runtimeFetch('/api/agent/mavis/session', {
    method: 'POST',
    body: JSON.stringify({
      workspaceDir,
      title,
      teamModeOff: true,
      model: { provider_id: selectedModel.providerId, model_id: selectedModel.modelId },
    }),
  });
  const body = await readJsonResponse(response);
  if (response.status !== 201 || typeof body.sessionId !== 'string') {
    throw new Error(`create session failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function sendMessageStream(sessionId, input) {
  const response = await runtimeFetch(`/api/session/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST',
    body: JSON.stringify({
      content: input.content,
      turnId: input.turnId,
      model: { provider_id: selectedModel.providerId, model_id: selectedModel.modelId },
    }),
  });
  return readSseResponse(response, input.caseName);
}

async function readSseResponse(response, caseName) {
  if (!response.ok || !response.body) {
    throw new Error(`${caseName}: stream failed ${response.status}: ${await response.text()}`);
  }
  const evidence = {
    caseName,
    startedAt: Date.now(),
    events: 0,
    meaningfulEvents: 0,
    done: false,
    streamClosed: false,
    assistantMessages: [],
    allText: '',
    toolStarts: [],
    toolResults: [],
    toolFinishes: 0,
    toolFailures: 0,
    toolTimeline: [],
    toolLifecycles: [],
    lifecycleErrors: [],
    errors: [],
    assistantMessagesById: new Map(),
    toolStatesByCallId: new Map(),
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedMeaningful = false;
  try {
    while (true) {
      const timeoutMs = receivedMeaningful ? streamIdleTimeoutMs : firstEventTimeoutMs;
      const { done, value } = await withTimeout(
        reader.read(),
        timeoutMs,
        `${caseName}: SSE ${receivedMeaningful ? 'became idle' : 'had no first event'}`,
      );
      if (done) {
        evidence.streamClosed = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = splitSseFrames(buffer);
      buffer = frames.remainder;
      for (const frame of frames.frames) ingestSsePayload(evidence, frame);
      receivedMeaningful = evidence.meaningfulEvents > 0;
      if (evidence.done) break;
    }
    if (buffer.trim()) ingestSsePayload(evidence, buffer);
  } finally {
    reader.releaseLock();
  }
  evidence.finishedAt = Date.now();
  evidence.durationMs = evidence.finishedAt - evidence.startedAt;
  evidence.toolLifecycles = [...evidence.toolStatesByCallId.values()].map((state) => ({
    callId: state.callId,
    name: state.name,
    statuses: [...state.statuses],
    terminalStatus: state.terminalStatus,
  }));
  evidence.assistantMessages = [...evidence.assistantMessagesById.values()];
  delete evidence.assistantMessagesById;
  delete evidence.toolStatesByCallId;
  if (evidence.meaningfulEvents === 0) {
    throw withEvidence(new Error(`${caseName}: empty SSE stream`), evidence);
  }
  if (evidence.errors.length > 0) {
    throw withEvidence(new Error(`${caseName}: SSE errors: ${evidence.errors.join('; ')}`), evidence);
  }
  if (!evidence.done && !evidence.streamClosed) {
    throw withEvidence(new Error(`${caseName}: SSE did not finish or close`), evidence);
  }
  return evidence;
}

function ingestSsePayload(evidence, rawFrame) {
  const payload = rawFrame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!payload) return;
  evidence.events += 1;
  if (payload === '[DONE]') {
    evidence.done = true;
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    evidence.meaningfulEvents += 1;
    evidence.allText += `\n${payload}`;
    return;
  }
  if (parsed?.type === RespDataType.Heartbeat || parsed?.type === 'heartbeat') return;
  evidence.meaningfulEvents += 1;
  if (parsed?.type === 'error' || parsed?.error) {
    evidence.errors.push(String(parsed.error || JSON.stringify(parsed)));
  }
  const message = parsed?.agent_message_chunk || parsed?.agent_message;
  if (!message) {
    evidence.allText += `\n${JSON.stringify(parsed)}`;
    return;
  }
  recordAssistantMessage(evidence, message, parsed?.type === RespDataType.AgentMessage);
  if (message.msg_content) evidence.allText += `\n${message.msg_content}`;
  if (message.thinking_content) evidence.allText += `\n${message.thinking_content}`;
  ingestToolCalls(evidence, message.tool_calls, message.msg_id || message.id);
}

function ingestToolCalls(evidence, toolCalls, messageId) {
  if (!Array.isArray(toolCalls)) return;
  for (const call of toolCalls) {
    const name = String(call.tool_name || call.name || '');
    const status = normalizeToolStatus(call.tool_call_status ?? call.status);
    const callId = String(call.tool_call_id || call.id || '');
    if (!status) continue;
    if (!callId) {
      const error = `${name || '(unnamed tool)'} emitted ${status} without callId`;
      if (!evidence.lifecycleErrors.includes(error)) evidence.lifecycleErrors.push(error);
      continue;
    }
    let state = evidence.toolStatesByCallId.get(callId);
    if (!state) {
      state = { callId, name, statuses: new Set(), terminalStatus: undefined };
      evidence.toolStatesByCallId.set(callId, state);
    } else if (name && state.name && name !== state.name) {
      evidence.lifecycleErrors.push(
        `${callId} changed tool name from ${state.name} to ${name}`,
      );
    } else if (!state.name && name) {
      state.name = name;
    }
    const normalizedMessageId = String(messageId ?? '').trim();
    if (!normalizedMessageId) {
      const error = `${callId} emitted ${status} without assistant messageId`;
      if (!evidence.lifecycleErrors.includes(error)) evidence.lifecycleErrors.push(error);
    }
    if (state.statuses.has(status)) {
      updateDuplicateToolPayload(evidence, state, status, call);
      continue;
    }
    if (status !== 'start' && !state.statuses.has('start')) {
      evidence.lifecycleErrors.push(`${callId} emitted ${status} before start`);
    }
    if (status !== 'start' && state.terminalStatus && state.terminalStatus !== status) {
      evidence.lifecycleErrors.push(
        `${callId} emitted conflicting terminal states ${state.terminalStatus} and ${status}`,
      );
    }
    state.statuses.add(status);
    if (status !== 'start') state.terminalStatus = status;
    evidence.toolTimeline.push({
      ordinal: evidence.toolTimeline.length,
      status,
      name: state.name || name,
      callId,
      messageId: normalizedMessageId || null,
    });
    if (status === 'start') {
      const input = normalizeToolInput(call);
      evidence.toolStarts.push({ name: state.name || name, callId, input });
    }
    if (status === 'finished') {
      evidence.toolFinishes += 1;
      evidence.toolResults.push({ name: state.name || name, callId, result: normalizeToolResult(call) });
    }
    if (status === 'failed') {
      evidence.toolFailures += 1;
    }
    evidence.allText += `\n${name || 'tool'} ${JSON.stringify(call)}`;
  }
}

function normalizeToolStatus(rawStatus) {
  if (rawStatus === 1) return 'start';
  if (rawStatus === 2) return 'finished';
  if (rawStatus === 3) return 'failed';
  const status = String(rawStatus ?? '').trim().toLowerCase();
  if (status === '1' || status === 'start' || status === 'started') return 'start';
  if (status === '2' || status === 'finish' || status === 'finished' || status === 'done') {
    return 'finished';
  }
  if (status === '3' || status === 'fail' || status === 'failed' || status === 'error') {
    return 'failed';
  }
  return undefined;
}

function updateDuplicateToolPayload(evidence, state, status, call) {
  if (status === 'start') {
    const existing = evidence.toolStarts.find((entry) => entry.callId === state.callId);
    const input = normalizeToolInput(call);
    if (existing && Object.keys(existing.input).length === 0 && Object.keys(input).length > 0) {
      existing.input = input;
    }
    return;
  }
  if (status === 'finished') {
    const existing = evidence.toolResults.find((entry) => entry.callId === state.callId);
    const result = normalizeToolResult(call);
    if (existing && Object.keys(existing.result).length === 0 && Object.keys(result).length > 0) {
      existing.result = result;
    }
  }
}

function normalizeToolInput(call) {
  const raw = call.tool_call_args ?? call.arguments ?? call.input ?? call.args ?? {};
  if (isPlainObject(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeToolResult(call) {
  const raw = call.tool_call_result_data ?? call.result ?? call.output ?? {};
  if (isPlainObject(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function assertFinished(sessionId) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    const response = await runtimeFetch(`/api/session/${encodeURIComponent(sessionId)}`);
    last = await readJsonResponse(response);
    const status = last?.session?.status?.type;
    if (status === 'finished') return;
    if (status && status !== 'started') {
      throw new Error(`session ${sessionId} ended in ${status}: ${JSON.stringify(last)}`);
    }
    await sleep(300);
  }
  throw new Error(`session ${sessionId} did not finish: ${JSON.stringify(last)}`);
}

async function assertLocalRuntimeAlive(label) {
  const response = await runtimeFetch('/health', { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${label}: health returned ${response.status}`);
}

async function runtimeFetch(apiPath, init = {}) {
  if (!runtimeHost?.apiHost) throw new Error('local-runtime host is not started');
  const headers = new Headers(init.headers);
  if (!headers.has('content-type') && init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  return runtimeHost.apiHost.handleRequest(
    new Request(`http://local-runtime.test/mavis${apiPath}`, { ...init, headers }),
  );
}

async function readDesktopLlmConfig(runtimeDataDir) {
  const configModule = await import(
    pathToFileURL(path.join(repoRoot, 'packages/config/dist/index.js'))
  );
  const envKey = optionalEnv('MAVIS_E2E_LLM_API_KEY');
  if (envKey) {
    if (!isUsableApiKey(envKey)) throw new Error('MAVIS_E2E_LLM_API_KEY is a placeholder');
    const requested = parseRequestedModel();
    return {
      ...requested,
      modelRef: `${requested.providerId}/${requested.modelId}`,
      runtimeConfig: baseRuntimeConfig(runtimeDataDir, requested, {
        [requested.providerId]: buildPlatformApiProvider(envKey, requested.modelId),
      }),
      authContext: readUserAuthContext(),
    };
  }
  const userConfig = readUserConfig();
  const requested = parseModelRef(
    optionalEnv('MAVIS_E2E_LLM_MODEL') || optionalEnv('MAVIS_E2E_MODEL') || userConfig.defaultModel,
  );
  const provider = userConfig.provider?.[requested.providerId];
  if (!provider) throw new Error(`provider ${requested.providerId} is missing in user config`);
  const authMode = configModule.resolveProviderAuthMode({
    authMode: provider.options?.authMode,
    baseURL: provider.options?.baseURL,
  }).authMode;
  const authContext = authMode === 'managed-login' ? readUserAuthContext() : undefined;
  if (authMode === 'managed-login' && !authContext?.accessToken) {
    throw new Error(`managed provider ${requested.providerId} requires an auth context`);
  }
  return {
    ...requested,
    modelRef: `${requested.providerId}/${requested.modelId}`,
    runtimeConfig: {
      ...userConfig,
      dataDir: runtimeDataDir,
      permissionMode: 'bypassPermissions',
      defaultModel: `${requested.providerId}/${requested.modelId}`,
      memory: { ...(userConfig.memory ?? {}), enabled: false },
      hooks: { ...(userConfig.hooks ?? {}), enabled: false },
      skillHub: { ...(userConfig.skillHub ?? {}), enabled: false },
      skills: disableExternalSkills(userConfig.skills),
      mcp: { ...(userConfig.mcp ?? {}), nativeToolAllowlist: [] },
    },
    authContext,
  };
}

function baseRuntimeConfig(runtimeDataDir, requested, providers) {
  return {
    dataDir: runtimeDataDir,
    permissionMode: 'bypassPermissions',
    defaultModel: `${requested.providerId}/${requested.modelId}`,
    defaultLightModel: `${requested.providerId}/${requested.modelId}`,
    provider: providers,
    memory: { enabled: false },
    hooks: { enabled: false },
    skillHub: { enabled: false },
    skills: disableExternalSkills(),
    mcp: { nativeToolAllowlist: [] },
  };
}

function disableExternalSkills(rawSkills) {
  const skills = isPlainObject(rawSkills) ? rawSkills : {};
  const external = isPlainObject(skills.external) ? skills.external : {};
  return {
    ...skills,
    external: {
      ...external,
      enabled: false,
    },
  };
}

function buildPlatformApiProvider(apiKey, modelId) {
  return {
    name: 'MiniMax Internal (platform-api)',
    npm: '@ai-sdk/anthropic',
    options: {
      authMode: 'api-key',
      apiKey,
      baseURL: platformApiBaseUrl,
      headers: platformApiSubModule ? { 'X-Sub-Module': platformApiSubModule } : {},
    },
    whitelist: [modelId],
    models: {
      [modelId]: {
        name: modelId,
        attachment: false,
        reasoning: true,
        temperature: true,
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 200000, output: 128000 },
      },
    },
  };
}

function readUserConfig() {
  if (!existsSync(userConfigPath)) {
    throw new Error(`No LLM config; set MAVIS_E2E_LLM_API_KEY or provide ${userConfigPath}`);
  }
  const parsed = yaml.load(readFileSync(userConfigPath, 'utf8'));
  if (!isPlainObject(parsed) || !isPlainObject(parsed.provider)) {
    throw new Error(`Invalid config YAML at ${userConfigPath}`);
  }
  return parsed;
}

function readUserAuthContext() {
  const inline = optionalEnv('MAVIS_E2E_AUTH_CONTEXT_JSON');
  if (inline) return normalizeAuthContext(JSON.parse(inline));
  const token = optionalEnv('MAVIS_E2E_AUTH_ACCESS_TOKEN');
  if (token) return { accessToken: token, source: 'MAVIS_E2E_AUTH_ACCESS_TOKEN' };
  for (const authPath of [
    optionalEnv('MAVIS_E2E_USER_AUTH_PATH'),
    path.join(userDataDir, 'local-runtime.auth.json'),
    path.join(userDataDir, 'auth-cn.json'),
    path.join(userDataDir, 'auth-en.json'),
  ].filter(Boolean)) {
    if (!existsSync(authPath)) continue;
    try {
      const normalized = normalizeAuthContext(JSON.parse(readFileSync(authPath, 'utf8')));
      if (normalized) return { ...normalized, source: authPath };
    } catch {
      // Try the next auth cache.
    }
  }
  return undefined;
}

function normalizeAuthContext(parsed) {
  if (!isPlainObject(parsed)) return undefined;
  const raw = isPlainObject(parsed.auth) ? parsed.auth : parsed;
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  if (!accessToken || isExpiredJwt(accessToken)) return undefined;
  return {
    accessToken,
    ...(typeof raw.realUserID === 'string' ? { realUserID: raw.realUserID } : {}),
    ...(typeof raw.userName === 'string' ? { userName: raw.userName } : {}),
    ...(typeof raw.userEmail === 'string' ? { userEmail: raw.userEmail } : {}),
  };
}

function isExpiredJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
}

function parseRequestedModel() {
  const modelRef = optionalEnv('MAVIS_E2E_LLM_MODEL');
  if (modelRef) return parseModelRef(modelRef);
  const providerId = optionalEnv('MAVIS_E2E_LLM_PROVIDER_ID') || defaultProviderId;
  const modelId = optionalEnv('MAVIS_E2E_LLM_MODEL_ID') || defaultModelId;
  assertSupportedModel(modelId);
  return { providerId, modelId };
}

function parseModelRef(value) {
  const raw = String(value ?? '').trim();
  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1) {
    throw new Error(`model must use provider/model format, got ${raw || '(empty)'}`);
  }
  const providerId = raw.slice(0, slash);
  const requested = raw.slice(slash + 1);
  const modelId =
    supportedModelIds.find((candidate) => candidate.toLowerCase() === requested.toLowerCase()) ||
    requested;
  assertSupportedModel(modelId);
  return { providerId, modelId };
}

function assertSupportedModel(modelId) {
  if (process.env.MAVIS_E2E_ALLOW_UNLISTED_MODEL === '1') return;
  if (!supportedModelIds.includes(modelId)) {
    throw new Error(`unsupported real-agent E2E model: ${modelId}`);
  }
}

function splitSseFrames(buffer) {
  const normalized = buffer.replace(/\r\n/gu, '\n');
  const parts = normalized.split('\n\n');
  return { frames: parts.slice(0, -1), remainder: parts.at(-1) ?? '' };
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return { raw: text };
  }
}

function withEvidence(error, evidence) {
  error.evidence = evidence;
  return error;
}

function errorSummary(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.evidence ? { evidence: error.evidence } : {}),
  };
}

async function writeJson(fileName, value) {
  await writeFile(path.join(runArtifactDir, fileName), `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function collectRepositoryEvidence(buildPaths) {
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const dirtyFiles = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  const trackedDiff = execFileSync('git', ['diff', '--binary', 'HEAD', '--'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const untrackedPaths = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const snapshotHash = createHash('sha256').update('tracked-diff\0').update(trackedDiff);
  const untracked = untrackedPaths.map((relativePath) => {
    const contents = readFileSync(path.join(repoRoot, relativePath));
    const sha256 = createHash('sha256').update(contents).digest('hex');
    snapshotHash.update('\0untracked-path\0').update(relativePath).update('\0').update(contents);
    return { path: relativePath, bytes: contents.byteLength, sha256 };
  });
  return {
    capturedAt: Date.now(),
    gitHead,
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    worktreeSnapshot: {
      sha256: snapshotHash.digest('hex'),
      trackedDiffBytes: trackedDiff.byteLength,
      untracked,
    },
    build: buildPaths.map((relativePath) => {
      const absolutePath = path.join(repoRoot, relativePath);
      if (!existsSync(absolutePath)) return { path: relativePath, exists: false };
      const contents = readFileSync(absolutePath);
      const stat = statSync(absolutePath);
      return {
        path: relativePath,
        exists: true,
        bytes: contents.byteLength,
        mtimeMs: stat.mtimeMs,
        sha256: createHash('sha256').update(contents).digest('hex'),
      };
    }),
  };
}

function findRepoRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot find repository root from ${start}`);
    current = parent;
  }
}

function getShortTmpRoot() {
  return process.platform === 'darwin' && existsSync('/tmp') ? '/tmp' : os.tmpdir();
}

function normalizeBaseUrlForMatch(value) {
  return String(value).trim().replace(/\/+$/gu, '');
}

function readCsvEnv(name) {
  return new Set(
    String(process.env[name] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function readIntEnv(name, fallback) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isUsableApiKey(value) {
  return Boolean(value && !/^(?:sk-?xxx|changeme|placeholder)$/iu.test(value.trim()));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

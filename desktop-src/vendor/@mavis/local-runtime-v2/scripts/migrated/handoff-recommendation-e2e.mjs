#!/usr/bin/env node
// 隔离的 Desktop → Cloud Handoff 真实链路验收。
//
// 本地模型与内容审核走离线 fixture；approve 之后走 cn-test 的真实泳道：
// prepare → artifact/workspace upload → commit → Cloud Session continuation →
// result diff preview → Desktop result sync/download。临时 Local Runtime dataDir 与
// Workspace 用完即删；真实 Cloud Session 验收后归档，下载 ZIP 和脱敏证据保留在 /tmp。
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const authStorePath = process.env.HANDOFF_E2E_AUTH_STORE?.trim();
if (!authStorePath) throw new Error('HANDOFF_E2E_AUTH_STORE is required');

process.env.MAVIS_BUILD_ENV = 'test';
process.env.NEXT_PUBLIC_BUILD_ENV = 'test';
process.env.MAVIS_REGION = 'cn';

const runId = `${Date.now()}`;
const lane = process.env.HANDOFF_E2E_LANE?.trim() || 'session-cloud-handoff';
const cloudBaseUrl = 'https://matrix-test.xaminim.com';
const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const TARGET = 'handoff-output.txt';
const UNRELATED = 'unrelated-notes.md';
const RESULT_MARKER = `CLOUD_HANDOFF_E2E_RESULT_${runId}`;
const QUERY = `请在现有文件 ${TARGET} 中把全部内容替换为以下唯一一行（必须实际修改文件，不要只在回复中复述）：${RESULT_MARKER}。完成文件修改后结束任务。`;
const MARKER = /cloud-session-handoff[^>]*dispatch-id="([^"]+)"/;
const transferBinary = path.join(
  repoRoot,
  'apps/electron/resources/session-transfer/darwin-arm64/mavis-session-transfer-client',
);
const dataDir = await mkdtemp(path.join(os.tmpdir(), `handoff-full-e2e-data-${runId}-`));
const workspaceDir = await mkdtemp(path.join(os.tmpdir(), `handoff-full-e2e-ws-${runId}-`));
const evidenceDir = path.join(os.tmpdir(), `agent-archon-handoff-e2e-${runId}`);
const downloadsDir = path.join(evidenceDir, 'downloads');
await mkdir(downloadsDir, { recursive: true });
process.env.MAVIS_SESSION_TRANSFER_CLIENT = transferBinary;
process.env.MAVIS_SESSION_RESULT_DOWNLOADS_DIR = downloadsDir;

const authStore = JSON.parse(await readFile(authStorePath, 'utf8'));
const accessToken = authStore?.tokens?.accessToken;
const userId = String(authStore?.user?.realUserID ?? authStore?.user?.userID ?? '').trim();
if (typeof accessToken !== 'string' || !accessToken.trim()) throw new Error('Desktop access token missing');
if (!userId) throw new Error('Desktop real user ID missing');
await stat(transferBinary);

const routingHeaders = { 'bedrock-lane': lane, bedrock_lane: lane };
const remoteJson = async (method, pathname, body) => {
  const url = new URL(pathname, cloudBaseUrl);
  if (!url.searchParams.has('user_id')) url.searchParams.set('user_id', userId);
  const response = await fetch(url, {
    method,
    headers: {
      Token: accessToken,
      ...routingHeaders,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (!response.ok) throw new Error(`Cloud HTTP ${response.status} for ${url.pathname}`);
  const statusCode = value?.base_resp?.status_code;
  if (typeof statusCode === 'number' && statusCode !== 0) {
    throw new Error(
      `Cloud business ${statusCode}: ${value?.base_resp?.status_msg ?? value?.base_resp?.status_message ?? 'unknown'}`,
    );
  }
  if (!value || typeof value !== 'object') throw new Error(`Cloud JSON response missing for ${url.pathname}`);
  return value;
};

const eventually = async (name, timeoutMs, probe) => {
  const startedAt = Date.now();
  let lastDetail = 'not ready';
  let nextProgressAt = startedAt;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await probe();
      if (result?.ready) return result.value;
      if (result?.detail) lastDetail = result.detail;
    } catch (error) {
      lastDetail = String(error?.message ?? error);
    }
    if (Date.now() >= nextProgressAt) {
      console.log(`WAIT  ${name} — ${lastDetail}`);
      nextProgressAt = Date.now() + 15_000;
    }
    await sleep(2_000);
  }
  throw new Error(`${name} timeout after ${timeoutMs}ms; last=${lastDetail}`);
};

let sawRecommendationPrompt = false;
let promptIncludedTarget = false;
let promptIncludedQuery = false;
const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const event of events) {
    res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }
  res.end();
};
const textReply = (res, text) =>
  sse(res, [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_fixture',
          type: 'message',
          role: 'assistant',
          model: 'fixture',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 8, output_tokens: 8 },
        },
      },
    },
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 8 },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);

const fixtureServer = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const pathname = new URL(req.url ?? '/', 'http://fixture.invalid').pathname;
    if (pathname === '/mavis/api/v1/content') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"pass":true}');
      return;
    }
    if (pathname === '/v1/messages/count_tokens') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":64}');
      return;
    }
    if (pathname !== '/v1/messages') {
      res.writeHead(404).end();
      return;
    }
    if (body.includes(TARGET) && body.includes('files')) {
      sawRecommendationPrompt = true;
      promptIncludedTarget = true;
      promptIncludedQuery = body.includes(RESULT_MARKER);
      textReply(
        res,
        JSON.stringify({
          files: [{ path: TARGET, reason: '任务明确要求云端修改该文件并产生可下载结果' }],
        }),
      );
      return;
    }
    textReply(res, '收到，交给云端继续。');
  });
});
fixtureServer.listen(0, '127.0.0.1');
await once(fixtureServer, 'listening');
const fixtureBaseUrl = `http://127.0.0.1:${fixtureServer.address().port}`;

await writeFile(path.join(workspaceDir, TARGET), 'BEFORE_CLOUD_HANDOFF\n');
await writeFile(path.join(workspaceDir, UNRELATED), 'unrelated\n');
await writeFile(path.join(workspaceDir, '.env'), 'SECRET=must-never-upload\n');

const providerKey = 'handoff-full-e2e-fixture';
const modelId = 'handoff-full-e2e-model';
const providerId = `custom_provider:${providerKey}`;
const modelRef = `${providerId}/${modelId}`;
const runtime = await import(
  pathToFileURL(path.join(repoRoot, 'packages/local-runtime-v2/dist/index.js'))
);
const clientModule = await import(
  pathToFileURL(path.join(repoRoot, 'packages/thrift-gen/dist/generated/desktop-service/client.js'))
);
const { default: JSZip } = await import('jszip');
const drain = async (opened) => {
  const stream = await opened;
  const frames = stream?.frames ?? stream;
  if (frames?.[Symbol.asyncIterator]) {
    for await (const frame of frames) void frame;
  }
};

let host;
let localSessionId;
let handoffOperationId;
let cloudSessionId;
let cloudResultId;
let cloudSessionArchived = false;
let approveElapsedMs;
let previewDiff = '';
let downloadPath;
let zipEntries = [];
try {
  console.log(`E2E START  lane=${lane} user=${userId} evidence=${evidenceDir}`);
  host = await runtime.createLocalRuntimeHost({
    dataDir,
    runtimeOwnerKind: 'cli',
    runtimeMode: 'clean',
    capabilities: { cliEmbedded: true },
    defaultWorkspaceDir: workspaceDir,
    authContextGetter: () => ({ accessToken, realUserID: userId, source: 'fixture' }),
    routingContextGetter: () => ({ bedrockLane: lane }),
    configGetter: () => ({
      dataDir,
      permissionMode: 'bypassPermissions',
      defaultModel: modelRef,
      defaultLightModel: modelRef,
      provider: {},
      custom_provider: {
        [providerKey]: {
          api: 'anthropic-messages',
          options: {
            authMode: 'api-key',
            apiKey: 'fixture-placeholder',
            baseURL: fixtureBaseUrl,
          },
          models: {
            [modelId]: {
              reasoning: false,
              limit: { context: 200_000, output: 8_000 },
            },
          },
        },
      },
      contentReview: { testBaseURL: fixtureBaseUrl },
      memory: { enabled: false },
      hooks: { enabled: false },
      skillHub: { enabled: false },
      skills: { external: { enabled: false } },
      mcp: { nativeToolAllowlist: [] },
    }),
  });

  const client = clientModule.createDesktopServiceClient({
    baseUrl: 'http://local-runtime.test',
    fetch: (input, init) => host.apiHost.handleRequest(new Request(input, init)),
  });

  const created = await client.createSession({
    name: 'mavis',
    workspaceDir,
    title: `cloud handoff full e2e ${runId}`,
    teamModeOff: true,
    model: { providerId, modelId },
  });
  localSessionId = created.sessionId;
  check('隔离 Local Session 创建成功', typeof localSessionId === 'string' && localSessionId.length > 0, localSessionId);

  await drain(
    client.sendMessage({
      id: localSessionId,
      content: '先完成一个普通 Turn，建立可派发历史。',
      turnId: `turn-seed-${runId}`,
      model: { providerId, modelId },
    }),
  );
  await drain(
    client.sendMessage({
      id: localSessionId,
      content: QUERY,
      turnId: `turn-handoff-${runId}`,
      clientIntent: 'cloud-handoff',
      model: { providerId, modelId },
    }),
  );

  const { messages = [] } = await client.getMessages({ id: localSessionId });
  for (const message of messages) {
    const found = MARKER.exec(String(message?.msgContent ?? ''));
    if (found) handoffOperationId = found[1];
  }
  check('canonical marker 给出稳定 handoff operation ID', Boolean(handoffOperationId), handoffOperationId ?? 'missing');
  if (!handoffOperationId) throw new Error('handoff marker missing');

  const proposalResponse = await client.getSessionHandoffSummary({
    dispatchId: handoffOperationId,
  });
  const proposal = proposalResponse.summary;
  const files = proposal?.files ?? [];
  const targetProposal = files.find((file) => file.relativePath === TARGET);
  const unrelatedProposal = files.find((file) => file.relativePath === UNRELATED);
  check('任务目标文件进入推荐候选', Boolean(targetProposal));
  check('推荐确实经过离线模型', sawRecommendationPrompt);
  check('目标文件进入推荐模型窗口', promptIncludedTarget);
  check('本次 query 进入推荐提示', promptIncludedQuery);
  check('目标文件默认勾选', targetProposal?.selected === true, `selected=${targetProposal?.selected}`);
  check('无关文件不默认勾选', unrelatedProposal?.selected !== true, `selected=${unrelatedProposal?.selected}`);
  check('.env 未进入候选集', !files.some((file) => file.relativePath === '.env'));
  if (!targetProposal?.absolutePath) throw new Error('target proposal absolute path missing');

  const approveStartedAt = Date.now();
  const approved = await client.approveLocalSessionHandoff({
    id: localSessionId,
    dispatchId: handoffOperationId,
    selectedPaths: [targetProposal.absolutePath],
  });
  approveElapsedMs = Date.now() - approveStartedAt;
  check(
    'approve 穿过真实 prepare 并进入上传态',
    approved.uploadState === 2 || approved.uploadState === 3,
    `state=${approved.uploadState} elapsed=${approveElapsedMs}ms`,
  );

  const completedSummary = await eventually('等待 workspace 上传与 commit', 8 * 60_000, async () => {
    const response = await client.getSessionHandoffSummary({ dispatchId: handoffOperationId });
    const summary = response.summary;
    if (!summary) return { ready: false, detail: 'summary missing' };
    if (summary.uploadState === 4 || summary.uploadState === 5) {
      throw new Error(
        `upload terminal state=${summary.uploadState} ${summary.failureCode ?? ''} ${summary.failureMessage ?? ''}`,
      );
    }
    return summary.uploadState === 3 && summary.cloudSessionId
      ? { ready: true, value: summary }
      : { ready: false, detail: `state=${summary.uploadState} cloud=${summary.cloudSessionId ?? 'pending'}` };
  });
  cloudSessionId = completedSummary.cloudSessionId;
  check('prepare/upload/commit 完成并返回真实 Cloud Session', Boolean(cloudSessionId), cloudSessionId);

  const cloudSession = await eventually('等待 Cloud Session 可查询', 2 * 60_000, async () => {
    const response = await remoteJson(
      'GET',
      `/minimax-cloud/api/v1/session/${encodeURIComponent(cloudSessionId)}`,
    );
    const session = response.session;
    return session?.session_id === cloudSessionId
      ? { ready: true, value: session }
      : { ready: false, detail: `session_id=${session?.session_id ?? 'missing'}` };
  });
  check('Cloud Session 已真实落库', cloudSession?.session_id === cloudSessionId, cloudSessionId);

  const turnResult = await eventually('等待 Cloud continuation 与结果变更集', 15 * 60_000, async () => {
    const response = await remoteJson(
      'GET',
      `/minimax-cloud/api/v1/session/${encodeURIComponent(cloudSessionId)}/message?limit=500`,
    );
    const results = response.turn_results ?? response.turnResults ?? [];
    const matching = Array.isArray(results)
      ? results.find((result) => {
          const changes = result?.file_changes ?? result?.fileChanges ?? [];
          return Array.isArray(changes)
            ? changes.some(
                (change) =>
                  (change?.relative_path ?? change?.relativePath) === TARGET &&
                  ['add', 'modify'].includes(String(change?.kind)),
              )
            : false;
        })
      : undefined;
    const messageCount = Array.isArray(response.messages) ? response.messages.length : 0;
    return matching
      ? { ready: true, value: matching }
      : {
          ready: false,
          detail: `messages=${messageCount} turn_results=${Array.isArray(results) ? results.length : 0}`,
        };
  });
  cloudResultId = turnResult.result_id ?? turnResult.resultId;
  const resultChanges = turnResult.file_changes ?? turnResult.fileChanges ?? [];
  const targetResultChange = resultChanges.find(
    (change) => (change?.relative_path ?? change?.relativePath) === TARGET,
  );
  check('Cloud continuation 产生目标文件结果', Boolean(cloudResultId && targetResultChange), cloudResultId);
  if (!cloudResultId || !targetResultChange) throw new Error('target Cloud result missing');

  const listDiffs = await remoteJson(
    'GET',
    `/minimax-cloud/api/v1/session/${encodeURIComponent(cloudSessionId)}/result/${encodeURIComponent(cloudResultId)}/diffs`,
  );
  const listedTarget = (listDiffs.diffs ?? []).find((diff) => diff?.file === TARGET);
  check(
    '结果清单预览包含目标文件',
    Boolean(listedTarget && ['added', 'modified'].includes(String(listedTarget.status))),
    `status=${listedTarget?.status ?? 'missing'}`,
  );

  const preview = await remoteJson(
    'GET',
    `/minimax-cloud/api/v1/session/${encodeURIComponent(cloudSessionId)}/result/${encodeURIComponent(cloudResultId)}/diff?path=${encodeURIComponent(TARGET)}`,
  );
  previewDiff = typeof preview.diff === 'string' ? preview.diff : '';
  check(
    '最终产物 diff 预览含唯一结果标记',
    previewDiff.includes(RESULT_MARKER),
    `preview_state=${preview.preview_state ?? 'unknown'} bytes=${Buffer.byteLength(previewDiff)}`,
  );

  const normalizedKind = String(targetResultChange.kind);
  const downloaded = await client.downloadSessionResult({
    id: cloudSessionId,
    resultId: cloudResultId,
    changes: [
      {
        relativePath: TARGET,
        kind: normalizedKind === 'add' ? 'add' : 'modify',
      },
    ],
  });
  downloadPath = downloaded.downloadPath;
  const downloadedStat = downloadPath ? await stat(downloadPath) : undefined;
  check(
    'Desktop result sync/download 生成真实 ZIP',
    Boolean(downloadPath && downloaded.archive === true && downloadedStat?.size),
    downloadPath ? `${downloadPath} (${downloadedStat?.size ?? 0} bytes)` : 'missing',
  );
  if (!downloadPath) throw new Error('download path missing');

  const zip = await JSZip.loadAsync(await readFile(downloadPath));
  zipEntries = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);
  const targetEntry = zip.file(TARGET) ?? zip.file(zipEntries.find((name) => name.endsWith(`/${TARGET}`)) ?? '');
  const downloadedContent = targetEntry ? await targetEntry.async('string') : '';
  check('下载 ZIP 含目标产物', Boolean(targetEntry), zipEntries.join(', '));
  check(
    '下载产物内容与 Cloud diff 一致',
    downloadedContent.trim() === RESULT_MARKER,
    `content=${JSON.stringify(downloadedContent.trim())}`,
  );

  await remoteJson(
    'POST',
    `/minimax-cloud/api/v1/session/${encodeURIComponent(cloudSessionId)}/archive`,
    { archived: true },
  );
  cloudSessionArchived = true;
  check('验收 Cloud Session 已归档', true, cloudSessionId);

  await writeFile(
    path.join(evidenceDir, 'evidence.json'),
    `${JSON.stringify(
      {
        runId,
        lane,
        userId,
        localSessionId,
        handoffOperationId,
        cloudSessionId,
        cloudResultId,
        approveElapsedMs,
        target: TARGET,
        expectedContent: RESULT_MARKER,
        preview: {
          status: listedTarget?.status,
          previewState: preview.preview_state,
          diff: previewDiff,
        },
        download: {
          path: downloadPath,
          archive: downloaded.archive,
          zipEntries,
          verifiedContent: downloadedContent.trim(),
        },
        cloudSessionArchived,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const detail = String(error?.stack ?? error).slice(0, 2_000);
  check('完整端云 E2E 执行', false, detail);
  await writeFile(
    path.join(evidenceDir, 'failure.json'),
    `${JSON.stringify(
      {
        runId,
        lane,
        userId,
        localSessionId,
        handoffOperationId,
        cloudSessionId,
        cloudResultId,
        approveElapsedMs,
        error: detail,
      },
      null,
      2,
    )}\n`,
  ).catch(() => undefined);
} finally {
  await host?.dispose?.().catch(() => undefined);
  await new Promise((resolve) => fixtureServer.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
  await rm(workspaceDir, { recursive: true, force: true });
}

console.log(`EVIDENCE  ${evidenceDir}`);
console.log(failures.length ? `FAILED: ${failures.join(' | ')}` : 'ALL PASS');
process.exit(failures.length ? 1 : 0);

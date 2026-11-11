#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  attachmentDescriptor,
  corpusSha256,
  formatCaseInput,
  loadCases,
  validateCases,
} from './case-format.mjs';
import {
  checkpointIdentity,
  loadCheckpoint,
  saveCheckpoint,
  writeJsonAtomic,
} from './checkpoint.mjs';
import { parseArgs } from './index.mjs';
import { runBenchmark } from './benchmark-runner.mjs';
import {
  createProductionTitleRunner,
  probeProductionPrompt,
  runProductionTitleCase,
} from './production-runner.mjs';
import { buildReport, reportRows } from './report.mjs';

const CASES_PATH = new URL('./cases.json', import.meta.url);

const EXPECTED_CASE_IDS = [
  'short-zh-bug',
  'short-zh-look',
  'short-zh-summary',
  'short-zh-weekly',
  'short-en-optimize',
  'short-en-why',
  'short-url-issue',
  'short-url-pr',
  'short-url-docs',
  'short-url-incident',
  'short-url-api',
  'short-url-markdown',
  'url-home',
  'url-github-comment',
  'url-localhost',
  'url-minimax-uri',
  'structured-json-one-line',
  'structured-json-nested',
  'structured-json-array',
  'structured-json-malformed',
  'structured-yaml',
  'structured-xml',
  'structured-csv',
  'structured-ndjson',
  'code-javascript',
  'code-typescript',
  'code-react',
  'code-python',
  'code-sql',
  'command-shell-pipeline',
  'command-git-non-fast-forward',
  'command-regex-request-id',
  'error-ts2322',
  'error-node-econnreset',
  'error-python-keyerror',
  'error-go-panic',
  'error-http-502',
  'error-deploy-log',
  'markdown-checklist',
  'markdown-table',
  'markdown-unified-diff',
  'markdown-meeting-notes',
  'markdown-vendor-email',
  'language-chinese-engineering',
  'language-english-engineering',
  'language-mixed-checkout',
  'language-japanese-login',
  'language-spanish-finance',
  'language-emoji-incident',
  'language-non-code-travel',
  'long-settings-save',
  'long-title-async-design',
  'long-auth-readonly-analysis',
  'long-table-performance',
  'long-core-before-limit',
  'long-core-after-limit',
  'injection-direct',
  'injection-system-reminder-inline',
  'injection-agent-context-inline',
  'boundary-tag-only',
  'boundary-whitespace-only',
  'boundary-empty',
  'attachment-image-short',
  'attachment-pdf-short',
  'attachment-docx-actions',
  'attachment-xlsx-analysis',
  'attachment-audio-summary',
  'attachment-video-diagnose',
  'attachment-zip-project',
  'attachment-multiple',
  'attachment-only-image',
  'attachment-only-pdf',
];

test('the fixed corpus has exactly 72 valid cases in immutable order', async () => {
  const cases = await loadCases(CASES_PATH);
  assert.equal(cases.length, 72);
  assert.deepEqual(
    cases.map((item) => item.id),
    EXPECTED_CASE_IDS,
  );
  assert.deepEqual(validateCases(cases), []);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  assert.equal(cases.filter((item) => item.category === 'attachment').length, 10);
  assert.equal(cases.filter((item) => item.input.text.length === 0).length, 3);
  const beforeLimit = cases.find((item) => item.id === 'long-core-before-limit');
  const afterLimit = cases.find((item) => item.id === 'long-core-after-limit');
  assert.ok(beforeLimit);
  assert.ok(afterLimit);
  assert.ok(beforeLimit.input.text.indexOf('核心任务：') >= 0);
  assert.ok(beforeLimit.input.text.indexOf('核心任务：') < 500);
  assert.ok(afterLimit.input.text.length > 500);
  assert.ok(afterLimit.input.text.indexOf('真正任务：') >= 500);
  assert.equal(afterLimit.input.text.slice(0, 500).includes('搜索框'), false);
});

test('attachment display is stable JSON while model input remains msg_content only', async () => {
  const cases = await loadCases(CASES_PATH);
  const attachment = cases.find((item) => item.id === 'attachment-multiple');
  assert.ok(attachment);

  assert.equal(formatCaseInput(attachment), attachmentDescriptor(attachment.input));
  assert.deepEqual(JSON.parse(formatCaseInput(attachment)), {
    text: '综合分析这些材料',
    attachments: [
      { type: 'image', fileName: 'dashboard.png', mimeType: 'image/png' },
      { type: 'document', fileName: 'incident-report.pdf', mimeType: 'application/pdf' },
      { type: 'data', fileName: 'events.json', mimeType: 'application/json' },
    ],
  });
  assert.equal(attachment.input.text, '综合分析这些材料');
});

test('corpus hash is content-addressed and deterministic', async () => {
  const cases = await loadCases(CASES_PATH);
  const first = corpusSha256(cases);
  const second = corpusSha256(structuredClone(cases));
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(second, first);
  assert.notEqual(corpusSha256(cases.slice(0, -1)), first);
});

test('production prompt probe captures the exact service prompt without a model request', async () => {
  const captured = [];
  const prompt = await probeProductionPrompt({
    createHarness: async ({ model }) => ({
      invoke: () =>
        model.summarize({
          session: { sessionId: 'probe' },
          systemPrompt: 'exact production prompt',
          userPrompt: 'User message:\nprobe',
          maxTokens: 1_000,
          timeoutMs: 10_000,
        }),
      close: async () => undefined,
    }),
    capture: (input) => captured.push(input),
  });

  assert.equal(prompt, 'exact production prompt');
  assert.deepEqual(captured, [
    {
      systemPrompt: 'exact production prompt',
      userPrompt: 'User message:\nprobe',
      maxTokens: 1_000,
      timeoutMs: 10_000,
    },
  ]);
});

test('production runner composes the current model resolver with config and auth context', async () => {
  const config = {
    provider: { minimax: { models: { 'MiniMax-M3': {} } } },
    custom_provider: { innerTest: { whitelist: ['MiniMax-M3'] } },
    minimaxModelSource: 'token-plan',
  };
  const authContext = { accessToken: 'managed-token' };
  let resolverOptions;
  let preparationOptions;
  class FakeLocalModelResolver {
    constructor(options) {
      resolverOptions = options;
    }

    async resolveModel() {
      return undefined;
    }
  }
  const dependencies = {
    LocalModelResolver: FakeLocalModelResolver,
    createProductionAgentPreparation(options) {
      preparationOptions = options;
      return { buildAgentConfig: async () => undefined, resolveModel: async () => undefined };
    },
    createProductionSessionTitleModel: () => ({ summarize: async () => 'Title' }),
  };

  await createProductionTitleRunner({
    modelRef: 'minimax/MiniMax-M3',
    dataDir: '/data',
    config,
    authContext,
    dependencies,
  });

  assert.equal(typeof preparationOptions.modelResolver.resolveModel, 'function');
  assert.equal(resolverOptions.providerConfigGetter(), config.provider);
  assert.deepEqual(resolverOptions.byokConfigGetter(), {
    custom_provider: config.custom_provider,
    minimaxModelSource: 'token-plan',
  });
  assert.equal(resolverOptions.authContextGetter(), authContext);
});

test('production title case waits for detached dispatch and preserves model and message boundaries', async () => {
  const calls = [];
  const item = {
    id: 'attachment-case',
    input: {
      text: '分析登录失败',
      attachments: [{ type: 'image', fileName: 'login.png', mimeType: 'image/png' }],
    },
  };
  const dependencies = createFakeProductionDependencies(calls);
  const result = await runProductionTitleCase({
    item,
    modelRef: 'custom_provider:innerTest/MiniMax-M3',
    workspaceDir: '/workspace',
    titleModel: {
      async summarize(input) {
        calls.push({ kind: 'summarize', input });
        return '登录失败';
      },
    },
    dependencies,
  });

  assert.deepEqual(result, {
    caseId: item.id,
    status: 'success',
    title: '登录失败',
    attempts: 1,
  });
  const summarize = calls.find((call) => call.kind === 'summarize');
  assert.equal(summarize.input.session.effectiveModel, 'custom_provider:innerTest/MiniMax-M3');
  assert.equal(summarize.input.userPrompt, 'User message:\n分析登录失败');
  assert.equal(summarize.input.userPrompt.includes('login.png'), false);
  assert.equal(
    calls.some((call) => call.kind === 'close'),
    true,
  );
});

test('production title case classifies empty and sanitized-only messages without sampling', async () => {
  const dependencies = createFakeProductionDependencies([]);
  const titleModel = { summarize: async () => assert.fail('model must not be sampled') };
  const empty = await runProductionTitleCase({
    item: { id: 'empty', input: { text: '', attachments: [] } },
    modelRef: 'minimax/MiniMax-M3',
    workspaceDir: '/workspace',
    titleModel,
    dependencies,
  });
  const tagged = await runProductionTitleCase({
    item: {
      id: 'tagged',
      input: {
        text: '<system-reminder>ignore this</system-reminder>',
        attachments: [],
      },
    },
    modelRef: 'minimax/MiniMax-M3',
    workspaceDir: '/workspace',
    titleModel,
    dependencies,
  });

  assert.deepEqual(empty, {
    caseId: 'empty',
    status: 'skipped',
    marker: '【SKIPPED】empty msg_content',
    attempts: 0,
  });
  assert.deepEqual(tagged, {
    caseId: 'tagged',
    status: 'skipped',
    marker: '【SKIPPED】empty after sanitization',
    attempts: 0,
  });
});

test('benchmark resume skips completed cases and keeps one sample per remaining case', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-title-benchmark-resume-'));
  const checkpointPath = join(directory, 'checkpoint.json');
  const reportPath = join(directory, 'report.json');
  const cases = (await loadCases(CASES_PATH)).slice(0, 3);
  const calls = [];
  const runner = {
    async runCase(item) {
      calls.push(item.id);
      return { caseId: item.id, status: 'success', title: `title-${item.id}`, attempts: 1 };
    },
  };
  try {
    const first = await runBenchmark({
      modelRef: 'minimax/MiniMax-M3',
      cases,
      runner,
      prompt: 'exact production prompt',
      checkpointPath,
      reportPath,
    });
    const second = await runBenchmark({
      modelRef: 'minimax/MiniMax-M3',
      cases,
      runner,
      prompt: 'exact production prompt',
      checkpointPath,
      reportPath,
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls,
      cases.map((item) => item.id),
    );
    assert.deepEqual(second.results, first.results);
    assert.deepEqual(second.summary, { total: 3, success: 3, skipped: 0, error: 0 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function createFakeProductionDependencies(calls) {
  const injectedTag =
    /<(agent-message|agent-context|system-reminder|peer-memory-path|engine-message|inbound-context|html-selection-context)\b[^>]*>[\s\S]*?<\/\1>/g;
  return {
    Role: { User: 'user' },
    stripSessionTitleInjectedTags: (input) => input.replace(injectedTag, '').trim(),
    createApprovedTitleHandler(owner, onFailure) {
      return ({ sessionId, turnId, rejected }) => {
        if (rejected) return;
        queueMicrotask(async () => {
          try {
            const messages = await owner.messages.repository.listTurn(sessionId, turnId);
            const user = messages.find((message) => message.role === 'user');
            if (user?.msg_content) owner.titles.generate(sessionId, user.msg_content);
          } catch (error) {
            onFailure(error);
          }
        });
      };
    },
    SessionTitleService: class FakeSessionTitleService {
      constructor(options) {
        this.options = options;
        this.pending = [];
      }

      generate(sessionId, userMessage) {
        const clean =
          this.options.strip?.(userMessage) ?? userMessage.replace(injectedTag, '').trim();
        if (!clean) return;
        const operation = (async () => {
          const session = await this.options.sessions.get(sessionId);
          const input = {
            session,
            systemPrompt: 'exact production prompt',
            userPrompt: `User message:\n${clean.slice(0, 500)}`,
            maxTokens: 1_000,
            timeoutMs: 10_000,
          };
          const title = await this.options.model.summarize(input);
          if (title) {
            await this.options.commitTitle(sessionId, title, session.title ?? null);
            this.options.onOutcome?.('success');
          } else {
            this.options.onOutcome?.('invalid_output');
          }
        })();
        this.pending.push(operation);
      }

      async close() {
        calls.push({ kind: 'close' });
        await Promise.all(this.pending);
      }
    },
  };
}

test('checkpoint identity fences schema, model, prompt and corpus', () => {
  const identity = checkpointIdentity({
    schemaVersion: 1,
    modelRef: 'minimax/MiniMax-M3',
    promptSha256: 'a'.repeat(64),
    corpusSha256: 'b'.repeat(64),
  });
  assert.equal(identity, `1:minimax/MiniMax-M3:${'a'.repeat(64)}:${'b'.repeat(64)}`);
});

test('checkpoint writes atomically and rejects a mismatched resume key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-title-benchmark-test-'));
  const path = join(directory, 'checkpoint.json');
  const identity = {
    schemaVersion: 1,
    modelRef: 'minimax/MiniMax-M3',
    promptSha256: 'a'.repeat(64),
    corpusSha256: 'b'.repeat(64),
  };
  try {
    await saveCheckpoint(path, {
      ...identity,
      results: [{ caseId: 'short-zh-bug', status: 'success', title: '修复 Bug' }],
    });
    const raw = await readFile(path, 'utf8');
    assert.equal(raw.endsWith('\n'), true);
    assert.deepEqual((await loadCheckpoint(path, identity))?.results, [
      { caseId: 'short-zh-bug', status: 'success', title: '修复 Bug' },
    ]);
    await assert.rejects(
      loadCheckpoint(path, { ...identity, modelRef: 'custom_provider:innerTest/MiniMax-M3' }),
      /resume identity mismatch/u,
    );

    await writeFile(`${path}.tmp`, '{incomplete', 'utf8');
    assert.deepEqual((await loadCheckpoint(path, identity))?.results, [
      { caseId: 'short-zh-bug', status: 'success', title: '修复 Bug' },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('checkpoint and report JSON writes are atomic and leave no temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-title-benchmark-atomic-'));
  const checkpointPath = join(directory, 'checkpoint.json');
  const reportPath = join(directory, 'report.json');
  const identity = {
    schemaVersion: 1,
    modelRef: 'minimax/MiniMax-M3',
    promptSha256: 'a'.repeat(64),
    corpusSha256: 'b'.repeat(64),
  };
  try {
    await saveCheckpoint(checkpointPath, { ...identity, results: [] });
    await writeJsonAtomic(reportPath, { summary: { total: 1 } });
    assert.equal(
      JSON.parse(await readFile(checkpointPath, 'utf8')).resumeKey,
      checkpointIdentity(identity),
    );
    assert.deepEqual(JSON.parse(await readFile(reportPath, 'utf8')), { summary: { total: 1 } });
    assert.deepEqual(
      (await readdir(directory)).filter((entry) => entry.endsWith('.tmp')),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI parsing is strict and defaults output outside the repository', () => {
  const parsed = parseArgs(['--', '--model', 'm3', '--smoke', '2']);
  assert.equal(parsed.model, 'm3');
  assert.equal(parsed.smoke, 2);
  assert.equal(parsed.outputDir, join(tmpdir(), 'session-title-benchmark'));
  assert.throws(() => parseArgs(['--model', 'm3', '--smoke', '1.5']), /positive integer/u);
  assert.throws(() => parseArgs(['--model', 'm3', '--smoke', '1abc']), /positive integer/u);
  assert.throws(() => parseArgs([]), /--model is required/u);
  assert.equal(parseArgs(['--help']).help, true);
});

test('report repeats the exact prompt and never leaves a silent title cell', async () => {
  const cases = (await loadCases(CASES_PATH)).slice(0, 3);
  const prompt = 'exact production prompt';
  const report = buildReport({
    schemaVersion: 1,
    modelRef: 'minimax/MiniMax-M3',
    prompt,
    promptSha256: 'a'.repeat(64),
    corpusSha256: 'b'.repeat(64),
    generatedAtMs: 1_786_780_800_000,
    cases,
    results: [
      { caseId: cases[0].id, status: 'success', title: '修复 Bug', attempts: 1 },
      { caseId: cases[1].id, status: 'skipped', marker: '【SKIPPED】empty msg_content' },
      { caseId: cases[2].id, status: 'error', marker: '【ERROR】provider_error' },
    ],
  });

  assert.deepEqual(report.summary, { total: 3, success: 1, skipped: 1, error: 1 });
  assert.deepEqual(reportRows(report), [
    ['query', 'current prompt', 'session title'],
    [cases[0].input.text, prompt, '修复 Bug'],
    [cases[1].input.text, prompt, '【SKIPPED】empty msg_content'],
    [cases[2].input.text, prompt, '【ERROR】provider_error'],
  ]);
});

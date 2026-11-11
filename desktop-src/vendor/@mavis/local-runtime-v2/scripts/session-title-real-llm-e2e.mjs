#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { streamSimple } from '@earendil-works/pi-ai';
import { LocalModelResolver, isManagedProviderBaseUrl } from '../src/service/model-system/resolution/local-model-resolver.js';

import { DatabaseClient } from '../dist/infra/db/client.js';
import { initializeDatabase } from '../dist/infra/db/initialize.js';
import {
  SessionTitleModelAdapter,
  SessionTitleService,
  createNativeSessionRecordService,
  createSessionRepository,
} from '../dist/service/session-system/index.js';

const CASES = new Set(['managed', 'byok-unsupported']);
const NOT_RUN_EXIT_CODE = 1;
const secrets = new Set();

class NotRunError extends Error {}

try {
  const selectedCase = parseCase(process.argv.slice(2));
  const config = readCaseConfig(selectedCase);
  await runCase(selectedCase, config);
} catch (error) {
  if (error instanceof NotRunError) {
    console.error(`[NOT RUN] ${sanitize(error.message)}`);
    process.exitCode = NOT_RUN_EXIT_CODE;
  } else {
    console.error(`[FAIL] ${sanitize(errorMessage(error))}`);
    process.exitCode = 1;
  }
}

async function runCase(selectedCase, config) {
  const dataDir = await mkdtemp(join(tmpdir(), 'local-runtime-v2-title-real-e2e-'));
  const database = new DatabaseClient({ dataDir });
  try {
    await initializeDatabase({ database, dataDir });
    const sessions = createSessionRepository({ db: database.db });
    const sessionId = `mvs_title_real_${randomUUID().replaceAll('-', '')}`;
    await sessions.create({
      sessionId,
      agentName: 'main',
      workspaceDir: join(dataDir, 'workspace'),
      runtime: 'pi-agent',
      title: null,
    });

    const facts = [];
    const records = createNativeSessionRecordService({
      sessionRepository: sessions,
      agentDirectory: {
        get: async () => ({ defaultWorkspaceDir: join(dataDir, 'workspace') }),
      },
      titlePolicy: { blocks: async () => false },
      artifacts: { initialize: async () => undefined, delete: async () => undefined },
      facts: { handle: (fact) => facts.push(fact) },
      defaultWorkspaceDir: () => join(dataDir, 'workspace'),
    });
    const resolver = createResolver(selectedCase, config);
    const model = new SessionTitleModelAdapter({
      buildAgentConfig: async () => ({
        system_prompt: 'This Agent prompt must not become title context.',
        model: { provider: config.providerId, model_id: config.modelId },
        tools: [],
        skills: [],
      }),
      resolveModel: async (input) => {
        const resolved = await resolver.resolveModel(input);
        return {
          model: resolved.model,
          ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
          ...(resolved.headers ? { headers: resolved.headers } : {}),
        };
      },
      stream: (resolvedModel, context, options) =>
        streamSimple(
          resolvedModel,
          {
            systemPrompt: context.systemPrompt,
            messages: context.messages.map((message) => ({ ...message })),
            ...(context.tools ? { tools: [...context.tools] } : {}),
          },
          options,
        ),
    });
    const outcomes = [];
    const failures = [];
    const titles = new SessionTitleService({
      sessions,
      commitTitle: async (targetSessionId, title, expectedTitle) => {
        const updated = await records.mutateSession(
          targetSessionId,
          { title, titleSource: 'auto' },
          undefined,
          { title: expectedTitle, source: 'default' },
        );
        facts.push({ kind: 'title-updated', session: updated, title });
      },
      model,
      onOutcome: (outcome) => outcomes.push(outcome),
      onFailure: ({ stage, error }) => failures.push({ stage, error }),
    });

    await titles.generateTitle(
      sessionId,
      'Please fix the login redirect after password reset and summarize this task.',
    );
    const stored = await sessions.get(sessionId);
    if (!stored) throw new Error('real title E2E Session disappeared');

    if (selectedCase === 'managed') {
      if (!stored.title) {
        throw new Error(
          `managed structured title was not persisted; outcome=${outcomes.at(-1) ?? 'none'} failure=${failureSummary(failures)}`,
        );
      }
      if (outcomes.at(-1) !== 'success') {
        throw new Error(`managed title ended with unexpected outcome=${outcomes.at(-1) ?? 'none'}`);
      }
      if (!facts.some((fact) => fact.kind === 'title-updated')) {
        throw new Error('managed title bypassed the Session lifecycle fact boundary');
      }
      console.log(
        `[PASS] session-title real managed: ${config.providerId}/${config.modelId} returned and persisted one structured title`,
      );
      return;
    }

    if (stored.title !== null) {
      throw new Error(
        'BYOK unsupported-model case unexpectedly produced a title; use a model without tool calling',
      );
    }
    const outcome = outcomes.at(-1);
    if (outcome !== 'provider_error' && outcome !== 'invalid_output') {
      throw new Error(
        `BYOK unsupported-model case ended with unexpected outcome=${outcome ?? 'none'}`,
      );
    }
    if (facts.some((fact) => fact.kind === 'title-updated')) {
      throw new Error('BYOK unsupported-model case emitted a title update');
    }
    console.log(
      `[PASS] session-title real byok-unsupported: ${config.providerId}/${config.modelId} failed closed without a title`,
    );
  } finally {
    database.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

function createResolver(selectedCase, config) {
  const managed = selectedCase === 'managed';
  return new LocalModelResolver({
    providerConfig: {
      [config.providerId]: {
        options: managed
          ? { authMode: 'managed-login', baseURL: config.baseURL }
          : { authMode: 'api-key', apiKey: config.apiKey, baseURL: config.baseURL },
        models: {
          [config.modelId]: {
            modalities: { input: ['text'], output: ['text'] },
            tool_call: managed,
          },
        },
      },
    },
    defaultApi: config.api,
    ...(managed
      ? {
          authContextGetter: () => ({
            accessToken: config.accessToken,
            ...optionalIdentity('MAVIS_E2E_AUTH_REAL_USER_ID', 'realUserID'),
            ...optionalIdentity('MAVIS_E2E_AUTH_USER_NAME', 'userName'),
            ...optionalIdentity('MAVIS_E2E_AUTH_USER_EMAIL', 'userEmail'),
          }),
        }
      : {}),
  });
}

function readCaseConfig(selectedCase) {
  const missing = [];
  const baseURL = requiredEnv('MAVIS_E2E_LLM_BASE_URL', missing);
  const model = readModelSelection(missing);
  const api = optionalEnv('MAVIS_E2E_LLM_API') || 'anthropic-messages';
  const credentialName =
    selectedCase === 'managed' ? 'MAVIS_E2E_AUTH_ACCESS_TOKEN' : 'MAVIS_E2E_LLM_API_KEY';
  const credential = requiredEnv(credentialName, missing);
  if (missing.length > 0) {
    throw new NotRunError(
      `session-title real ${selectedCase}: missing ${[...new Set(missing)].join(', ')}`,
    );
  }

  const parsedURL = parseProviderURL(baseURL, selectedCase);
  if (selectedCase === 'managed') {
    const accessToken = credential;
    secrets.add(accessToken);
    if (isExpiredJwt(accessToken)) {
      throw new NotRunError('session-title real managed: MAVIS_E2E_AUTH_ACCESS_TOKEN is expired');
    }
    if (!isManagedProviderBaseUrl(parsedURL.href)) {
      throw new NotRunError(
        'session-title real managed: MAVIS_E2E_LLM_BASE_URL is not a known managed provider URL',
      );
    }
    return { ...model, api, baseURL: parsedURL.href, accessToken };
  }

  const apiKey = credential;
  secrets.add(apiKey);
  if (looksLikePlaceholder(apiKey)) {
    throw new NotRunError(
      'session-title real byok-unsupported: MAVIS_E2E_LLM_API_KEY looks like a placeholder',
    );
  }
  if (isManagedProviderBaseUrl(parsedURL.href)) {
    throw new NotRunError(
      'session-title real byok-unsupported: MAVIS_E2E_LLM_BASE_URL points at managed login',
    );
  }
  return { ...model, api, baseURL: parsedURL.href, apiKey };
}

function readModelSelection(missing) {
  const modelRef = optionalEnv('MAVIS_E2E_LLM_MODEL');
  if (modelRef) {
    const separator = modelRef.indexOf('/');
    if (separator <= 0 || separator === modelRef.length - 1) {
      throw new NotRunError('MAVIS_E2E_LLM_MODEL must use provider/model format');
    }
    return {
      providerId: modelRef.slice(0, separator),
      modelId: modelRef.slice(separator + 1),
    };
  }
  return {
    providerId: requiredEnv('MAVIS_E2E_LLM_PROVIDER_ID', missing),
    modelId: requiredEnv('MAVIS_E2E_LLM_MODEL_ID', missing),
  };
}

function parseCase(args) {
  if (args.length !== 2 || args[0] !== '--case' || !CASES.has(args[1])) {
    throw new NotRunError(
      'usage: session-title-real-llm-e2e.mjs --case <managed|byok-unsupported>',
    );
  }
  return args[1];
}

function parseProviderURL(value, selectedCase) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      throw new Error('URL credentials are forbidden');
    }
    return parsed;
  } catch {
    throw new NotRunError(
      `session-title real ${selectedCase}: MAVIS_E2E_LLM_BASE_URL must be an absolute URL without credentials`,
    );
  }
}

function requiredEnv(name, missing) {
  const value = optionalEnv(name);
  if (!value) missing.push(name);
  return value;
}

function optionalEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function optionalIdentity(envName, field) {
  const value = optionalEnv(envName);
  return value ? { [field]: value } : {};
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

function looksLikePlaceholder(value) {
  return /^(?:sk-?x+|placeholder|replace[-_ ]?me)$/iu.test(value);
}

function failureSummary(failures) {
  return failures.length === 0
    ? 'none'
    : failures.map(({ stage, error }) => `${stage}:${errorName(error)}`).join(',');
}

function errorName(error) {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sanitize(value) {
  let sanitized = String(value);
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, '***');
  }
  return sanitized;
}

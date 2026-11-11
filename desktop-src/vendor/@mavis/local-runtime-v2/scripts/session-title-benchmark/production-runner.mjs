import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { sha256 } from './case-format.mjs';

const PROBE_TEXT = 'probe';
const EMPTY_MESSAGE_MARKER = '【SKIPPED】empty msg_content';
const EMPTY_SANITIZED_MARKER = '【SKIPPED】empty after sanitization';

export async function probeProductionPrompt(options = {}) {
  const captured = [];
  const capture = (input) => {
    captured.push(input);
    options.capture?.(input);
  };
  const model = {
    async summarize(input) {
      capture({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
      });
      return 'Probe';
    },
  };
  const createHarness = options.createHarness ?? createPromptProbeHarness;
  const harness = await createHarness({ model });
  try {
    await harness.invoke(PROBE_TEXT);
  } finally {
    await harness.close();
  }
  const prompt = captured[0]?.systemPrompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('production prompt probe did not capture a system prompt');
  }
  return prompt;
}

export async function createProductionTitleRunner(options) {
  const dependencies = options.dependencies ?? (await loadProductionDependencies());
  const dataDir = options.dataDir ?? dependencies.getPrimaryDataDirPath();
  const config =
    options.config ?? dependencies.loadConfigFromFile(join(dataDir, 'config.yaml'), { dataDir });
  const authContext = options.authContext ?? dependencies.readLocalRuntimeAuthContext(dataDir);
  const modelResolver = new dependencies.LocalModelResolver({
    providerConfigGetter: () => config.provider,
    byokConfigGetter: () => ({
      ...(config.minimax_api ? { minimax_api: config.minimax_api } : {}),
      ...(config.custom_provider ? { custom_provider: config.custom_provider } : {}),
      ...(config.minimaxModelSource ? { minimaxModelSource: config.minimaxModelSource } : {}),
    }),
    authContextGetter: () => authContext,
  });
  const preparation = dependencies.createProductionAgentPreparation({
    configBuilder: {
      config: () => config,
      skills: {
        listRuntimeSkills: async () => ({ skills: [] }),
        renderCatalog: async () => '',
      },
    },
    modelResolver,
  });
  const titleModel = dependencies.createProductionSessionTitleModel({
    agents: {
      getExecutionSnapshot: async (agentName) => ({ agentName, systemPrompt: '' }),
    },
    preparation,
  });

  return {
    modelRef: options.modelRef,
    dataDir,
    async runCase(item) {
      return runProductionTitleCase({
        item,
        modelRef: options.modelRef,
        titleModel,
        dependencies,
        workspaceDir: options.workspaceDir ?? process.cwd(),
      });
    },
  };
}

export async function runProductionTitleCase(options) {
  const { item, modelRef, titleModel, dependencies } = options;
  const userText = item.input.text;
  if (userText.length === 0) {
    return { caseId: item.id, status: 'skipped', marker: EMPTY_MESSAGE_MARKER, attempts: 0 };
  }

  const sessionId = `sess_title_benchmark_${randomUUID()}`;
  const turnId = `turn_title_benchmark_${randomUUID()}`;
  const nowMs = Date.now();
  let session = {
    sessionId,
    agentName: 'mavis',
    workspaceDir: options.workspaceDir,
    runtime: 'pi-agent',
    sessionType: 'branch',
    sessionKind: 'conversation',
    archived: false,
    status: 'idle',
    title: null,
    effectiveModel: modelRef,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  let attempts = 0;
  let outcome;
  let failureStage;
  const dispatched = createDeferred();
  const service = new dependencies.SessionTitleService({
    sessions: {
      get: async (requestedSessionId) => (requestedSessionId === sessionId ? session : undefined),
    },
    commitTitle: async (requestedSessionId, title) => {
      if (requestedSessionId !== sessionId) throw new Error('synthetic session not found');
      session = { ...session, title, updatedAtMs: Date.now() };
    },
    model: {
      summarize: async (input) => {
        attempts += 1;
        return titleModel.summarize(input);
      },
    },
    onOutcome: (value) => {
      outcome = value;
    },
    onFailure: ({ stage }) => {
      failureStage = stage;
    },
  });
  const owner = {
    messages: {
      repository: {
        listTurn: async (requestedSessionId, requestedTurnId) => {
          if (requestedSessionId !== sessionId || requestedTurnId !== turnId) {
            throw new Error('unexpected synthetic turn lookup');
          }
          return [
            {
              role: dependencies.Role.User,
              msg_content: userText,
              attachments: item.input.attachments,
            },
          ];
        },
      },
    },
    titles: {
      generate(requestedSessionId, titleSource) {
        service.generate(requestedSessionId, titleSource);
        dispatched.resolve();
      },
    },
  };
  const approved = dependencies.createApprovedTitleHandler(owner, () => {
    dispatched.reject(new Error('session title source resolution failed'));
  });

  approved({ sessionId, turnId, rejected: false });
  await dispatched.promise;
  await service.close();

  if (typeof session.title === 'string' && session.title.length > 0) {
    return { caseId: item.id, status: 'success', title: session.title, attempts };
  }
  if (!dependencies.stripSessionTitleInjectedTags(userText)) {
    return { caseId: item.id, status: 'skipped', marker: EMPTY_SANITIZED_MARKER, attempts };
  }
  const category = outcome ?? (failureStage ? `${failureStage}_error` : 'unknown_error');
  return {
    caseId: item.id,
    status: 'error',
    marker: `【ERROR】${category}`,
    attempts,
  };
}

export function promptIdentity(prompt) {
  return { prompt, promptSha256: sha256(prompt) };
}

async function createPromptProbeHarness({ model }) {
  const { SessionTitleService } = await import('../../dist/service/session-system/index.js');
  let session = {
    sessionId: 'session-title-prompt-probe',
    agentName: 'mavis',
    workspaceDir: process.cwd(),
    runtime: 'pi-agent',
    sessionType: 'branch',
    sessionKind: 'conversation',
    archived: false,
    status: 'idle',
    title: null,
    effectiveModel: 'minimax/MiniMax-M3',
    createdAtMs: 0,
    updatedAtMs: 0,
  };
  const service = new SessionTitleService({
    sessions: { get: async () => session },
    commitTitle: async (_sessionId, title) => {
      session = { ...session, title };
    },
    model,
  });
  return {
    invoke: (text = PROBE_TEXT) => service.generateTitle(session.sessionId, text),
    close: () => service.close(),
  };
}

async function loadProductionDependencies() {
  const [config, protocol, sessionSystem, turnSystem, modelSystem, messageDelivery] =
    await Promise.all([
      import('@mavis/config'),
      import('@mavis/agent-core/protocol'),
      import('../../dist/service/session-system/index.js'),
      import('../../dist/service/turn-system/index.js'),
      import('../../dist/service/model-system/index.js'),
      import('../../dist/application/session/turn-message-delivery.js'),
    ]);
  return {
    getPrimaryDataDirPath: config.getPrimaryDataDirPath,
    loadConfigFromFile: config.loadConfigFromFile,
    readLocalRuntimeAuthContext: config.readLocalRuntimeAuthContext,
    Role: protocol.Role,
    SessionTitleService: sessionSystem.SessionTitleService,
    stripSessionTitleInjectedTags: sessionSystem.stripSessionTitleInjectedTags,
    createProductionAgentPreparation: turnSystem.createProductionAgentPreparation,
    createProductionSessionTitleModel: turnSystem.createProductionSessionTitleModel,
    LocalModelResolver: modelSystem.LocalModelResolver,
    createApprovedTitleHandler: messageDelivery.createApprovedTitleHandler,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

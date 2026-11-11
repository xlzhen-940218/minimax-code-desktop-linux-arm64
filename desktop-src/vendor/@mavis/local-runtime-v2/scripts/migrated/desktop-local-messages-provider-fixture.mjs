import { once } from 'node:events';
import { createServer } from 'node:http';

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export async function startDesktopLocalMessagesProviderFixture(options) {
  const revisions = new Map(options.revisions.map((revision) => [revision.label, revision]));
  const requestFacts = [];
  const network = { allowedFetches: 0, blockedFetches: 0 };
  const server = createServer((request, response) => {
    void handleRequest({ request, response, revisions, requestFacts });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Desktop local Messages fixture did not bind a TCP port');
  }

  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const restoreNetworkGuard = installNetworkGuard(baseUrl, network);
  let closed = false;
  return {
    baseUrl,
    facts() {
      return {
        requests: requestFacts.map((fact) => structuredClone(fact)),
        network: { ...network },
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      restoreNetworkGuard();
      server.closeIdleConnections?.();
      server.close();
      await once(server, 'close');
    },
  };
}

async function handleRequest(input) {
  try {
    const body = await readBoundedBody(input.request);
    const path = new URL(input.request.url ?? '/', 'http://desktop-fixture.invalid').pathname;
    if (path === '/mavis/api/v1/content') {
      input.requestFacts.push({ kind: 'content_safety' });
      sendJson(input.response, { pass: true });
      return;
    }
    if (path === '/v1/messages/count_tokens') {
      input.requestFacts.push({ kind: 'count_tokens' });
      sendJson(input.response, { input_tokens: 64 });
      return;
    }
    if (path !== '/v1/messages') {
      input.requestFacts.push({ kind: 'unsupported_path' });
      input.response.writeHead(404).end();
      return;
    }

    const parsed = JSON.parse(body);
    const revision = detectRevision(JSON.stringify(parsed?.system ?? ''), input.revisions);
    const skillProbe = detectSkillProbe(parsed, input.revisions);
    const skillReadAdmission = detectSkillReadAdmission(parsed);
    input.requestFacts.push(
      safeRequestFact(
        parsed,
        revision,
        input.revisions,
        input.request.headers,
        skillProbe,
        skillReadAdmission,
      ),
    );
    if (skillProbe && skillReadAdmission === undefined) {
      sendSkillToolUseSse(input.response, skillProbe.skillName);
      return;
    }
    sendMessagesSse(input.response, revision?.token ?? 'DESKTOP_LOCAL_FIXTURE_AUXILIARY_OK');
  } catch {
    input.response.writeHead(400).end();
  }
}

async function readBoundedBody(request) {
  let body = '';
  let size = 0;
  request.setEncoding('utf8');
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_REQUEST_BYTES) throw new Error('Desktop local Messages request exceeded limit');
    body += chunk;
  }
  return body;
}

function detectRevision(system, revisions) {
  for (const revision of revisions.values()) {
    if (system.includes(revision.token)) return revision;
  }
  return undefined;
}

function detectSkillProbe(parsed, revisions) {
  const messages = JSON.stringify(parsed?.messages ?? []);
  for (const revision of revisions.values()) {
    if (messages.includes(revision.skillName)) return revision;
  }
  return undefined;
}

function detectSkillReadAdmission(parsed) {
  for (const message of [...(parsed?.messages ?? [])].reverse()) {
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block?.type !== 'tool_result') continue;
      const result = JSON.stringify(block.content ?? '');
      if (result.includes('Local skill not found:')) return 'denied';
      if (result.includes('# Skill:')) return 'allowed';
      return 'unknown';
    }
  }
  return undefined;
}

function safeRequestFact(
  parsed,
  revision,
  revisions,
  headers,
  skillProbe,
  skillReadAdmission,
) {
  const safeTools = new Set(['grep', 'read', 'skill', 'write']);
  const allToolNames = Array.isArray(parsed?.tools)
    ? parsed.tools.map((tool) => tool?.name).filter((name) => typeof name === 'string')
    : [];
  const expectedModels = new Map(
    Array.from(revisions.values(), (entry) => [entry.modelId, entry.label]),
  );
  const system = JSON.stringify(parsed?.system ?? '');
  return {
    kind: 'messages',
    revision: revision?.label ?? 'NONE',
    modelRevision:
      revision?.modelId === parsed?.model
        ? revision.label
        : (expectedModels.get(parsed?.model) ?? 'OTHER'),
    maxTokens: Number.isSafeInteger(parsed?.max_tokens) ? parsed.max_tokens : null,
    thinkingType: typeof parsed?.thinking?.type === 'string' ? parsed.thinking.type : 'omitted',
    knownToolNames: allToolNames.filter((name) => safeTools.has(name)).sort(),
    unexpectedToolCount: allToolNames.filter((name) => !safeTools.has(name)).length,
    markdownHeadingMatched: revision ? system.includes(revision.markdownHeading) : false,
    selectedSkillMatched: revision ? system.includes(revision.skillName) : false,
    skillReadAdmission:
      skillReadAdmission ?? (skillProbe === undefined ? 'none' : 'requested'),
    credentialHeaderPresent:
      typeof headers.authorization === 'string' || typeof headers['x-api-key'] === 'string',
  };
}

function sendSkillToolUseSse(response, skillName) {
  const toolUseId = 'toolu_desktop_local_skill_probe';
  const events = [
    messageStartEvent(),
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: toolUseId, name: 'skill', input: {} },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify({ name: skillName }) },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    messageDeltaEvent('tool_use'),
    { event: 'message_stop', data: { type: 'message_stop' } },
  ];
  sendSse(response, events);
}

function sendJson(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function sendMessagesSse(response, text) {
  const events = [
    messageStartEvent(),
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
    messageDeltaEvent('end_turn'),
    { event: 'message_stop', data: { type: 'message_stop' } },
  ];
  sendSse(response, events);
}

function messageStartEvent() {
  return {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg-desktop-local-fixture',
        type: 'message',
        role: 'assistant',
        model: 'desktop-local-fixture',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 64, output_tokens: 0 },
      },
    },
  };
}

function messageDeltaEvent(stopReason) {
  return {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
  };
}

function sendSse(response, events) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(
    `${events
      .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}`)
      .join('\n\n')}\n\n`,
  );
}

function installNetworkGuard(baseUrl, network) {
  const allowedOrigin = new URL(baseUrl).origin;
  const originalFetch = globalThis.fetch;
  const guardedFetch = (input, init) => {
    let origin;
    try {
      const url = input instanceof Request ? input.url : String(input);
      origin = new URL(url).origin;
    } catch {
      network.blockedFetches += 1;
      return Promise.reject(new Error('Desktop local Messages fixture blocked a non-local fetch'));
    }
    if (origin !== allowedOrigin) {
      network.blockedFetches += 1;
      return Promise.reject(new Error('Desktop local Messages fixture blocked a non-local fetch'));
    }
    network.allowedFetches += 1;
    return originalFetch.call(globalThis, input, init);
  };
  globalThis.fetch = guardedFetch;
  return () => {
    if (globalThis.fetch === guardedFetch) globalThis.fetch = originalFetch;
  };
}

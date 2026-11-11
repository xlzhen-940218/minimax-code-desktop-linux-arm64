#!/usr/bin/env node
/**
 * Real-LLM smoke for the Feishu/Lark link -> lark-cli routing rule.
 *
 * This checks the prompt/skill behavior that cannot be proven with a mock:
 * when the user pastes a bare Feishu document/wiki URL, the agent should route
 * to lark-cli docs +fetch via lark-tools, not generic webfetch. The prompt asks
 * the model to describe its plan instead of executing commands, so the smoke
 * needs a working LLM provider but no live Feishu credentials.
 *
 * Usage:
 *   MAVIS_BASE_URL=http://127.0.0.1:<local-runtime-port> \
 *     [MAVIS_E2E_AGENT=mavis] \
 *     [MAVIS_E2E_TIMEOUT_MS=180000] \
 *     [MAVIS_API_PREFIX=/mavis/api] \
 *     node packages/local-runtime-v2/scripts/migrated/lark-link-routing-llm-smoke.mjs
 */

const baseUrl = (process.env.MAVIS_BASE_URL ?? '').replace(/\/$/u, '');
if (!baseUrl) {
  console.error('MAVIS_BASE_URL is required; target an isolated local-runtime instance.');
  process.exit(2);
}

const apiPrefix = `/${(process.env.MAVIS_API_PREFIX ?? '/mavis/api').replace(/^\/+|\/+$/gu, '')}`;
const agentName = process.env.MAVIS_E2E_AGENT ?? 'mavis';
const timeoutMs = Number(process.env.MAVIS_E2E_TIMEOUT_MS ?? 180_000);
const modelInput = process.env.MAVIS_E2E_MODEL ?? '';
const selectedCaseIds = new Set(
  (process.env.MAVIS_E2E_CASES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

function endpoint(path) {
  return `${baseUrl}${apiPrefix}${path}`;
}

async function api(method, path, body) {
  const url = endpoint(path);
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  }
  return payload;
}

async function createSession() {
  const body = { teamModeOff: true };
  if (modelInput) body.model = modelInput;
  const payload = await api('POST', `/agent/${agentName}/session`, body);
  if (!payload?.sessionId) {
    throw new Error(`createSession returned no sessionId: ${JSON.stringify(payload)}`);
  }
  return payload.sessionId;
}

async function sendAndDrain(sessionId, prompt) {
  const url = endpoint(`/session/${sessionId}/message`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: prompt }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`POST ${url} failed: ${response.status} ${text}`);
    }
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('"finish_reason":"stop"')) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAssistantText(sessionId) {
  const response = await fetch(endpoint(`/session/${sessionId}/message`));
  if (!response.ok) {
    throw new Error(`GET session messages failed: ${response.status}`);
  }
  const payload = await response.json();
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages
    .filter((message) => message?.role === 'assistant' && typeof message?.msg_content === 'string')
    .map((message) => message.msg_content)
    .join('\n');
}

const cases = [
  {
    id: 'bare-feishu-docx-link',
    description: 'Bare /docx/ link should route to lark-cli docs +fetch, not webfetch.',
    prompt: [
      '帮我读一下这个文档讲了啥：https://vrfi1sk8a0.feishu.cn/docx/AsGkdg3vIo3OXexLvoScdUV1nUf',
      '先别真的去执行命令或抓取，只用文字告诉我：你打算用什么工具/命令来读它，为什么。',
    ].join('\n'),
  },
  {
    id: 'bare-feishu-wiki-link',
    description: 'Bare /wiki/ link should route to lark-cli docs +fetch, not webfetch.',
    prompt: [
      '这个链接里的内容能帮我总结下吗？https://vrfi1sk8a0.feishu.cn/wiki/Tk9qwxYZ123abcDEf456ghIJkl',
      '现在先不要真的抓取，只用文字说明你会用哪个工具或命令去拿到正文，理由是什么。',
    ].join('\n'),
  },
  {
    id: 'lark-feishu-docx-routes-to-lark-cli',
    description:
      'Desktop/local real-agent-style docx prompt should choose lark-cli document routing, not webfetch.',
    prompt: [
      '你正在跑本地 real-agent 工具路由 E2E。请读取这个飞书文档链接并总结正文：',
      'https://vrfi1sk8a0.feishu.cn/docx/AsGkdg3vIo3OXexLvoScdUV1nUf',
      '这是工具路由测试：先不要真的调用外部命令，只用文字说明你会用哪个工具/命令获取正文以及原因。',
    ].join('\n'),
  },
];

const affirmativeWebfetchPatterns = [
  /(?:会|要|打算|plan to|will)\s*(?:用|通过|use)\s*webfetch\s*(?:去|来|to)?\s*(?:抓|读|获取|总结|fetch|read|grab)/iu,
  /webfetch\s*(?:抓|读|获取|fetch|read)\s*(?:这个|the)?\s*(?:feishu|lark|飞书)?/iu,
];
const negationOrContrast =
  /(不会|不能|不该|不应|不需要|不用|不要|无需|别用|而不是|不是|反爬|广告|垃圾|噪音|拿不到|anti-?bot|won't|will not|don't|do not|not\s+use|instead of|rather than)/iu;
const canonicalPatterns = [
  /lark-cli/iu,
  /docs\s*\+fetch/iu,
  /\+fetch/iu,
  /lark-tools/iu,
  /lark-doc/iu,
  /飞书.*(?:skill|命令行|cli|工具)/iu,
  /用\s*lark/iu,
];

function matchingAffirmativeLines(lines, patterns, skipPattern = negationOrContrast) {
  const matches = [];
  for (const pattern of patterns) {
    for (const line of lines) {
      if (!pattern.test(line)) continue;
      if (skipPattern.test(line)) continue;
      matches.push(line.trim());
      break;
    }
  }
  return matches;
}

function evaluate(responseText) {
  const failures = [];
  const lines = responseText.split(/\r?\n/u);
  const webfetchLines = matchingAffirmativeLines(lines, affirmativeWebfetchPatterns);
  if (webfetchLines.length > 0) {
    failures.push(`planned webfetch for Feishu link: ${webfetchLines.join(' | ')}`);
  }
  const canonicalMatches = canonicalPatterns.filter((pattern) => pattern.test(responseText));
  if (canonicalMatches.length === 0) {
    failures.push('no lark-cli / docs +fetch / lark skill routing found');
  }
  return { failures, canonicalMatches, webfetchLines };
}

async function runCase(testCase) {
  console.log(`\n> ${testCase.id}`);
  console.log(`  ${testCase.description}`);
  const sessionId = await createSession();
  console.log(`  session=${sessionId}`);

  await sendAndDrain(sessionId, testCase.prompt);
  const responseText = await fetchAssistantText(sessionId);
  const summary = evaluate(responseText);
  console.log(`  response: ${responseText.slice(0, 500)}...`);
  console.log(`  canonical matches: ${summary.canonicalMatches.length}`);
  console.log(`  affirmative webfetch matches: ${summary.webfetchLines.length}`);
  return { id: testCase.id, sessionId, responseText, failures: summary.failures };
}

async function main() {
  console.log(`lark-link-routing smoke against ${baseUrl} (agent=${agentName})`);
  const activeCases =
    selectedCaseIds.size === 0 ? cases : cases.filter((testCase) => selectedCaseIds.has(testCase.id));
  if (activeCases.length === 0) {
    throw new Error(`No lark-link-routing cases matched MAVIS_E2E_CASES=${[...selectedCaseIds].join(',')}`);
  }
  const results = [];
  for (const testCase of activeCases) {
    // Sequential by design: this is a real-LLM routing smoke.
    // eslint-disable-next-line no-await-in-loop
    results.push(await runCase(testCase));
  }
  const failed = results.filter((result) => result.failures.length > 0);
  console.log('\nSummary');
  for (const result of results) {
    if (result.failures.length === 0) {
      console.log(`PASS ${result.id}`);
    } else {
      console.log(`FAIL ${result.id}`);
      for (const failure of result.failures) console.log(`  - ${failure}`);
    }
  }
  if (failed.length > 0) {
    console.error(`${failed.length}/${results.length} cases failed`);
    process.exit(1);
  }
  console.log(`All ${results.length} selected cases passed.`);
}

main().catch((error) => {
  console.error('Uncaught failure:', error);
  process.exit(1);
});

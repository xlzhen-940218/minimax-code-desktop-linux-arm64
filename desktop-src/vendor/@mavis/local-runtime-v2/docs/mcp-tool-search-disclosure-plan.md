# MCP 工具渐进式披露 (v2) Implementation Plan

MCP 继续使用本文的 `mcp_invoke` 链路；内置按需工具复用同一入口，设计见 [Cron 工具拆分与按需加载](../../../.harness/docs/specs/deferred-cron-tools-design.md)。

> 维护状态：本资料迁入 local-runtime-v2，保留原渐进式披露方案与历史实施步骤。
> 标题中的 v2 是 MCP 方案版本，不等于 Local Runtime V2 的 service 布局。
> 下方「历史执行计划」中的旧路径、安装/测试/commit 命令及工作流要求已归档，不是当前待执行任务；
> 当前实现入口与 focused test 命令以本页「当前 v2 维护入口」为准。本轮未执行测试。

**Goal:** 当自定义 MCP 工具定义体积超过上下文窗口阈值且模型在白名单内时，把这些工具从模型 `tools` 与 system prompt 中完全移除，改由常驻 `tool_search`（regex + BM25 检索，支持中文）与 `mcp_invoke`（free-form `tool_name` 调用）按需披露与执行（桌面端 local-runtime 首发 + runtime 无关核心）。

**Architecture:** runtime 无关核心放 `packages/agent-tools/src/mcp-disclosure/`（纯函数/工厂：`tokenize` 分词、`buildIndex` 倒排+BM25、`planMcpDisclosure` 门控、`createToolSearchTool`、`createMcpInvokeTool`、`renderMcpToolSearchHintBlock`）。当前 local-runtime-v2 由 Model System 提供 model 身份与 `contextWindow`，Turn System 的 `buildLocalTurnToolCatalog` 按 plan 塑形 tools、生成提示并发送诊断事件，MCP service 保留工具来源。旧 `host.runTurnToStream` / `buildLocalTurnRuntimeTools` 仅保留在历史步骤中。不改 pi-agent-core。设计依据：[MCP 工具渐进式披露设计](mcp-tool-search-disclosure-design.md)。

**Tech Stack:** TypeScript（ESM，import 用 `.js` 后缀）、pnpm workspace、vitest、`@sinclair/typebox`（`Type` + `Value`）、`@mavis/agent-core/tools`（`defineRuntimeTool` / `RuntimeTool` / `ToolDefinition` / `ToolResult` / `ToolExecutionContext`）。

---

## 当前 v2 维护入口

| 职责 | 当前路径 |
| --- | --- |
| MCP 门控、索引、检索、调用与提示核心 | `packages/agent-tools/src/mcp-disclosure/` |
| MCP 来源枚举 | `packages/local-runtime-v2/src/service/mcp/tools/runtime-tools.ts` |
| Turn 工具塑形、配置默认值、提示与诊断 | `packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts` |
| 模型身份与窗口 | `packages/local-runtime-v2/src/service/model-system/resolution/local-model-resolver.ts` |

从仓库根目录按改动范围选择相关文件验证（以下命令本轮未执行）：

```bash
node scripts/test/focused-vitest.mjs --package @mavis/agent-tools test/mcp-disclosure/plan.test.ts test/mcp-disclosure/search-index.test.ts test/mcp-disclosure/tokenize.test.ts test/mcp-disclosure/tool-search.test.ts test/mcp-disclosure/mcp-invoke.test.ts test/mcp-disclosure/hint.test.ts
node scripts/test/focused-vitest.mjs --package @mavis/local-runtime-v2 src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.test.ts test/integration/mcp/runtime-tool-entries.integration.test.ts
```

需要产出 runtime dist 时使用 `pnpm --filter @mavis/local-runtime-v2 build`。
历史 E2E 和真实模型步骤只保留验收语义，不构成当前本地门禁；真实端到端验收由外部 webhook 承担。

## 历史执行计划（以下全部归档）

以下仓库约定、File Structure、Task 0–13 与代码示例是当时的实施记录。
旧 `packages/local-runtime/src`、`packages/local-runtime/test`、`@mavis/local-runtime` 命令和
`api/host.ts` 执行链已退役；旧 E2E、分支基线、全量安装/测试、changelog、trailer 及
sub-skill 要求不适用于当前维护。保留这些内容用于理解原决策，勿按未勾选清单重新实施。
当前工作流以仓库 `AGENTS.md` 为准。

### 当时的仓库约定

- 分支：`feat/mcp-tool-search-disclosure`（已从最新 `origin/dev` 切，worktree `.worktrees/feat-mcp-tool-search-disclosure`）。
- commit message 用英文、conventional（`feat(scope): ...` / `test(scope): ...`）；**禁止任何 AI 署名/归因**。
- 代码变更需在同分支更新 `changelogs/<YYYY-MM-DD>.md` 当前分支段，并在 push 前补 `Unit-Test:` / `E2E:` trailer（per-task 本地 commit 可省，MR push 前补齐；遵循 `.harness/skills/mr-workflow/SKILL.md`）。
- 不主动 push / 建 MR，等用户指示。
- 测试 first：每个 Task 先写失败测试，再实现。

---

## File Structure

新增（`packages/agent-tools/src/mcp-disclosure/`，runtime 无关）：

| 文件 | 职责 |
| --- | --- |
| `types.ts` | `McpToolEntry` / `McpDisclosureOptions` / `McpModelIdentity` / `McpDisclosurePlan` / `McpToolIndex` / `McpSearchHit` |
| `tokenize.ts` | `tokenize(text)` 中英文混合分词（英文 camel/snake + CJK unigram/bigram） |
| `index.ts`（注意：与 barrel 重名，改名 `search-index.ts`） | `buildIndex(candidates, opts)` 倒排 + BM25 + regex 过滤 + signature |
| `plan.ts` | `planMcpDisclosure(input)` + `modelInWhitelist` |
| `tool-search.ts` | `createToolSearchTool(index, opts)` |
| `mcp-invoke.ts` | `createMcpInvokeTool(registry)` |
| `hint.ts` | `renderMcpToolSearchHintBlock()` |
| `mcp-disclosure.ts`（barrel） | 统一导出，挂到 `packages/agent-tools/src/index.ts` |

改动（local-runtime）：`mcp/runtime-tools.ts`、`api/local-native-tools.ts`、`api/host.ts`、`config/types.ts` + 配置读取。

测试：`packages/agent-tools/test/mcp-disclosure/*.test.ts`、`packages/local-runtime/test/unit/mcp/*.test.ts`、一个真 E2E。

---

## Task 0: Worktree 环境初始化

**Files:** 无（环境）

- [ ] **Step 1: 确认在任务 worktree 内**

Run: `cd /Users/minimax/projects/agent-archon/.worktrees/feat-mcp-tool-search-disclosure && git status --short --branch`
Expected: `## feat/mcp-tool-search-disclosure...origin/dev`，无未跟踪业务文件（仅本 plan/design 文档）。

- [ ] **Step 2: 安装依赖并构建 runtime 包**

Run: `pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile`
Run: `bash scripts/dev-runtime.sh --once`
Expected: 安装完成、`config`/`shared`/`protocol`/`agent-core`/`local-runtime` 等包产出 `dist`。

- [ ] **Step 3: 基线测试可跑**

Run: `pnpm --filter @mavis/agent-tools test -- --run 2>&1 | tail -5`
Expected: 现有测试通过（或已知基线），确认 vitest 工作。

---

## Task 1: 类型定义（`types.ts`）

**Files:**
- Create: `packages/agent-tools/src/mcp-disclosure/types.ts`

无运行时测试（纯类型），用编译校验。

- [ ] **Step 1: 写类型文件**

```ts
import type { RuntimeTool, ToolDefinition } from '@mavis/agent-core/tools';

export type McpToolSource = 'builtin-matrix' | 'builtin' | 'configured';

export interface McpToolEntry {
  readonly tool: RuntimeTool;
  readonly source: McpToolSource;
}

export interface McpModelIdentity {
  readonly provider: string;
  readonly id: string;
  readonly contextWindow: number;
}

export interface McpDisclosureOptions {
  readonly enabled: boolean;
  readonly modelWhitelist: readonly string[];
  readonly thresholdPct: number;
  readonly minDeferCount: number;
  readonly topKDefault: number;
  readonly topKMax: number;
  readonly systemHint: boolean;
  readonly maxSchemaTextLen: number;
  readonly estimateTokens?: (def: ToolDefinition) => number;
}

export interface McpSearchHit {
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
  readonly score: number;
}

export interface McpToolIndex {
  search(input: { query?: string; regex?: string; topK: number }): McpSearchHit[];
  readonly size: number;
  readonly signature: string;
}

export interface McpDisclosureStats {
  readonly candidateCount: number;
  readonly indexedCount: number;
  readonly estTokens: number;
  readonly thresholdTokens: number;
}

export type McpDisclosurePlan =
  | { readonly deferred: false; readonly inlineTools: readonly RuntimeTool[] }
  | {
      readonly deferred: true;
      readonly inlineTools: readonly RuntimeTool[];
      readonly deferredRegistry: ReadonlyMap<string, RuntimeTool>;
      readonly index: McpToolIndex;
      readonly systemHintBlock?: string;
      readonly stats: McpDisclosureStats;
    };
```

- [ ] **Step 2: 编译校验**

Run: `pnpm --filter @mavis/agent-tools exec tsc --noEmit`
Expected: 无类型错误（若现有 tsconfig 不支持单包 noEmit，改用 `pnpm --filter @mavis/agent-tools build`）。

- [ ] **Step 3: Commit**

```bash
git add packages/agent-tools/src/mcp-disclosure/types.ts
git commit -m "feat(agent-tools): add mcp-disclosure v2 types"
```

---

## Task 2: 分词器 `tokenize`（中英文混合）

**Files:**
- Create: `packages/agent-tools/src/mcp-disclosure/tokenize.ts`
- Test: `packages/agent-tools/test/mcp-disclosure/tokenize.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/mcp-disclosure/tokenize.js';

describe('tokenize', () => {
  it('splits camelCase and lowercases', () => {
    expect(tokenize('createIssue')).toEqual(['create', 'issue']);
  });
  it('splits snake_case and kebab', () => {
    expect(tokenize('web_search-v2')).toEqual(['web', 'search', 'v2']);
  });
  it('splits letter/digit boundary', () => {
    expect(tokenize('s3Bucket')).toEqual(['s', '3', 'bucket']);
  });
  it('emits CJK unigrams and bigrams', () => {
    expect(tokenize('东京')).toEqual(['东', '京', '东京']);
  });
  it('handles mixed CJK + latin', () => {
    expect(tokenize('创建Issue')).toEqual(['创', '建', '创建', 'issue']);
  });
  it('drops punctuation/whitespace', () => {
    expect(tokenize('  a, b  ')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/tokenize`
Expected: FAIL（`tokenize` 未定义 / 模块不存在）。

- [ ] **Step 3: 实现**

```ts
const HAN = /\p{Script=Han}/u;
const RUN_RE = /[A-Za-z0-9]+|\p{Script=Han}+/gu;

function splitIdentifier(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const runs = text.match(RUN_RE) ?? [];
  for (const run of runs) {
    if (HAN.test(run)) {
      for (let i = 0; i < run.length; i++) {
        out.push(run[i]!);
        if (i + 1 < run.length) out.push(run[i]! + run[i + 1]!);
      }
    } else {
      for (const sub of splitIdentifier(run)) out.push(sub.toLowerCase());
    }
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/tokenize`
Expected: PASS（6 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools/src/mcp-disclosure/tokenize.ts packages/agent-tools/test/mcp-disclosure/tokenize.test.ts
git commit -m "feat(agent-tools): add CJK-aware tokenizer for mcp tool search"
```

---

## Task 3: 检索索引 `buildIndex`（BM25 + regex + signature）

**Files:**
- Create: `packages/agent-tools/src/mcp-disclosure/search-index.ts`
- Test: `packages/agent-tools/test/mcp-disclosure/search-index.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool } from '@mavis/agent-core/tools';
import { buildIndex } from '../../src/mcp-disclosure/search-index.js';
import type { McpToolEntry } from '../../src/mcp-disclosure/types.js';

function entry(name: string, description: string, props: Record<string, unknown> = {}): McpToolEntry {
  const tool = defineRuntimeTool({
    name,
    description,
    schema: Type.Object(props as never),
    execute: async () => ({ tool_name: name, text: '', content: [{ type: 'text', text: '' }] }),
  });
  return { tool, source: 'configured' };
}

const entries: McpToolEntry[] = [
  entry('jira_create_issue', 'Create a Jira issue in a project', { project: Type.String(), title: Type.String() }),
  entry('github_create_pr', 'Open a GitHub pull request', { repo: Type.String(), branch: Type.String() }),
  entry('weather_today', '查询今天的天气', { city: Type.String() }),
];

describe('buildIndex', () => {
  it('BM25 ranks the most relevant tool first (English)', () => {
    const idx = buildIndex(entries, { maxSchemaTextLen: 4096 });
    const hits = idx.search({ query: 'create jira issue', topK: 3 });
    expect(hits[0]!.name).toBe('jira_create_issue');
  });
  it('BM25 works for Chinese query', () => {
    const idx = buildIndex(entries, { maxSchemaTextLen: 4096 });
    const hits = idx.search({ query: '天气', topK: 3 });
    expect(hits[0]!.name).toBe('weather_today');
  });
  it('regex hard-filters by name/description/schema text', () => {
    const idx = buildIndex(entries, { maxSchemaTextLen: 4096 });
    const hits = idx.search({ regex: '^github_', topK: 5 });
    expect(hits.map((h) => h.name)).toEqual(['github_create_pr']);
  });
  it('regex + query: filter then rank', () => {
    const idx = buildIndex(entries, { maxSchemaTextLen: 4096 });
    const hits = idx.search({ regex: 'create', query: 'pull request', topK: 5 });
    expect(hits[0]!.name).toBe('github_create_pr');
  });
  it('returns full input_schema on hits', () => {
    const idx = buildIndex(entries, { maxSchemaTextLen: 4096 });
    const hit = idx.search({ query: 'jira', topK: 1 })[0]!;
    expect((hit.input_schema as { properties: Record<string, unknown> }).properties).toHaveProperty('project');
  });
  it('signature is stable for same set and changes when schema changes', () => {
    const a = buildIndex(entries, { maxSchemaTextLen: 4096 }).signature;
    const b = buildIndex(entries, { maxSchemaTextLen: 4096 }).signature;
    expect(a).toBe(b);
    const changed = buildIndex([entry('jira_create_issue', 'different desc')], { maxSchemaTextLen: 4096 }).signature;
    expect(changed).not.toBe(a);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/search-index`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
import type { ToolDefinition } from '@mavis/agent-core/tools';
import { tokenize } from './tokenize.js';
import type { McpToolEntry, McpToolIndex, McpSearchHit } from './types.js';

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function flattenSchema(schema: unknown, max: number): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.description === 'string') parts.push(o.description);
    if (Array.isArray(o.enum)) parts.push(o.enum.map(String).join(' '));
    if (Array.isArray(o.required)) parts.push(o.required.map(String).join(' '));
    if (o.properties && typeof o.properties === 'object') {
      for (const [k, v] of Object.entries(o.properties as Record<string, unknown>)) {
        parts.push(k);
        walk(v);
      }
    }
    if (o.items) walk(o.items);
  };
  walk(schema);
  return parts.join(' ').slice(0, max);
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface Doc {
  name: string;
  description: string;
  input_schema: unknown;
  raw: string;
  tokens: string[];
  len: number;
  tf: Map<string, number>;
}

export function buildIndex(
  candidates: readonly McpToolEntry[],
  opts: { maxSchemaTextLen: number },
): McpToolIndex {
  const docs: Doc[] = candidates.map((e) => {
    const def: ToolDefinition = e.tool.def;
    const schemaText = flattenSchema(def.schema, opts.maxSchemaTextLen);
    const raw = `${def.name} ${def.description ?? ''} ${schemaText}`;
    const tokens = tokenize(raw);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { name: def.name, description: def.description ?? '', input_schema: def.schema, raw, tokens, len: tokens.length, tf };
  });

  const N = docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const avgdl = N === 0 ? 0 : docs.reduce((s, d) => s + d.len, 0) / N;
  const idf = (t: string): number => {
    const n = df.get(t) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  const signature = fnv1a(
    [...candidates]
      .map((e) => `${e.tool.def.name}:${fnv1a(JSON.stringify(e.tool.def.schema ?? {}))}:${fnv1a(e.tool.def.description ?? '')}`)
      .sort()
      .join('|'),
  );

  function bm25(queryTokens: string[], d: Doc): number {
    let score = 0;
    for (const qt of new Set(queryTokens)) {
      const f = d.tf.get(qt) ?? 0;
      if (f === 0) continue;
      const denom = f + BM25_K1 * (1 - BM25_B + (BM25_B * d.len) / (avgdl || 1));
      score += idf(qt) * ((f * (BM25_K1 + 1)) / denom);
    }
    return score;
  }

  function search(input: { query?: string; regex?: string; topK: number }): McpSearchHit[] {
    let pool = docs;
    if (input.regex) {
      const re = new RegExp(input.regex, 'i'); // 调用方负责捕获非法 regex
      pool = pool.filter((d) => re.test(d.raw));
    }
    let scored: { d: Doc; score: number }[];
    if (input.query && input.query.trim()) {
      const qt = tokenize(input.query);
      scored = pool.map((d) => ({ d, score: bm25(qt, d) })).filter((x) => x.score > 0);
      if (scored.length === 0 && !input.regex) return [];
    } else {
      // 仅 regex：按 name 长度/字典序给个稳定序
      scored = pool.map((d) => ({ d, score: 1 }));
    }
    scored.sort((a, b) => b.score - a.score || a.d.name.localeCompare(b.d.name));
    return scored.slice(0, Math.max(0, input.topK)).map(({ d, score }) => ({
      name: d.name,
      description: d.description,
      input_schema: d.input_schema,
      score,
    }));
  }

  return { search, size: N, signature };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/search-index`
Expected: PASS（6 用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools/src/mcp-disclosure/search-index.ts packages/agent-tools/test/mcp-disclosure/search-index.test.ts
git commit -m "feat(agent-tools): add BM25 + regex search index for mcp tools"
```

---

## Task 4: 规划器 `planMcpDisclosure` + `modelInWhitelist`

**Files:**
- Create: `packages/agent-tools/src/mcp-disclosure/plan.ts`
- Test: `packages/agent-tools/test/mcp-disclosure/plan.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool } from '@mavis/agent-core/tools';
import { planMcpDisclosure, modelInWhitelist } from '../../src/mcp-disclosure/plan.js';
import type { McpToolEntry, McpDisclosureOptions, McpModelIdentity, McpToolSource } from '../../src/mcp-disclosure/types.js';

const BIG = 'x'.repeat(8000); // 让单工具估算 token 较大
function mk(name: string, source: McpToolSource, desc = ''): McpToolEntry {
  const tool = defineRuntimeTool({
    name, description: desc,
    schema: Type.Object({ a: Type.String({ description: desc }) }),
    execute: async () => ({ tool_name: name, text: '', content: [{ type: 'text', text: '' }] }),
  });
  return { tool, source };
}
const model: McpModelIdentity = { provider: 'minimax', id: 'MiniMax-M3', contextWindow: 200_000 };
const baseOpts: McpDisclosureOptions = {
  enabled: true, modelWhitelist: ['minimax/*'], thresholdPct: 0.15, minDeferCount: 1,
  topKDefault: 5, topKMax: 20, systemHint: true, maxSchemaTextLen: 4096,
  estimateTokens: () => 50_000, // 强制超阈（50k > 0.15*200k=30k）
};

describe('modelInWhitelist', () => {
  it('exact / prefix / glob / empty', () => {
    expect(modelInWhitelist('minimax', 'MiniMax-M3', ['minimax/MiniMax-M3'])).toBe(true);
    expect(modelInWhitelist('minimax', 'model-x', ['minimax/*'])).toBe(true);
    expect(modelInWhitelist('openai', 'gpt', ['minimax/*'])).toBe(false);
    expect(modelInWhitelist('x', 'y', [])).toBe(false);
  });
});

describe('planMcpDisclosure', () => {
  it('defers only configured tools; matrix/builtin inline', () => {
    const entries = [mk('cfg1', 'configured'), mk('cfg2', 'configured'), mk('mx', 'builtin-matrix'), mk('b', 'builtin')];
    const plan = planMcpDisclosure({ entries, model, options: baseOpts });
    expect(plan.deferred).toBe(true);
    if (!plan.deferred) throw new Error('expected deferred');
    expect(plan.inlineTools.map((t) => t.def.name).sort()).toEqual(['b', 'mx']);
    expect([...plan.deferredRegistry.keys()].sort()).toEqual(['cfg1', 'cfg2']);
    expect(plan.stats.candidateCount).toBe(2);
  });
  it('not whitelisted -> inline all', () => {
    const entries = [mk('cfg1', 'configured')];
    const plan = planMcpDisclosure({ entries, model: { ...model, provider: 'openai' }, options: baseOpts });
    expect(plan.deferred).toBe(false);
    expect(plan.inlineTools.length).toBe(1);
  });
  it('disabled -> inline all', () => {
    const plan = planMcpDisclosure({ entries: [mk('cfg1', 'configured')], model, options: { ...baseOpts, enabled: false } });
    expect(plan.deferred).toBe(false);
  });
  it('below threshold -> inline all', () => {
    const plan = planMcpDisclosure({ entries: [mk('cfg1', 'configured')], model, options: { ...baseOpts, estimateTokens: () => 10 } });
    expect(plan.deferred).toBe(false);
  });
  it('below minDeferCount -> inline all', () => {
    const plan = planMcpDisclosure({ entries: [mk('cfg1', 'configured')], model, options: { ...baseOpts, minDeferCount: 2 } });
    expect(plan.deferred).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/plan`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
import type { RuntimeTool, ToolDefinition } from '@mavis/agent-core/tools';
import { buildIndex } from './search-index.js';
import type { McpDisclosureOptions, McpDisclosurePlan, McpModelIdentity, McpToolEntry } from './types.js';

export function modelInWhitelist(provider: string, id: string, list: readonly string[]): boolean {
  const key = `${provider}/${id}`;
  return list.some((pat) => {
    if (pat === '*' || pat === key) return true;
    if (!pat.includes('*')) return false;
    const re = new RegExp('^' + pat.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(key);
  });
}

function defaultEstimate(def: ToolDefinition): number {
  return Math.ceil(JSON.stringify({ name: def.name, description: def.description, schema: def.schema }).length / 4);
}

export function planMcpDisclosure(input: {
  entries: readonly McpToolEntry[];
  model: McpModelIdentity;
  options: McpDisclosureOptions;
}): McpDisclosurePlan {
  const { entries, model, options } = input;
  const allTools: RuntimeTool[] = entries.map((e) => e.tool);
  const inlineAll = (): McpDisclosurePlan => ({ deferred: false, inlineTools: allTools });

  if (!options.enabled) return inlineAll();
  if (!modelInWhitelist(model.provider, model.id, options.modelWhitelist)) return inlineAll();

  const candidates = entries.filter((e) => e.source === 'configured');
  const estimate = options.estimateTokens ?? defaultEstimate;
  const estTokens = candidates.reduce((s, e) => s + estimate(e.tool.def), 0);
  const thresholdTokens = options.thresholdPct * model.contextWindow;

  if (candidates.length < options.minDeferCount || estTokens <= thresholdTokens) return inlineAll();

  const inlineTools = entries.filter((e) => e.source !== 'configured').map((e) => e.tool);
  const index = buildIndex(candidates, { maxSchemaTextLen: options.maxSchemaTextLen });
  const deferredRegistry = new Map<string, RuntimeTool>(candidates.map((e) => [e.tool.def.name, e.tool]));

  return {
    deferred: true,
    inlineTools,
    deferredRegistry,
    index,
    stats: { candidateCount: candidates.length, indexedCount: index.size, estTokens, thresholdTokens },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/plan`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools/src/mcp-disclosure/plan.ts packages/agent-tools/test/mcp-disclosure/plan.test.ts
git commit -m "feat(agent-tools): add planMcpDisclosure with model whitelist + source gating"
```

---

## Task 5: `tool_search` 工具

**Files:**
- Create: `packages/agent-tools/src/mcp-disclosure/tool-search.ts`
- Test: `packages/agent-tools/test/mcp-disclosure/tool-search.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool } from '@mavis/agent-core/tools';
import { buildIndex } from '../../src/mcp-disclosure/search-index.js';
import { createToolSearchTool } from '../../src/mcp-disclosure/tool-search.js';
import type { McpToolEntry } from '../../src/mcp-disclosure/types.js';

const e = (name: string, desc: string): McpToolEntry => ({
  tool: defineRuntimeTool({ name, description: desc, schema: Type.Object({ a: Type.String() }), execute: async () => ({ tool_name: name, text: '', content: [{ type: 'text', text: '' }] }) }),
  source: 'configured',
});
const idx = buildIndex([e('jira_create_issue', 'create issue'), e('gh_pr', 'pull request')], { maxSchemaTextLen: 4096 });
const ctx = { sessionId: 's', turnId: 't', toolCallId: 'c' } as never;

describe('tool_search tool', () => {
  it('returns hits with full schema for a query', async () => {
    const tool = createToolSearchTool(idx, { topKDefault: 5, topKMax: 20 });
    const res = await tool.impl.execute(ctx, { query: 'jira issue' }, undefined);
    const payload = JSON.parse(res.text) as { hits: { name: string }[]; total: number };
    expect(payload.hits[0]!.name).toBe('jira_create_issue');
  });
  it('errors when neither query nor regex given', async () => {
    const tool = createToolSearchTool(idx, { topKDefault: 5, topKMax: 20 });
    const res = await tool.impl.execute(ctx, {}, undefined);
    expect(res.isError).toBe(true);
  });
  it('errors on invalid regex (no throw)', async () => {
    const tool = createToolSearchTool(idx, { topKDefault: 5, topKMax: 20 });
    const res = await tool.impl.execute(ctx, { regex: '(' }, undefined);
    expect(res.isError).toBe(true);
  });
  it('clamps top_k to topKMax', async () => {
    const tool = createToolSearchTool(idx, { topKDefault: 5, topKMax: 1 });
    const res = await tool.impl.execute(ctx, { query: 'create pull issue request', top_k: 99 }, undefined);
    const payload = JSON.parse(res.text) as { hits: unknown[] };
    expect(payload.hits.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/tool-search`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool, type RuntimeTool } from '@mavis/agent-core/tools';
import type { McpToolIndex } from './types.js';

export function createToolSearchTool(
  index: McpToolIndex,
  opts: { topKDefault: number; topKMax: number },
): RuntimeTool {
  const schema = Type.Object({
    query: Type.Optional(Type.String({ description: 'Keyword search (BM25, supports Chinese) over tool name/description/params.' })),
    regex: Type.Optional(Type.String({ description: 'Regex filter over tool name/description/schema text (case-insensitive).' })),
    top_k: Type.Optional(Type.Number({ description: `Max results (default ${opts.topKDefault}, max ${opts.topKMax}).` })),
  });
  const err = (text: string) => ({ tool_name: 'tool_search', text, content: [{ type: 'text' as const, text }], isError: true });

  return defineRuntimeTool({
    name: 'tool_search',
    description:
      'Discover additional integration tools provided by configured MCP servers that are NOT listed in your tools. ' +
      'Search by keyword `query` and/or `regex`; returns the full definitions (name, description, input_schema) of the top matches. ' +
      'Then call `mcp_invoke` with the chosen tool_name and arguments to use one.',
    schema,
    execute: async (_ctx, input: { query?: string; regex?: string; top_k?: number }) => {
      if (!input.query?.trim() && !input.regex?.trim()) return err('Provide at least one of `query` or `regex`.');
      if (input.regex) {
        try { new RegExp(input.regex, 'i'); } catch (e) {
          return err(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const topK = Math.max(1, Math.min(opts.topKMax, Math.trunc(input.top_k ?? opts.topKDefault)));
      const hits = index.search({ query: input.query, regex: input.regex, topK });
      const text = JSON.stringify({ hits, total: hits.length });
      return { tool_name: 'tool_search', text, content: [{ type: 'text', text }] };
    },
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/tool-search`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools/src/mcp-disclosure/tool-search.ts packages/agent-tools/test/mcp-disclosure/tool-search.test.ts
git commit -m "feat(agent-tools): add tool_search (regex + BM25 recall)"
```

---

## Task 6: `mcp_invoke` 工具

**Files:**
- Create: `packages/agent-tools/src/mcp-disclosure/mcp-invoke.ts`
- Test: `packages/agent-tools/test/mcp-disclosure/mcp-invoke.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool, type RuntimeTool } from '@mavis/agent-core/tools';
import { createMcpInvokeTool } from '../../src/mcp-disclosure/mcp-invoke.js';

const ctx = { sessionId: 's', turnId: 't', toolCallId: 'c' } as never;
function registry(): Map<string, RuntimeTool> {
  const jira = defineRuntimeTool({
    name: 'jira_create_issue',
    description: 'create',
    schema: Type.Object({ project: Type.String(), title: Type.String() }),
    execute: async (_c, input: { project: string; title: string }) => ({
      tool_name: 'jira_create_issue', text: `ok:${input.project}/${input.title}`,
      content: [{ type: 'text', text: 'ok' }], details: { echoed: input },
    }),
  });
  return new Map([['jira_create_issue', jira]]);
}

describe('mcp_invoke tool', () => {
  it('routes to deferred tool and returns its result', async () => {
    const tool = createMcpInvokeTool(registry());
    const res = await tool.impl.execute(ctx, { tool_name: 'jira_create_issue', arguments: { project: 'X', title: 'T' } }, undefined);
    expect(res.text).toContain('ok:X/T');
    expect(res.isError).not.toBe(true);
  });
  it('errors on unknown tool_name', async () => {
    const tool = createMcpInvokeTool(registry());
    const res = await tool.impl.execute(ctx, { tool_name: 'nope', arguments: {} }, undefined);
    expect(res.isError).toBe(true);
    expect(res.text.toLowerCase()).toContain('tool_search');
  });
  it('errors + returns schema when arguments invalid', async () => {
    const tool = createMcpInvokeTool(registry());
    const res = await tool.impl.execute(ctx, { tool_name: 'jira_create_issue', arguments: { project: 'X' } }, undefined);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('title');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/mcp-invoke`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { defineRuntimeTool, type RuntimeTool, type ToolExecutionContext } from '@mavis/agent-core/tools';

export function createMcpInvokeTool<TCtx extends ToolExecutionContext = ToolExecutionContext>(
  registry: ReadonlyMap<string, RuntimeTool>,
): RuntimeTool {
  const schema = Type.Object({
    tool_name: Type.String({ description: 'Exact tool name from a prior tool_search result.' }),
    arguments: Type.Record(Type.String(), Type.Unknown(), { description: 'Free-form JSON arguments for the tool.' }),
  });
  const err = (text: string) => ({ tool_name: 'mcp_invoke', text, content: [{ type: 'text' as const, text }], isError: true });

  return defineRuntimeTool({
    name: 'mcp_invoke',
    description:
      'Execute an MCP tool discovered via tool_search. Pass the exact `tool_name` and its `arguments` (free-form JSON ' +
      'matching the input_schema returned by tool_search).',
    schema,
    execute: async (ctx, input: { tool_name: string; arguments: Record<string, unknown> }, signal, onUpdate) => {
      const target = registry.get(input.tool_name);
      if (!target) {
        const names = [...registry.keys()];
        return err(`Unknown tool_name "${input.tool_name}". Use tool_search to discover available tools. Known: ${names.slice(0, 20).join(', ')}`);
      }
      const args = input.arguments ?? {};
      if (!Value.Check(target.def.schema, args)) {
        const issues = [...Value.Errors(target.def.schema, args)].slice(0, 8).map((e) => `${e.path}: ${e.message}`);
        const text = `Arguments do not match the schema for "${input.tool_name}":\n${issues.join('\n')}\ninput_schema: ${JSON.stringify(target.def.schema)}`;
        return err(text);
      }
      return target.impl.execute(ctx as TCtx, args as never, signal, onUpdate);
    },
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/mcp-invoke`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools/src/mcp-disclosure/mcp-invoke.ts packages/agent-tools/test/mcp-disclosure/mcp-invoke.test.ts
git commit -m "feat(agent-tools): add mcp_invoke for deferred MCP execution"
```

---

## Task 7: 通用提示 `renderMcpToolSearchHintBlock` + barrel 导出

**Files:**
- Create: `packages/agent-tools/src/mcp-disclosure/hint.ts`
- Create: `packages/agent-tools/src/mcp-disclosure/mcp-disclosure.ts` (barrel)
- Modify: `packages/agent-tools/src/index.ts`
- Test: `packages/agent-tools/test/mcp-disclosure/hint.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { renderMcpToolSearchHintBlock } from '../../src/mcp-disclosure/hint.js';

describe('renderMcpToolSearchHintBlock', () => {
  it('is stable and contains the tool names but no specific MCP tool info', () => {
    const a = renderMcpToolSearchHintBlock();
    expect(a).toBe(renderMcpToolSearchHintBlock());
    expect(a).toContain('tool_search');
    expect(a).toContain('mcp_invoke');
    expect(a).toContain('<system-reminder>');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/hint`
Expected: FAIL。

- [ ] **Step 3: 实现 hint + barrel**

`hint.ts`:

```ts
export function renderMcpToolSearchHintBlock(): string {
  return [
    '<system-reminder>',
    'Additional integration tools (from configured MCP servers) are available but NOT listed here.',
    'When a task needs an external capability your built-in tools do not cover, call `tool_search` with a',
    'keyword `query` and/or `regex` to discover relevant tools, then call `mcp_invoke` with the chosen',
    '`tool_name` and `arguments`. Prefer built-in tools when they suffice.',
    '</system-reminder>',
  ].join('\n');
}
```

`mcp-disclosure.ts`:

```ts
export * from './types.js';
export { tokenize } from './tokenize.js';
export { buildIndex } from './search-index.js';
export { planMcpDisclosure, modelInWhitelist } from './plan.js';
export { createToolSearchTool } from './tool-search.js';
export { createMcpInvokeTool } from './mcp-invoke.js';
export { renderMcpToolSearchHintBlock } from './hint.js';
```

- [ ] **Step 4: 挂到包入口**

在 `packages/agent-tools/src/index.ts` 末尾追加（按现有导出风格）：

```ts
export * from './mcp-disclosure/mcp-disclosure.js';
```

- [ ] **Step 5: 运行 + 构建**

Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure/hint`
Expected: PASS。
Run: `pnpm --filter @mavis/agent-tools build`
Expected: 构建通过，barrel 导出无冲突。

- [ ] **Step 6: Commit**

```bash
git add packages/agent-tools/src/mcp-disclosure/hint.ts packages/agent-tools/src/mcp-disclosure/mcp-disclosure.ts packages/agent-tools/src/index.ts packages/agent-tools/test/mcp-disclosure/hint.test.ts
git commit -m "feat(agent-tools): export mcp-disclosure v2 module + system hint"
```

---

## Task 8: local-runtime 配置 `mcpToolSearch`

**Files:**
- Modify: `packages/local-runtime/src/config/types.ts`（加 `mcpToolSearch?` 字段）
- Create: `packages/local-runtime/src/mcp/disclosure-options.ts`（`resolveMcpDisclosureOptions`）
- Test: `packages/local-runtime/test/unit/mcp/disclosure-options.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { resolveMcpDisclosureOptions } from '../../../src/mcp/disclosure-options.js';

describe('resolveMcpDisclosureOptions', () => {
  it('applies defaults when config absent', () => {
    const o = resolveMcpDisclosureOptions(undefined);
    expect(o).toMatchObject({ enabled: true, modelWhitelist: [], thresholdPct: 0.15, minDeferCount: 1, topKDefault: 5, topKMax: 20, systemHint: true, maxSchemaTextLen: 4096 });
  });
  it('overrides from config', () => {
    const o = resolveMcpDisclosureOptions({ enabled: false, modelWhitelist: ['minimax/*'], thresholdPct: 0.3 });
    expect(o.enabled).toBe(false);
    expect(o.modelWhitelist).toEqual(['minimax/*']);
    expect(o.thresholdPct).toBe(0.3);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/local-runtime test -- --run mcp/disclosure-options`
Expected: FAIL。

- [ ] **Step 3: 实现**

在 `config/types.ts` 的 `LocalRuntimeConfig`（或对应 interface）加：

```ts
mcpToolSearch?: {
  enabled?: boolean;
  modelWhitelist?: string[];
  thresholdPct?: number;
  minDeferCount?: number;
  topKDefault?: number;
  topKMax?: number;
  systemHint?: boolean;
  maxSchemaTextLen?: number;
};
```

`disclosure-options.ts`:

```ts
import type { McpDisclosureOptions } from '@mavis/agent-tools';

type RawConfig = {
  enabled?: boolean; modelWhitelist?: string[]; thresholdPct?: number; minDeferCount?: number;
  topKDefault?: number; topKMax?: number; systemHint?: boolean; maxSchemaTextLen?: number;
} | undefined;

export function resolveMcpDisclosureOptions(raw: RawConfig): McpDisclosureOptions {
  return {
    enabled: raw?.enabled ?? true,
    modelWhitelist: raw?.modelWhitelist ?? [],
    thresholdPct: raw?.thresholdPct ?? 0.15,
    minDeferCount: raw?.minDeferCount ?? 1,
    topKDefault: raw?.topKDefault ?? 5,
    topKMax: raw?.topKMax ?? 20,
    systemHint: raw?.systemHint ?? true,
    maxSchemaTextLen: raw?.maxSchemaTextLen ?? 4096,
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mavis/local-runtime test -- --run mcp/disclosure-options`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/local-runtime/src/config/types.ts packages/local-runtime/src/mcp/disclosure-options.ts packages/local-runtime/test/unit/mcp/disclosure-options.test.ts
git commit -m "feat(local-runtime): add mcpToolSearch config + option resolver"
```

---

## Task 9: 保留 source 的 MCP 列举 `listMcpRuntimeToolEntriesForTurn`

**Files:**
- Modify: `packages/local-runtime/src/mcp/runtime-tools.ts`
- Test: `packages/local-runtime/test/unit/mcp/runtime-tool-entries.test.ts`

先读 `packages/local-runtime/src/mcp/api.ts` 的 `listNativeTools()`（返回带 `source` 与 `nativeName` 的 `LocalMcpNativeToolInfo[]`）与 `listRuntimeTools()`（返回 `RuntimeTool[]`，`def.name === nativeName`）以确认对齐键。

- [ ] **Step 1: 写失败测试**（用假 `mcpService` stub，返回 nativeTools 带 source + runtimeTools 同名）

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool } from '@mavis/agent-core/tools';
import { listMcpRuntimeToolEntriesForTurn } from '../../../src/mcp/runtime-tools.js';

function rt(name: string) {
  return defineRuntimeTool({ name, description: name, schema: Type.Object({}), execute: async () => ({ tool_name: name, text: '', content: [{ type: 'text', text: '' }] }) });
}
const mcpService = {
  listRuntimeTools: async () => [rt('matrix_web_search'), rt('mcp__jira__create_issue')],
  listNativeTools: async () => [
    { nativeName: 'matrix_web_search', source: 'builtin-matrix' },
    { nativeName: 'mcp__jira__create_issue', source: 'configured' },
  ],
} as never;

describe('listMcpRuntimeToolEntriesForTurn', () => {
  it('zips runtime tools with their source by nativeName', async () => {
    const entries = await listMcpRuntimeToolEntriesForTurn({ sessionId: 's', workspaceRoot: '/w', mcpService, emitBusEvent: () => {} });
    const bySource = Object.fromEntries(entries.map((e) => [e.tool.def.name, e.source]));
    expect(bySource).toEqual({ matrix_web_search: 'builtin-matrix', mcp__jira__create_issue: 'configured' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mavis/local-runtime test -- --run mcp/runtime-tool-entries`
Expected: FAIL。

- [ ] **Step 3: 实现**（在 `runtime-tools.ts` 新增，保留既有 `listMcpRuntimeToolsForTurn` 与 `mcp.tools_injected` 行为）

```ts
import type { McpToolEntry, McpToolSource } from '@mavis/agent-tools';

export async function listMcpRuntimeToolEntriesForTurn(input: {
  sessionId: string;
  workspaceRoot: string;
  authContext?: LocalRuntimeAuthContext;
  mcpService: LocalMcpService;
  emitBusEvent(type: string, payload: Record<string, unknown>): void;
}): Promise<McpToolEntry[]> {
  try {
    const ctx = { workspaceRoot: input.workspaceRoot, ...(input.authContext ? { authContext: input.authContext } : {}) };
    const [tools, native] = await Promise.all([
      input.mcpService.listRuntimeTools(ctx),
      input.mcpService.listNativeTools(ctx),
    ]);
    const sourceByName = new Map<string, McpToolSource>(native.map((n) => [n.nativeName, n.source]));
    const entries: McpToolEntry[] = tools.map((tool) => ({ tool, source: sourceByName.get(tool.def.name) ?? 'configured' }));
    input.emitBusEvent('mcp.tools_injected', { sessionId: input.sessionId, count: entries.length, toolNames: entries.map((e) => e.tool.def.name) });
    return entries;
  } catch (err) {
    input.emitBusEvent('mcp.tools_injection_failed', { sessionId: input.sessionId, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
```

> 注：若 `listNativeTools` 的 ctx 签名与 `listRuntimeTools` 不同，按 api.ts 实际签名调整；未知映射默认 `'configured'`（保守：会被纳入 defer 候选，仍安全）。

- [ ] **Step 4: 运行确认通过 + Commit**

Run: `pnpm --filter @mavis/local-runtime test -- --run mcp/runtime-tool-entries`
Expected: PASS。

```bash
git add packages/local-runtime/src/mcp/runtime-tools.ts packages/local-runtime/test/unit/mcp/runtime-tool-entries.test.ts
git commit -m "feat(local-runtime): list mcp runtime tools with server provenance"
```

---

## Task 10: `buildLocalTurnRuntimeTools` 按 plan 塑形并回传 plan

**Files:**
- Modify: `packages/local-runtime/src/api/local-native-tools.ts:161-203`
- Test: `packages/local-runtime/test/unit/mcp/turn-tool-shaping.test.ts`

- [ ] **Step 1: 写失败测试**（注入假 mcpService；断言两路 tools 形状 + 返回 plan）

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool } from '@mavis/agent-core/tools';
import { buildLocalTurnRuntimeTools } from '../../../src/api/local-native-tools.js';

// 构造 8 个 configured 工具，配合 estimateTokens 让其超阈
// model contextWindow=200k, thresholdPct=0.15 -> 阈值 30k；每工具估 5k -> 8*5k=40k>30k
// （通过 options.estimateTokens 注入；见下方 入参扩展）
```

测试要点（断言）：
- deferred=true 时：返回 `tools` 含 `tool_search`、`mcp_invoke`，不含任何 `mcp_*` configured 工具名；`plan.deferred === true`。
- 非白名单模型：`tools` 含全部 configured 工具，不含 `tool_search`/`mcp_invoke`；`plan.deferred === false`。

> 由于该函数依赖较多 deps，测试用最小 stub（mcpService、threadGoal.runtimeToolsFor 返回 []、skillRegistryProvider 等可传 undefined/空）。如 deps 过重，改为对 `shapeTurnTools(nativeTools, entries, plan)` 抽出的纯函数做单测（推荐：把塑形逻辑抽成可测纯函数）。

- [ ] **Step 2: 抽出可测纯函数**（推荐，降低测试耦合）

在 `local-native-tools.ts` 增加：

```ts
import {
  planMcpDisclosure, createToolSearchTool, createMcpInvokeTool,
  type McpToolEntry, type McpDisclosureOptions, type McpModelIdentity, type McpDisclosurePlan,
} from '@mavis/agent-tools';
import type { RuntimeTool } from '@mavis/agent-core/tools';

export function shapeMcpTurnTools(input: {
  nativeTools: RuntimeTool[];
  entries: McpToolEntry[];
  model: McpModelIdentity;
  options: McpDisclosureOptions;
  threadGoalTools: RuntimeTool[];
}): { tools: RuntimeTool[]; plan: McpDisclosurePlan } {
  const plan = planMcpDisclosure({ entries: input.entries, model: input.model, options: input.options });
  if (!plan.deferred) {
    return { tools: [...input.nativeTools, ...plan.inlineTools, ...input.threadGoalTools], plan };
  }
  const toolSearch = createToolSearchTool(plan.index, { topKDefault: input.options.topKDefault, topKMax: input.options.topKMax });
  const mcpInvoke = createMcpInvokeTool(plan.deferredRegistry);
  return {
    tools: [...input.nativeTools, ...plan.inlineTools, toolSearch, mcpInvoke, ...input.threadGoalTools],
    plan,
  };
}
```

- [ ] **Step 3: 写纯函数单测（替换 Step 1 的重 stub）**

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { defineRuntimeTool } from '@mavis/agent-core/tools';
import { shapeMcpTurnTools } from '../../../src/api/local-native-tools.js';

const rt = (n: string) => defineRuntimeTool({ name: n, description: n, schema: Type.Object({ a: Type.String() }), execute: async () => ({ tool_name: n, text: '', content: [{ type: 'text', text: '' }] }) });
const opts = { enabled: true, modelWhitelist: ['minimax/*'], thresholdPct: 0.15, minDeferCount: 1, topKDefault: 5, topKMax: 20, systemHint: true, maxSchemaTextLen: 4096, estimateTokens: () => 50_000 };
const model = { provider: 'minimax', id: 'MiniMax-M3', contextWindow: 200_000 };
const entries = [
  { tool: rt('mcp__jira__create'), source: 'configured' as const },
  { tool: rt('matrix_web_search'), source: 'builtin-matrix' as const },
];

describe('shapeMcpTurnTools', () => {
  it('defers configured tools, adds tool_search + mcp_invoke', () => {
    const { tools, plan } = shapeMcpTurnTools({ nativeTools: [rt('read')], entries, model, options: opts, threadGoalTools: [] });
    const names = tools.map((t) => t.def.name);
    expect(plan.deferred).toBe(true);
    expect(names).toContain('tool_search');
    expect(names).toContain('mcp_invoke');
    expect(names).toContain('matrix_web_search'); // builtin inline
    expect(names).not.toContain('mcp__jira__create'); // deferred
  });
  it('non-whitelisted model inlines everything, no search tools', () => {
    const { tools, plan } = shapeMcpTurnTools({ nativeTools: [rt('read')], entries, model: { ...model, provider: 'openai' }, options: opts, threadGoalTools: [] });
    const names = tools.map((t) => t.def.name);
    expect(plan.deferred).toBe(false);
    expect(names).toContain('mcp__jira__create');
    expect(names).not.toContain('tool_search');
  });
});
```

- [ ] **Step 4: 改 `buildLocalTurnRuntimeTools` 用 shape + 回传 plan**

入参新增 `model: McpModelIdentity` 与 `mcpDisclosure: McpDisclosureOptions`；返回类型从 `RuntimeTool[]` 改为 `{ tools: RuntimeTool[]; plan: McpDisclosurePlan }`；内部用 `listMcpRuntimeToolEntriesForTurn` 取 entries，调 `shapeMcpTurnTools`。保留 `toolsDisabled` 短路（返回 `{ tools: [], plan: { deferred:false, inlineTools: [] } }`）。

- [ ] **Step 5: 运行通过 + Commit**

Run: `pnpm --filter @mavis/local-runtime test -- --run mcp/turn-tool-shaping`
Expected: PASS。

```bash
git add packages/local-runtime/src/api/local-native-tools.ts packages/local-runtime/test/unit/mcp/turn-tool-shaping.test.ts
git commit -m "feat(local-runtime): shape turn tools via planMcpDisclosure (v2)"
```

---

## Task 11: host 接线（提前 resolveModel + systemHint + 遥测）

**Files:**
- Modify: `packages/local-runtime/src/api/host.ts:1189-1316`（`runTurnToStream`）
- Test: 复用/扩展 `packages/local-runtime/test/unit/local-api-host.test.ts`（或新增针对 systemHint 装配的集成断言）

先读 `host.ts:1189-1316` 与 `buildTurnAgentConfig`、`modelResolver.resolveModel` 的现有用法。

- [ ] **Step 1: 调整顺序与装配（实现）**

在 `runTurnToStream` 内、`buildLocalTurnRuntimeTools` 之前先解析 model 一次：

```ts
const llm = await this.modelResolver.resolveModel({ sessionId: session.sessionId, turnId, agentConfig });
const modelIdentity = { provider: llm.model.provider, id: llm.model.id, contextWindow: llm.model.contextWindow };
const mcpDisclosure = resolveMcpDisclosureOptions(this.configGetter().mcpToolSearch);

const { tools: turnTools, plan: mcpPlan } = await buildLocalTurnRuntimeTools({
  /* ...既有入参... */
  model: modelIdentity,
  mcpDisclosure,
});

const systemPrompt = mcpPlan.deferred && mcpDisclosure.systemHint
  ? `${agentConfig.system_prompt}\n\n${renderMcpToolSearchHintBlock()}`
  : agentConfig.system_prompt;
```

在 `controller.startTurn(...)` 调用里：把 `systemPrompt:` 改为上面的 `systemPrompt`；把 `llm:` 改为复用已解析的 `llm`（保留既有 `payloadTransform: buildOpenPlatformThinkingPatcher(agentConfig.model)`）。

紧接着发遥测：

```ts
this.emitBusEvent('mcp.tools_deferred', {
  sessionId: session.sessionId,
  deferred: mcpPlan.deferred,
  whitelisted: modelInWhitelist(modelIdentity.provider, modelIdentity.id, mcpDisclosure.modelWhitelist),
  model: `${modelIdentity.provider}/${modelIdentity.id}`,
  ...(mcpPlan.deferred ? mcpPlan.stats : {}),
});
```

import：`renderMcpToolSearchHintBlock`, `modelInWhitelist` from `@mavis/agent-tools`；`resolveMcpDisclosureOptions` from `../mcp/disclosure-options.js`。

> 注意：第二处 `startTurn`（host.ts:1706 附近）若也需要该行为，按需对齐；否则保持只改 `runTurnToStream` 主链路（在 plan 备注里说明只覆盖主对话链路）。

- [ ] **Step 2: 集成断言（测试）**

最小化：对 host 暴露的「装配 systemPrompt」逻辑抽一个内部纯函数 `composeTurnSystemPrompt(base, plan, opts)` 并单测：

```ts
import { describe, it, expect } from 'vitest';
import { composeTurnSystemPrompt } from '../../src/api/host-prompt.js';

describe('composeTurnSystemPrompt', () => {
  it('appends hint only when deferred && systemHint', () => {
    const base = 'BASE';
    expect(composeTurnSystemPrompt(base, { deferred: true } as never, { systemHint: true } as never)).toContain('<system-reminder>');
    expect(composeTurnSystemPrompt(base, { deferred: true } as never, { systemHint: false } as never)).toBe(base);
    expect(composeTurnSystemPrompt(base, { deferred: false } as never, { systemHint: true } as never)).toBe(base);
  });
});
```

把该纯函数实现放 `packages/local-runtime/src/api/host-prompt.ts` 并在 host.ts 引用，避免在重型 host 测试里验证装配。

- [ ] **Step 3: 类型与构建**

Run: `pnpm --filter @mavis/local-runtime build`
Run: `pnpm --filter @mavis/local-runtime test -- --run host-prompt`
Expected: 构建通过、纯函数测试 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/local-runtime/src/api/host.ts packages/local-runtime/src/api/host-prompt.ts packages/local-runtime/test/unit/host-prompt.test.ts
git commit -m "feat(local-runtime): wire mcp disclosure into runTurnToStream (model gate + system hint + telemetry)"
```

---

## Task 12: 真 E2E（两跳 + 白名单开关 + 中文工具）

**Files:**
- Create: `packages/agent-tools/test/mcp-disclosure/e2e-two-hop.test.ts`（或 local-runtime e2e，按既有 E2E 脚手架）

参考归档分支 `feat/mcp-tool-search-disclosure-v1` 的 e2e harness（`../feat-mcp-tool-search-disclosure-v1/packages/agent-tools/test/mcp-disclosure/`）。E2E 需真 LLM（按 AGENTS.md「走 LLM 的产品行为必须真实 E2E」）。

- [ ] **Step 1: 写 E2E（真 LLM，白名单模型）**

场景：注册一个含若干 `configured` 工具（其一 description 为中文，如「查询某城市天气」）的假 MCP server，强制 deferred。断言一次完整 turn：
1. 请求 model 的 `tools` 含 `tool_search` 与 `mcp_invoke`，不含任何 configured 工具名（可通过 hook/捕获 newTools 输出或 pi 请求快照断言）；
2. system prompt 含 `<system-reminder>` 通用提示、不含任何工具名；
3. 模型先发 `tool_search`（query 用中文命中天气工具）→ 再 `mcp_invoke(tool_name, arguments)` → 拿到工具结果。

- [ ] **Step 2: 写 E2E（非白名单模型）**

同 server，但模型不在白名单：断言该 turn `tools` 含全部 configured 工具、不含 `tool_search`/`mcp_invoke`。

- [ ] **Step 3: 运行**

Run（按仓库 E2E 脚本，隔离 port/dataDir）：例如 `pnpm test:e2e:archon-real-chain` 的本地等价，或针对本 feature 的最小 e2e 脚本。
Expected: 两个 E2E PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/agent-tools/test/mcp-disclosure/e2e-two-hop.test.ts
git commit -m "test: deterministic + real-LLM e2e for mcp disclosure v2 two-hop"
```

---

## Task 13: 文档与 changelog

**Files:**
- Modify: `changelogs/<YYYY-MM-DD>.md`（当前分支段）
- 原 v2 spec 已迁入：`packages/local-runtime-v2/docs/mcp-tool-search-disclosure-design.md`。

- [ ] **Step 1: 在当天 changelog 当前分支段追加条目**（feature 摘要 + 影响面）。
- [ ] **Step 2: 全量构建 + 影响面测试**

Run: `pnpm --filter @mavis/agent-tools build && pnpm --filter @mavis/local-runtime build`
Run: `pnpm --filter @mavis/agent-tools test -- --run mcp-disclosure`
Run: `pnpm --filter @mavis/local-runtime test -- --run mcp`
Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add changelogs/
git commit -m "docs: changelog for mcp tool search disclosure v2"
```

---

## Self-Review（写完即查）

- **Spec coverage**：§4.1→T1；§4.3 分词→T2；§4.3 BM25/regex/signature→T3；§4.2 planner/whitelist→T4；§4.4 tool_search→T5；§4.5 mcp_invoke→T6；§4.6 hint→T7；§5.4 config→T8；§5.3 source 列举→T9；§5.2 塑形→T10；§5.1 host/systemHint/遥测→T11；§9 E2E→T12；§8 遥测在 T11；§7 失败模式分散在 T5/T6/T4。覆盖完整。
- **Placeholder scan**：核心算法（tokenize/BM25/plan/tools/hint/config）均给出完整代码；wiring（T9–T11）依赖既有文件，给出精确路径、入参/返回签名与新增代码块，并要求先读对应现有函数再改——无「TODO/待补」。
- **Type consistency**：`McpToolEntry{tool,source}`、`McpDisclosurePlan`（deferred 联合）、`createToolSearchTool(index,{topKDefault,topKMax})`、`createMcpInvokeTool(registry)`、`resolveMcpDisclosureOptions`、`shapeMcpTurnTools`、`composeTurnSystemPrompt` 在各 Task 间一致。
- **命名注意**：模块内检索文件用 `search-index.ts`（避免与 barrel `index.ts` 混淆）。

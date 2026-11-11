# 自定义 MCP 工具渐进式披露（tool_search / mcp_invoke）设计 — v2

MCP 继续使用本文的 `mcp_invoke` 链路；内置按需工具复用同一入口，设计见 [Cron 工具拆分与按需加载](../../../.harness/docs/specs/deferred-cron-tools-design.md)。

> 维护状态：迁入 local-runtime-v2 的设计档案；原状态为 Draft（项目组 review 后 v2）。
> 标题中的 v2 是 MCP 方案版本，不是 Local Runtime V2 service 布局版本。
> 原方案的白名单、检索与两跳协议决策继续保留；具体配置和类型以当前源码为准。
> 关联：飞书技术方案 https://vrfi1sk8a0.feishu.cn/docx/JbG8d9oVyozmLlxOssLcAFgznmd
> 历史前序：v1 实现归档到分支 `feat/mcp-tool-search-disclosure-v1`（system-prompt catalog + 模糊 tool_search，无白名单/索引/CJK）；当时从 `origin/dev` 重做 v2，这不是当前分支操作指引。

## 当前 v2 维护入口

| 职责 | 当前 owner |
| --- | --- |
| runtime 无关的规划、索引、检索与调用 | `packages/agent-tools/src/mcp-disclosure/` |
| Turn 工具目录、选项解析、提示与诊断 | `packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts`（`buildLocalTurnToolCatalog` / `resolveLocalMcpDisclosureOptions`） |
| MCP 工具来源与 runtime tool 枚举 | `packages/local-runtime-v2/src/service/mcp/tools/runtime-tools.ts`（`listMcpRuntimeToolEntriesForTurn`） |
| 模型身份与上下文窗口解析 | `packages/local-runtime-v2/src/service/model-system/resolution/local-model-resolver.ts` |

原 `host.runTurnToStream` / `api/local-native-tools.ts` 接线已退役；当前由 Turn System
装配工具目录并消费 Model System 的解析结果。§3、§5、§10 的旧 host 流程和落点是历史设计，
不得据此恢复旧 executor。当前测试命令见 [实施计划的维护入口](mcp-tool-search-disclosure-plan.md)；
本轮仅迁移资料与核对路径，没有重跑测试或真实模型验收。

## 历史设计正文

## 1. 概述

用户在 MiniMax Code/Agent 中接入大量自定义 MCP Server 时，这些工具的完整定义（`name` / `description` / `schema`）会随请求的 `tools` 全量进入上下文，既占 token，又降低模型选工具、填参数的准确度。

v2 在「自定义 MCP 工具定义体积超过上下文窗口某百分比 **且** 模型在白名单内」时，**不把这些工具的任何信息放进 `tools` 或 system prompt**，改为：

- 对被 defer 的工具定义（`name` + `description` + `schema`）建立**进程内检索索引**；
- 在内置工具集合上新增两个常驻工具 `tool_search`（regex + BM25 top-K 召回）与 `mcp_invoke`（按 `tool_name` 执行）；
- system prompt 仅放一段**与具体工具无关**的通用提示；
- 模型先用 `tool_search` 召回候选工具的完整定义（仅这些进入对话上下文），再用 `mcp_invoke` 实际调用。

全程模型请求的 `tools` 恒定为 `[内置工具…, tool_search, mcp_invoke]`；被 defer 的自定义 MCP 工具定义只在 `tool_search` 召回结果里按需出现。

### 1.1 目标

- 自定义 MCP 工具体积超阈时按需披露，显著降低固定上下文占用，且**零泄露**（未召回工具的任何信息不进上下文）。
- 不修改 `third_party/pi-mono`（pi-agent-core）。
- 核心逻辑 runtime 无关，放 `packages/agent-tools`；local-runtime 仅接线。
- 中文场景检索有效（工具 `name`/`description`/参数描述常含中文）。

### 1.2 非目标

- 本期不接 cloud-runtime（cloud 当前无自定义 MCP 集成，§13）。
- 不用 Messages-compatible provider 原生 Tool Search（`defer_loading`）—— 引擎多 provider，原生不通用（§13）。
- 不做细粒度 defer（保留部分内联、按相关性排序）—— 本期 all-or-nothing。
- 不引入第三方分词/检索库 —— BM25 + CJK n-gram 自研。

## 2. 背景与约束

### 2.1 引擎约束（决定方案形态）

agent loop 跑在 `third_party/pi-mono`（pi-agent-core），多 provider 抽象（Messages-compatible / `openai-*` / `bedrock-converse` / `google-*` 及公司内部 provider）。

| 约束 | 位置 | 影响 |
| --- | --- | --- |
| `tools` 里每个工具的 name+description+schema 全量发模型 | provider implementation `convertTools` | 不存在「可执行但不暴露」的工具 |
| 模型对不在 `tools` 数组里的 `tool_use` 直接报错（`Tool <name> not found`） | `third_party/pi-mono/packages/agent/src/agent-loop.ts` `prepareToolCall` | 必须有常驻工具代为执行 deferred 工具 |

→ deferred 工具不能靠模型直接调用，必须经由常驻 `mcp_invoke` 执行。

### 2.2 dev 现状（v2 依赖）

- **MCP 工具带 `source` 字段**（commit `ab26a04bd`）：`packages/local-runtime/src/mcp/api.ts` 的 `listNativeTools()` 为每个工具产出 `source: 'builtin-matrix' | 'builtin' | 'configured'`（见 `LocalMcpNativeToolInfo`）。v2 据此分类：**仅 `source === 'configured'`（用户自定义）参与 defer**，`builtin-matrix` / `builtin` 始终内联。判定 builtin-matrix 见 `mcp/builtin-matrix.ts` `isBuiltinMatrixConfig`。
- **模型解析暴露身份与窗口**：`packages/local-runtime/src/runtime/model-resolver.ts` `resolveModel()` 返回 `LLMModelConfig`，含 `model.id` / `model.provider` / `model.contextWindow`，支撑白名单匹配与阈值计算。

### 2.3 v2 相对 v1 的变化（review 调整）

1. **零上下文泄露 + 索引化检索**：被 defer 工具的任何信息不进 system prompt / 上下文；改为建索引，`tool_search` 用 regex + BM25 top-K 召回返回完整定义。（v1 是 system-prompt catalog + 模糊 name 匹配。）
2. **模型白名单**：`mcp_invoke` 参数为 `tool_name` + free-form JSON `arguments`；因部分模型 free-form JSON 能力弱，仅白名单内模型启用渐进式披露，白名单外不 defer（全部内联，行为同现状）。
3. **按 `source` 分类**：用 `source === 'configured'` 精确识别用户自定义工具（替代 v1 的名字前缀启发）。
4. **CJK n-gram 中文分词**：BM25 分词加入 CJK unigram + bigram，修复中文召回。

## 3. 总体架构与每轮编排

协调点：`packages/local-runtime/src/api/host.ts` `runTurnToStream`（model、mcpService(含 source)、agentConfig(system_prompt) 均就绪）。

```text
host.runTurnToStream
  1. resolveModel() 取 model.{ id, provider, contextWindow }   // 提前到建工具之前
  2. 列出 MCP 工具并保留 source（builtin-matrix / builtin / configured）
  3. planMcpDisclosure({ entries, model, options }):
       eligible = enabled
                  AND modelInWhitelist(provider, id)
                  AND candidates.length >= minDeferCount
                  AND ( candidates.length > MAX_INLINE_CONFIGURED_TOOLS(64)
                        OR estTokens(candidates: source=configured) > thresholdPct * contextWindow )
  4a. deferred=true:
        index = buildOrReuseIndex(candidates)        // 按签名缓存
        deferredRegistry = Map(tool_name -> RuntimeTool)
        tools = [native, matrix/builtin 内联, tool_search(index), mcp_invoke(deferredRegistry)]
        systemPrompt += 通用提示（不含任何工具名/描述；可配开关）
  4b. deferred=false:
        tools = [native, 全部 MCP 内联]              // 同现状（未白名单 / 未超阈）
  5. controller.startTurn(systemPrompt, tools, ...)
```

两跳协议：① `tool_search({query?, regex?, top_k?})` → 索引返回 top-K 命中工具完整定义；② `mcp_invoke({tool_name, arguments})` → 校验后路由到 `deferredRegistry` 中工具的 `impl.execute`。

## 4. 组件设计（runtime 无关，`packages/agent-tools/src/mcp-disclosure/`）

### 4.1 类型（`types.ts`）

```ts
export interface McpToolEntry {
  tool: RuntimeTool;                 // def + impl（来自 mcpService）
  source: 'builtin-matrix' | 'builtin' | 'configured';
}

export interface McpDisclosureOptions {
  enabled: boolean;
  modelWhitelist: readonly string[]; // 'provider/id'，支持前缀/glob（见 4.2）
  thresholdPct: number;              // 默认 0.15
  minDeferCount: number;             // 默认 1
  topKDefault: number;               // 默认 5
  topKMax: number;                   // 默认 20
  systemHint: boolean;               // 默认 true
  maxSchemaTextLen: number;          // 单工具 schemaText 上限（防御超大 schema），默认 4096
  estimateTokens?: (def: ToolDefinition) => number; // 默认 JSON.stringify(def).length/4
}

export interface McpModelIdentity { provider: string; id: string; contextWindow: number }

export type McpDisclosurePlan =
  | { deferred: false; inlineTools: RuntimeTool[] }
  | {
      deferred: true;
      inlineTools: RuntimeTool[];            // matrix + builtin
      deferredRegistry: Map<string, RuntimeTool>;
      index: McpToolIndex;
      systemHintBlock?: string;              // systemHint=true 时生成
      stats: { candidateCount: number; indexedCount: number; estTokens: number; thresholdTokens: number };
    };
```

### 4.2 规划器（`plan.ts`）

```ts
export function planMcpDisclosure(input: {
  entries: readonly McpToolEntry[];
  model: McpModelIdentity;
  options: McpDisclosureOptions;
}): McpDisclosurePlan;
```

逻辑：

1. `enabled=false` 或 `modelInWhitelist=false` → `{ deferred:false, inlineTools: 全部 MCP }`。
2. `candidates = entries.filter(e => e.source === 'configured')`。
3. `cost = Σ estimateTokens(e.tool.def)`（schemaText 受 `maxSchemaTextLen` 截断后估算）。
4. `deferred = candidates.length >= minDeferCount && (candidates.length > MAX_INLINE_CONFIGURED_TOOLS || cost > thresholdPct * model.contextWindow)`。数量条件固定为 64，不依赖 `contextWindow`：插件 MCP 工具数量不设上限，大上下文窗口下仅按 token 判断会把上百个工具内联，超出 OpenAI 兼容接口 128 个 function 的限制。`contextWindow` 无效时只关闭 token 条件。
5. `deferred=false` → 全部内联；`deferred=true` → `inlineTools = 非 configured`，`buildIndex(candidates)`，`deferredRegistry`，`systemHintBlock`。

**白名单匹配** `modelInWhitelist(provider, id, list)`：对每个 pattern 以 `${provider}/${id}` 做匹配，支持：精确、`provider/*` 前缀、`*` 通配（glob：`*` → `.*` 的简单实现，避免引库）。空 list ⇒ 不命中（功能默认关闭，安全）。

### 4.3 检索索引（`index.ts`）

```ts
export interface McpToolIndex {
  search(input: { query?: string; regex?: string; topK: number }): McpSearchHit[];
  size: number;
  signature: string; // names + schema 摘要，用于缓存
}
export interface McpSearchHit { name: string; description: string; input_schema: unknown; score: number }
export function buildIndex(candidates: readonly McpToolEntry[], opts: Pick<McpDisclosureOptions,'maxSchemaTextLen'>): McpToolIndex;
```

- **文档构建**：每工具 `doc = name + ' ' + description + ' ' + schemaText`；`schemaText` 展开 property 名 / 描述 / enum / required，截断到 `maxSchemaTextLen`。
- **分词器 `tokenize(text)`（中英文混合，关键）**：
  - 小写化；
  - 英文/标识符段（`[A-Za-z0-9]+`）：按非字母数字切分 + `camelCase`/`snake_case` 拆子词（如 `createIssue`/`create_issue` → `create`,`issue`）；
  - 中文(CJK，`\p{Script=Han}` 连续段）：unigram + bigram（`东京` → `东`,`京`,`东京`；unigram 保召回、bigram 提精度）；
  - 同一 tokenizer 用于 doc 与 query。
- **BM25**：`k1=1.5`、`b=0.75`，倒排表 + 文档长度归一。
- **检索 `search`**：
  - `regex` 提供：用 `new RegExp(regex,'i')` 对**原始 doc 文本**硬过滤（非法 regex 由 tool 层捕获，见 4.4）；
  - `query` 提供：对（过滤后或全量）候选做 BM25 排序；仅 `regex` 时按 name 命中优先 + 词法序；
  - 截断 `topK`；返回 `McpSearchHit[]`（含完整 `input_schema`）。
- **签名/缓存**：`signature = hash(sorted(name + ':' + schemaDigest))`；索引在 runtime 层按签名缓存（§5.3），集合变更才重建。

### 4.4 `tool_search` 工具（`tool-search.ts`）

```ts
export function createToolSearchTool(index: McpToolIndex, opts: { topKDefault: number; topKMax: number }): RuntimeTool;
```

- `def`：`name='tool_search'`，描述说明它检索「已配置的、未列出的集成(MCP)工具」，返回完整定义供后续 `mcp_invoke`。schema：

```ts
Type.Object({
  query: Type.Optional(Type.String({ description: '关键词检索（BM25，中英文）' })),
  regex: Type.Optional(Type.String({ description: '正则过滤工具名/描述/schema 文本' })),
  top_k: Type.Optional(Type.Number({ description: `默认 ${topKDefault}，上限 ${topKMax}` })),
})
```

- `impl`：校验「`query`/`regex` 至少给一个」（否则结构化 error）；非法 `regex` → 结构化 error（提示修正，不抛异常）；`top_k` clamp 到 `[1, topKMax]`；调用 `index.search`，返回 `{ hits: [{name, description, input_schema, score}], total }`（JSON 文本）。不触碰 `tools` 数组。

### 4.5 `mcp_invoke` 工具（`mcp-invoke.ts`，泛型 over TCtx）

```ts
export function createMcpInvokeTool<TCtx extends ToolExecutionContext>(registry: Map<string, RuntimeTool<TSchema, TCtx>>): RuntimeTool<TSchema, TCtx>;
```

- schema：`Type.Object({ tool_name: Type.String(), arguments: Type.Unknown()/Record })`（`arguments` 为 free-form JSON）。
- 流程：① `registry.get(tool_name)`，缺失 → error + 提示先用 `tool_search` + 可见名提示；② `Value.Check(def.schema, arguments)` 失败 → error + 回传该工具完整 schema（自纠，缓解 free-form JSON 能力弱）；③ `await tool.impl.execute(ctx, arguments, signal, onUpdate)`（透传同 runtime 的 `ctx`）；④ 返回 `ToolResult`；MCP 侧错误按工具错误(`is_error`)透传。

### 4.6 通用提示（`hint.ts`）

```ts
export function renderMcpToolSearchHintBlock(): string; // 固定文案，零工具信息
```

内容（`<system-reminder>` 包裹）：说明「存在未列出的集成(MCP)工具；需要内置工具未覆盖的外部能力时，先 `tool_search`（query/regex）检索，再 `mcp_invoke(tool_name, arguments)` 调用；内置工具够用时优先内置」。

## 5. 历史 runtime 接线（旧 local-runtime；当前 owner 见页首）

### 5.1 `host.ts` `runTurnToStream`

- 将 `modelResolver.resolveModel(...)` **提前**到 `buildLocalTurnRuntimeTools` 之前，得到 `model.{id,provider,contextWindow}`（复用同一结果给 `startTurn.llm`，避免二次解析）。
- 调用塑形后的 `buildLocalTurnRuntimeTools`（见 5.2），拿回 `{ tools, plan }`。
- `deferred && systemHint` 时，`systemPrompt = agentConfig.system_prompt + '\n\n' + plan.systemHintBlock`；否则用原 `system_prompt`。
- emit `mcp.tools_deferred` 遥测（§8）。

### 5.2 `local-native-tools.ts` `buildLocalTurnRuntimeTools`

- 入参新增 `model: McpModelIdentity` 与 `mcpDisclosure: McpDisclosureOptions`。
- MCP 列举改用保留 source 的入口（5.3），得到 `McpToolEntry[]`。
- 调 `planMcpDisclosure`：`deferred=false` → `tools = [...native, ...inlineTools, ...threadGoal]`（同现状）；`deferred=true` → `tools = [...native, ...inlineTools, createToolSearchTool(index), createMcpInvokeTool(deferredRegistry), ...threadGoal]`。
- 返回 `{ tools, plan }`（plan 供 host 用于 systemHint 与遥测）。

### 5.3 `mcp/runtime-tools.ts` — 保留 source 的列举

- 新增 `listMcpRuntimeToolEntriesForTurn(...) : Promise<McpToolEntry[]>`：基于 `mcpService.listNativeTools()`（带 `source`）+ 现有 `listRuntimeTools()` 的 def/impl 映射，按 `nativeName` 对齐，产出 `{ tool, source }`。保留既有 `mcp.tools_injected` 遥测。
- 索引缓存：在 `LocalMcpService`（或 host 级）维护 `Map<signature, McpToolIndex>`，`buildOrReuseIndex(candidates)` 命中签名直接复用。

### 5.4 配置（`config/types.ts` + 读取）

```ts
interface LocalRuntimeConfig {
  // ...
  mcpToolSearch?: {
    enabled?: boolean;          // 默认 true
    modelWhitelist?: string[];  // 默认 []
    thresholdPct?: number;      // 默认 0.15
    minDeferCount?: number;     // 默认 1
    topKDefault?: number;       // 默认 5
    topKMax?: number;           // 默认 20
    systemHint?: boolean;       // 默认 true
    maxSchemaTextLen?: number;  // 默认 4096
  };
}
```

提供 `resolveMcpDisclosureOptions(config): McpDisclosureOptions`（填默认 + 环境变量覆盖，便于排障）。

## 6. Prompt Cache 影响

`tools` 段（内置 + `tool_search` + `mcp_invoke`，描述固定）与 system 段（仅通用提示，稳定）全程不变；索引在进程内、不进上下文；被召回的工具定义只进对话历史。tools/system 前缀稳定，天然 cache 友好。

## 7. 失败模式与边界

| 场景 | 行为 |
| --- | --- |
| 模型不在白名单 | 不 defer，自定义 MCP 全部内联，不加 tool_search/mcp_invoke |
| tool_search 未给 query 也未给 regex | error，提示至少给一个 |
| tool_search 的 regex 非法 | error，提示修正（不抛异常） |
| tool_search 无命中 | `{hits:[], total:0}`，模型可改写 query |
| mcp_invoke 的 tool_name 未知 | error + 提示先用 tool_search |
| mcp_invoke 参数不合 schema | error + 回传完整 schema（自纠） |
| MCP server 执行报错 | 作为工具错误结果(is_error)透传 |
| 会话中途增删 MCP server | 下一轮重算门控；签名变化时重建索引 |
| 未触发 defer（小配置/未超阈） | 全部内联，行为同现状 |
| 单工具 schema 异常巨大 | schemaText 截断到 maxSchemaTextLen（估算与索引都受限） |

## 8. 可观测性

- `mcp.tools_deferred`：`{ sessionId, deferred, whitelisted, model, candidateCount, indexedCount, estTokens, thresholdTokens }`。
- `tool_search` 调用：`{ query, regex, hitCount, topK }`（query/regex 脱敏按需）。
- `mcp_invoke` 调用与 `Value.Check` 失败计数。
- 保留既有 `mcp.tools_injected`。

## 9. 历史测试策略（原方案采用 test-first）

以下保留设计时的覆盖目标；当前仅按改动风险运行相关 unit / integration，使用上文链接中的 focused test 命令。
真实 E2E 由外部 webhook 验收，历史真 LLM 场景不构成本地 commit / push / MR 门禁。

- **单测（agent-tools）**：
  - `planMcpDisclosure`：白名单命中/未命中、source 分类、阈值与 minDeferCount 边界、空 list 默认关闭。
  - `index`/BM25/regex：排序、top-K clamp、regex 过滤、英文 camel/snake 分词、CJK unigram+bigram、中英文混合、无命中、签名稳定性。
  - `tool_search`：缺参 error、非法 regex error、top_k clamp。
  - `mcp_invoke`：路由、schema 校验失败回传、未知 tool_name、ctx 透传、is_error 透传。
  - `renderMcpToolSearchHintBlock`：稳定文案、零工具信息。
- **单测/集成（local-runtime）**：`buildLocalTurnRuntimeTools` 在 deferred / 非 deferred 两路的 tools 形状；host 的 systemHint 追加；`listMcpRuntimeToolEntriesForTurn` 的 source 对齐。
- **真 E2E（走 LLM）**：白名单模型——该 turn tools 不含自定义、含 tool_search/mcp_invoke，模型先 `tool_search`（覆盖一个中文描述工具）再 `mcp_invoke` 拿到结果；非白名单模型——自定义工具内联、无 tool_search。
- mock-LLM 单测只覆盖装配/分支/fail-closed/校验。

## 10. 代码落点

新增（`packages/agent-tools/src/mcp-disclosure/`，runtime 无关）：`types.ts`、`plan.ts`、`index.ts`（BM25 + CJK n-gram + regex）、`tool-search.ts`、`mcp-invoke.ts`、`hint.ts`、`index.ts`（barrel 导出）。

改动（local-runtime）：`mcp/runtime-tools.ts`（保留 source 的列举 + 索引缓存）、`api/local-native-tools.ts`（接 plan、塑形 tools、回传 plan）、`api/host.ts`（提前 resolveModel、systemHint 追加、遥测）、`config/types.ts` + 读取（`mcpToolSearch` + `resolveMcpDisclosureOptions`）。

测试：`packages/agent-tools/test/mcp-disclosure/*`、`packages/local-runtime/test/unit/mcp/*`、一个真 E2E。

## 11. v1 可复用脚手架（来自 `feat/mcp-tool-search-disclosure-v1`）

可借鉴（需按 v2 改造，不直接继承提交）：`mcp-invoke.ts`（参数从 `name` 改 `tool_name`，其余校验/路由可复用）、`types.ts`（结构相近）、config 插件接线、`listRuntimeToolEntries`（server provenance，对齐到 `source`）、e2e 两跳 harness。需重写：`plan.ts`（加白名单+source 分类）、`tool-search.ts`（改 BM25/regex+CJK）；删除：`catalog.ts`（system-prompt catalog，v2 改为 `hint.ts` + 索引）。

## 12. 非目标与后续

- cloud-runtime：本期不接（无自定义 MCP 集成）；核心 runtime 无关，后续复用。
- Messages-compatible provider 系白名单模型：未来可切原生 `tool_search_tool_regex` / `tool_search_tool_bm25` + `defer_loading`（语义已对齐）。
- 更细粒度 defer：本期 all-or-nothing；后续可按相关性保留部分内联。
- 分词增强：CJK 默认 unigram+bigram；后续可评估 jieba 类分词库（权衡新依赖）。
- `estimateTokens`：默认启发式，后续可替换真 tokenizer。
- 索引预热：可选 `prewarmIndex`（MCP 连接就绪即建），用首轮延迟换取在不会 defer 的会话里也付出构建成本，默认关闭。

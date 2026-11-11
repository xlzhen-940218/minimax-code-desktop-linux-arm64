# PiTurnRunner 输入边界收敛方案

## 背景

`PiTurnRunner` 的目标边界是纯 agent-loop core：runtime
adapter 在每轮 turn 里把模型、历史、工具、hook 和事件出口显式注入，`agent-core` 只负责装配 Pi
Agent、驱动 turn、桥接事件，并在内部生成 event id / runtime seq。

旧实现有三处 runtime adapter 泄漏：

- runner input 直接接收 `agentConfig`，依赖 `@mavis/protocol` 的 `IAgentConfig`。
- runner input 直接接收 `modelResolver`，让 `agent-core` 在 turn 内调用 runtime resolver，把
  `AgentConfig.model` 翻译成 Pi runtime model。
- `pi-turn-runner` 和 `event-bridge` 内部使用模块级空 logger；真实 cloud-runtime logger 也固定在
  `packages/cloud-runtime/src/common/logger.ts`，其他 runtime adapter 不能复用。

本方案先定义目标接口和迁移步骤，后续实现按阶段拆分。

## 目标

1. `@mavis/agent-core/pi-turn-runner` 不再导入、导出或读取 `AgentConfig` / `IAgentConfig`。
2. runner 输入不再包含 `modelResolver`。调用方必须在调用 `runTurn()` 前完成模型解析，并把
   `PiTurnRunner` 真正消费的模型运行参数直接传入。
3. `PiTurnRunner` 的日志能力通过 constructor 注入窄接口；`agent-core`
   不依赖 cloud-runtime 的具体 logger。
4. cloud-runtime 当前 pino logger 的通用实现迁移到
   `packages/shared`，cloud-runtime 只保留自己的默认实例/薄封装。

## 非目标

- 不改变 `AgentConfig` 作为 cloud/local 上游协议和产品配置的角色。
- 不改变 `CloudModelResolver` 现有 Apollo model limit、thinking、multimodal、provider request
  policy 的行为，只调整它和 `PiTurnRunner` 的连接方式。
- 不在 `agent-core` 内新增业务级 model registry、profile、workspace 或 runtime 配置读取。

## 目标接口

### 模型参数

目标输入类型建议命名为 `RunTurnInput`。`PiTurnRunner` 仍是模块/类名，但单轮输入不需要再把 `Pi`
写进类型名；它表达的是“运行一轮 agent turn 所需的显式输入”。

`LLMModelConfig` 仅作为已解析模型运行配置的窄类型，方便 runtime helper /
tests 复用，不作为必须实例化的 class。

本项目在这个边界上不接受 `extends` 式拼装：`RunTurnInput` 不 `extends LLMModelConfig`，
`ToolExecutionContext` 也不作为 `TCtx extends ToolExecutionContext`
的泛型上界扩散。所有跨子域输入都用命名字段组合，避免模型配置、工具上下文和 turn
metadata 混到同一层命名空间。

```ts
export interface LLMModelConfig {
  model: Model<Api>;
  apiKey?: string;
  streamFn?: StreamFn;
  thinkingLevel?: ThinkingLevel;
  cacheRetention?: CacheRetention;
  maxTokens?: number;
  headers?: Record<string, string>;
  payloadTransform?: SimpleStreamOptions['onPayload'];
  auxiliaryPayloadTransform?: SimpleStreamOptions['onPayload'];
  responseObserver?: SimpleStreamOptions['onResponse'];
}

export interface ToolConfig {
  tools?: readonly RuntimeTool[];
  disableBuiltinToolFallback?: boolean;
  context: ToolExecutionContext;
}

export interface UserMessageInput {
  text: string;
  attachments?: readonly ImageContent[];
}

export interface RunTurnInput {
  sessionId: string;
  turnId: string;
  workspaceDir: string;
  systemPrompt: string;
  userMessage: UserMessageInput;
  llm: LLMModelConfig;
  eventWriter: PiEventWriter;
  history?: AgentMessage[];
  signal?: AbortSignal;
  toolConfig: ToolConfig;
  hooks?: PiTurnHooks;
}
```

设计取舍：

- 不引入 `PiModelResolver` / `modelResolver`，避免 `agent-core` 发起 runtime 配置解析。
- 不使用 `extends` 拼接 public input/config contract；`RunTurnInput.llm`、`RunTurnInput.toolConfig`
  都是组合字段。
- 不把 `LLMModelConfig` 包成 runtime class，也不再嵌套 `request`
  子对象；runner 只消费调用方已解析好的平铺 `input.llm`。
- `apiKey` 只来自 `RunTurnInput.llm.apiKey`。删除 `input.agentConfig.model?.api_key` fallback。
- `thinkingLevel` 只来自 `RunTurnInput.llm.thinkingLevel`，缺省为 `'off'`。删除
  `coerceThinkingLevel(input.agentConfig.model?.thinking_level)` fallback。
- `streamFn` 只作为已解析 `LLMModelConfig` 的 transport 字段存在，不再提供
  `RunTurnInput.streamFnOverride` 或 top-level raw provider override。provider
  request 行为继续拆成窄字段：
  `cacheRetention`、`maxTokens`、`headers`、`payloadTransform`、`responseObserver`。
- runner 内部继续用本包私有 wrapper 装配 provider call；有 `llm.streamFn` 时以它为 base，否则回退
  `streamSimple`。
- `ToolExecutionContext` 只作为 `ToolConfig.context`
  字段类型出现，不作为泛型继承边界；工具层如需更窄上下文，由调用方在绑定工具时自行组合/校验。
- `ToolConfig.tools` 使用 `RuntimeTool[]`。`RuntimeTool` 只是 legacy decorator path 的 migration
  alias，不作为新的 runner 输入边界类型。
- `agentName` 不进入 runner 输入；显示名、产品身份和日志标签由 host 侧处理，runner 只需要
  `sessionId` / `turnId`。
- `promptText` 和 `userImages` 收敛成 `userMessage.text` / `userMessage.attachments`。`attachments`
  覆盖 image/video 等多模态输入，不继续使用只表达 image 的字段名。
- `RespDataTransform` 不作为 `RunTurnInput` 参数；RespData/消息序列化改写属于 event
  bridge 或 host 消息管线，不属于单轮 runner 输入。

### Provider request policy 现状拆解

当前代码里所谓 provider transport wrapper 主要集中在 `CloudModelResolver.resolveModel()` 返回的
`streamFn` 和 `runPiTurn()` 传给 runner 的 provider hook 上。它们不应该继续作为一个 raw `streamFn`
跨过 runner 边界，而应该拆成以下窄配置：

1. `max_tokens` cap

   现状：`CloudModelResolver.makeCappingStreamFn(cap)` 包一层 `streamSimple`，当 Pi/调用方没有传
   `options.maxTokens` 时补上 Apollo `ModelRef.max_tokens`、pi-ai
   catalog 或 fallback 得到的 cap。这样 provider 请求上的 `max_tokens` 和 `model.maxTokens`
   保持一致，避免落回 pi-ai 默认的 `(model.maxTokens / 3) | 0` heuristic。

   目标：host 解析后把 cap 写入 `LLMModelConfig.model.maxTokens` 和 `LLMModelConfig.maxTokens`。
   `PiTurnRunner` 自己在内部 provider call wrapper 里填充 `options.maxTokens`，不接收 host 传入的
   `streamFn`。

2. LLM trace / response trace

   现状：cloud-runtime 在 `runPiTurn()` 里传 `onResponse`，从 provider response headers 中提取
   `x-trace-id` / `trace-id` / `uber-trace-id` 并打日志。

   目标：正式链路使用 `LLMModelConfig.responseObserver` 或更窄的 trace
   callback，runner 在收到 provider response 后调用。测试不通过 `RunTurnInput.streamFn`
   或任何 runner public seam 替换 provider call。

3. 请求 header 注入

   现状：`RunTurnInput.headers` 由 runner 包装进每次 provider call，例如 cloud-runtime 用
   `X-MM-Request-Id` 透传 traceId。

   目标：移动到 `LLMModelConfig.headers`。runner 负责和每次 call-site options 做确定性 merge。

4. payload patch / 请求体改写

   现状：cloud-runtime 通过 `onPayload` 做两件事：视频模型把 provider image
   block 改成 provider 兼容的 video block；OpenPlatform thinking patcher 根据模型配置调整 provider
   payload。

   目标：移动到 `LLMModelConfig.payloadTransform`，仍然是一个窄 hook：输入/输出 provider
   payload，不暴露完整 transport。它只改 payload，不负责发请求。主回答专属的约束不得污染 checkpoint 等辅助调用；Host 可通过
   `auxiliaryPayloadTransform` 提供辅助请求链，未提供时为兼容既有 Host 而回退到 `payloadTransform`。

5. 测试 override 删除

   现状：一些单测把 `streamFnOverride` 传给 `runPiTurn()`，再被包装进 `modelResolver`
   返回值，用来模拟 LLM 要求调用工具、返回消息或触发边界。这个诉求本质是测试便利：让测试不用真实 provider 也能稳定驱动 agent-loop 进入特定分支。

   目标：干掉这类替换 provider call 的测试 seam，不把它保留为 constructor
   option、hook、adapter 或 per-turn input。对应测试按被测对象下沉或上移：
   - hook / tool gate / event bridge 行为用各自单元测试直接覆盖，不通过伪造 LLM response 间接触发。
   - `PiTurnRunner` 自身只保留不需要替换 provider call 的装配、错误、事件桥接、终止语义测试。
   - 需要真实 provider loop 语义时走影响面 E2E，而不是在 runner 边界塞一个替换 transport。

   核心约束是：`RunTurnInput` 只描述本轮业务/模型/工具输入；`PiTurnRunner` 的 public
   surface不携带“替换整个 provider 调用”的函数。

### Logger 接口

`agent-core` 定义自己消费的最小 logger shape：

```ts
export interface PiTurnRunnerLogger {
  debug?(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
  warn?(obj: unknown, msg?: string): void;
  error?(obj: unknown, msg?: string): void;
}

export interface PiTurnRunnerOptions {
  messageIdAllocator?: PiMessageIdAllocator;
  nowMs?: () => number;
  metricsClient?: MetricsClient;
  logger?: PiTurnRunnerLogger;
}
```

constructor 目标形态：

```ts
new PiTurnRunner({
  messageIdAllocator,
  nowMs,
  metricsClient,
  logger,
});
```

收敛策略：

- `PiTurnRunner` constructor 只接受 `PiTurnRunnerOptions`；旧 positional overload 已移除。
- 新增 constructor dependency 时继续扩展 `PiTurnRunnerOptions`，避免重新引入位置参数。
- `PiTurnRunner` 默认使用 no-op logger，但 no-op 只在实例字段上，不再使用模块级 `const logger`。
- `EventBridge` / `resp-data` 如需记录非致命转换失败，也应通过 `PiTurnRunner`
  传入的 logger 或独立窄接口注入，避免重新引入模块级 logger。

### shared logger

把 `packages/cloud-runtime/src/common/logger.ts` 中通用部分迁到 `packages/shared`：

```text
packages/shared/src/logging/
  structured-logger.ts
  index.ts
```

建议导出：

```ts
export interface TraceContextLike {
  traceId: string;
}

export interface StructuredLoggerOptions {
  level?: string;
  colorize?: boolean;
  destination?: NodeJS.WritableStream | number;
  env?: NodeJS.ProcessEnv;
}

export function createStructuredLogger(options?: StructuredLoggerOptions): pino.Logger;
export function wrapTraceContextLogger(logger: pino.Logger): pino.Logger;
```

cloud-runtime 保留：

```ts
import { createStructuredLogger, wrapTraceContextLogger } from '@mavis/shared/logging';

export const logger = wrapTraceContextLogger(createStructuredLogger());
```

这样 cloud-runtime 仍拥有自己的默认 logger 实例，agent-core 只接收一个
`PiTurnRunnerLogger`，两者不会互相依赖。

## 迁移步骤

### 阶段 1：抽出类型和 logger 注入

1. 在 `packages/agent-core/src/pi-turn-runner/types.ts` 新增
   `LLMModelConfig`、`PiTurnRunnerLogger`、`PiTurnRunnerOptions`。
2. `PiTurnRunner` constructor 支持 options object，保存 `this.logger`。
3. 替换 `pi-turn-runner.ts` 内模块级 `logger` 为 `this.logger`。
4. `event-bridge` 的 warning/error 路径通过 constructor 参数或 bridge options 接收 logger。
5. 增加 unit test 覆盖 logger 注入、默认 no-op、旧 constructor 兼容。

### 阶段 2：删除 `PiModelResolver` 输入边界

1. 引入 `RunTurnInput.llm: LLMModelConfig`，承载 `model`、`apiKey`、`thinkingLevel`、
   `cacheRetention`、`maxTokens`、`headers`、`payloadTransform`、`auxiliaryPayloadTransform`、
   `responseObserver`。
2. 引入 `RunTurnInput.toolConfig: ToolConfig`，承载
   `tools`、`disableBuiltinToolFallback`、`context`。
3. 引入 `RunTurnInput.userMessage: UserMessageInput`，替代 `promptText` / `userImages`。
4. 删除 `agentName` 和 `respDataTransform` 作为 runner 输入；RespData 改写留在 EventBridge / host
   outbound event pipeline，不放入 `PiTurnHooks`。
5. `PiTurnRunner.runTurn()` 删除 `modelResolver.resolveModel(...)` 调用，直接读取 `input.llm`。
6. 删除 `agentConfig` fallback：`getApiKey` 只比较 provider 并返回 `input.llm.apiKey`；checkpoint
   thinking 只看 `input.llm.thinkingLevel ?? 'off'`。
7. 删除 `RunTurnInput` / hook input 中任何 top-level raw `streamFn` 输入，并删除 `streamFnOverride`
   这类测试入口；替换 provider call 只能通过已解析的 `LLMModelConfig.streamFn`。
8. 删除旧 resolver 相关 exports；已解析模型配置统一收敛到 `LLMModelConfig`。
9. 更新 `packages/agent-core/test/unit/pi-turn-runner` 和 `event-bridge/integration-gaps`
   fixture，测试里直接传模型配置。

### 阶段 3：host 侧预解析模型

1. cloud-runtime 将 `CloudModelResolver.resolveModel({ agentConfig })` 改为普通 helper，例如
   `buildCloudLLMModelConfig(agentConfig, options): Promise<LLMModelConfig>`。
2. `runPiTurn()` 在调用 `piRunner.runTurn()` 前执行 helper，并把结果放入 `input.llm`。
3. 删除 `streamFnOverride` 作为 `runPiTurn()`
   参数的测试/调用路径；相关测试改为直接测试 hook/tool/event 子域，或提升到真实 E2E。
4. `cloud-task` 子任务路径同样先解析 `resolved.config`，再传 `LLMModelConfig`。
5. local-runtime 对应的 local model resolver 改成 host-side builder；local compaction
   routes 若仍需要模型解析，直接调用 local helper，不经过 `PiTurnRunner`。

### 阶段 4：shared logger 迁移

1. 在 `@mavis/shared/logging` 落通用 pino pretty stream、caller source、traceId wrapper。
2. cloud-runtime `common/logger.ts` 改为从 shared 创建实例，并保留 `CloudRequestContext`
   类型 re-export。
3. 将 `new PiTurnRunner(...)` 的 cloud-runtime 构造点注入 `logger`。
4. 如 local-runtime 需要日志，也可注入自己的 logger；否则使用 no-op。

## 影响面

需要更新的主要调用点：

- `packages/cloud-runtime/src/host/pi-session/run-pi-turn.ts`
- `packages/cloud-runtime/src/host/pi-session/cloud-model-resolver.ts`
- `packages/cloud-runtime/src/tools/cloud-task.ts`
- `packages/local-runtime-v2/src/http/host/host.ts`
- `packages/local-runtime-v2/src/http/host/initialize.ts`
- `packages/local-runtime-v2/src/http/host/routes/compaction.ts`
- `packages/agent-core/test/unit/pi-turn-runner/pi-turn-runner.test.ts`
- `packages/agent-core/test/unit/event-bridge/integration-gaps.test.ts`
- `packages/cloud-runtime/test/unit/host/cloud-model-resolver.test.ts`

`AgentConfig` 仍会存在于 cloud/local host、prompt composer、tool filtering、subagent
gate、capability gate 等产品层逻辑中；本方案只要求它不进入 `agent-core` runner 边界。

## 验证计划

实现 MR 至少覆盖：

- `pnpm --filter @mavis/agent-core test`
- `pnpm --filter @mavis/cloud-runtime test -- test/unit/host/cloud-model-resolver.test.ts`
- `pnpm --filter @mavis/cloud-runtime test -- test/unit/run-pi-turn-tool-hooks.test.ts`
- `pnpm --filter @mavis/cloud-runtime test -- test/unit/tools/cloud-task.test.ts`
- `node scripts/test/focused-vitest.mjs --package @mavis/local-runtime-v2 <test-file...>`：受 `modelResolver` 迁移影响的单测

若修改 cloud-runtime turn 执行链路，MR ready 前还需要影响面相关真实 E2E：

- `pnpm test:e2e:archon-real-chain`

纯 logger shared 化需要额外跑 cloud-runtime logger 使用面相关单测，并通过一次本地 runPiTurn
smoke 确认 traceId 仍能落到日志。

## 风险与处理

- `modelResolver throws` 的失败分支会消失。新的失败点在 host 调 `buildCloudLLMModelConfig()`
  前置阶段；host 需要沿用现在的 failed terminal emission 语义，避免用户看到 turn 卡住。
- 删除 `agentConfig.model.api_key` fallback 后，所有 host 必须显式传
  `apiKey`。测试 fixture 也不能再靠空 `agentConfig` 过编译。
- `thinkingLevel` 默认值从 `agentConfig` 推断改为 host 显式传入，cloud/local helper 必须保持现有 IDL
  enum 到 Pi thinking union 的映射。
- shared logger 迁移不能改变 cloud-runtime 当前输出格式；先 snapshot 关键日志格式或加单测锁定
  `[source] [traceId] msg extras` 行为。
- constructor 从 positional 迁到 options object 时，要先保留兼容 overload，避免一次性改动过大。

## 完成判定

- `rg "AgentConfig|IAgentConfig|PiModelResolver|modelResolver" packages/agent-core/src/pi-turn-runner packages/agent-core/src/event-bridge`
  不再命中边界类型或 runner 实现。
- `@mavis/agent-core/pi-turn-runner` exports 不再暴露 `AgentConfig` 或旧 resolver 类型。
- `PiTurnRunner.runTurn()` 的模型输入只来自 `RunTurnInput.llm`。
- `RunTurnInput`、`LLMModelConfig`、`ToolConfig` 等 runner 边界类型不使用 `extends`
  拼装；工具上下文通过组合字段传入。
- `RunTurnInput` 不包含 `agentName`、`promptText`、`userImages`、`respDataTransform`；用户输入通过
  `userMessage` 表达，工具输入通过 `toolConfig` 表达；RespData 改写属于 EventBridge / host outbound
  event pipeline，不属于 `PiTurnHooks`。
- `RunTurnInput` / `LLMModelConfig` / hook input 不暴露 raw `streamFn`；runner public
  surface 不提供替换 provider call 的测试或运行时入口。
- `PiTurnRunner`、`EventBridge` 不再使用模块级 logger。
- cloud-runtime logger 通用实现来自 `@mavis/shared/logging`。

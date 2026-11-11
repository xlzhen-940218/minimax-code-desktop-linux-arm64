# Agent-Core 全局架构 Overview

> 本文定义 `@mavis/agent-core` 的终态架构口径，只描述最终架构、模块职责、依赖方向和边界原则。
>
> 核心结论：`agent-core` 是纯净的 agent-loop core。它由
> `pi-turn-runner`、`tools`、`event-bridge`、`protocol` 四个核心模块组成。
>
> 扩展能力通过 `pi-turn-runner` 暴露的 lifecycle hooks 注入；具体模块去向见文末迁移矩阵。

## 1. 架构定位

`agent-core` 是 Mavis agent-loop 的纯核心。

它负责把 runtime 在每轮 turn 中提供的模型、历史、工具、hook 和事件出口装配进 Pi
Agent；负责在 provider call 前暴露稳定扩展点；并负责把 Pi
agent-loop 过程中产生的事件转换成 Mavis 标准 runtime event。

```text
runtime turn input
  -> PiTurnRunner
  -> lifecycle hooks
  -> Pi Agent
  -> AgentEvent
  -> EventBridge
  -> RuntimeEvent
  -> runtime event writer
```

`agent-core`
的边界是 agent-loop 本身。它不承载 local/cloud 的产品生命周期，也不承载具体 runtime 的业务状态。

## 2. 模块组成

终态 `agent-core` 由四个核心模块组成：

```text
packages/agent-core/src/
|
|-- index.ts
|
|-- pi-turn-runner/
|   |-- index.ts
|   |-- pi-turn-runner.ts
|   |-- hooks.ts
|   |-- llm-retry.ts
|   |-- types.ts
|   |-- outbound-message-normalizer.ts
|
|-- tools/
|   |-- index.ts
|   |-- types.ts
|   |-- define.ts
|   |-- bind.ts
|   |-- result.ts
|   |-- schema-utils.ts
|
|-- event-bridge/
|   |-- index.ts
|   |-- bridge.ts
|   |-- converters.ts
|   |-- resp-data.ts
|   |-- types.ts
|
|-- protocol/
|   |-- index.ts
|   |-- agent-event.ts
|   |-- runtime-event.ts
|   |-- agent-message.ts
```

四个模块的关系：

```text
agent-core
|
|-- pi-turn-runner
|   |-- agent-loop 主入口
|   |-- 每轮 turn 的 Pi Agent 装配和运行
|   |-- 串联 model / tools / hooks / event bridge / runtime event writer
|   |-- 暴露 agent-loop 生命周期扩展点
|
|-- tools
|   |-- 工具协议层
|   |-- 定义 runtime tool 如何被 runtime 声明、如何被 PiTurnRunner 装配
|
|-- event-bridge
|   |-- 消息透出层
|   |-- AgentEvent -> RuntimeEvent 的协议转换
|
|-- protocol
|   |-- 协议权威层
|   |-- agent-loop 相关 message / event / wire contract
```

## 3. 总体依赖方向

```text
local-runtime / cloud-runtime / runtime adapter
        |
        | RunTurnInput + RuntimeTool[] + history + hooks
        v
@mavis/agent-core/pi-turn-runner
        |
        | lifecycle hooks
        v
@earendil-works/pi-agent-core / pi-ai
        |
        | AgentEvent
        v
@mavis/agent-core/event-bridge
        |
        | RuntimeEvent[]
        v
runtime event writer
```

`agent-core` 只依赖 agent-loop 所需的底层 Pi 能力和 Mavis runtime 协议：

```text
agent-core -> @earendil-works/pi-agent-core / pi-ai
agent-core -> @mavis/protocol
```

Runtime packages 位于 `agent-core`
外层，负责提供运行环境、工具实现、事件投递、存储和产品策略。Runtime 也负责选择是否注入 lifecycle
hook 实现。

### 3.1 Boundary naming

`port` 是 Ports and
Adapters 架构术语，不是 TypeScript 特有命名，也不表示网络端口号。新增 agent-core 边界采用接近 Go 的接口命名习惯：

- 接口按消费者需要的能力命名，例如 `EventDelivery`、`SessionResolver`、`MessageSink`、`ToolBinder`。
- 接口放在 owner 模块的 `types.ts`、`hooks.ts` 或能力文件中；不新增独立 `host-ports.ts`
  作为默认文件。
- 不使用 `XxxPort` / `host-ports.ts`
  作为架构命名规范；历史命名只表示待收敛现状，不作为新增或重构依据。
- 涉及真实网络端口号时使用 `listenPort`、`httpPort`、`allocatedPort`
  等明确字段，避免和架构 port 混淆。

## 4. `pi-turn-runner`：agent-loop 主模块

`pi-turn-runner` 是 `agent-core` 的核心入口。

它负责每轮 turn 的装配和运行：

```text
接收 runtime turn input
接收 resolved model config / runtime tools / hooks / event writer
装配 Pi Agent
在 Pi Agent 生命周期边界触发 hooks
运行 Pi Agent turn
订阅 Pi AgentEvent
调用 EventBridge 转换 RuntimeEvent
把 RuntimeEvent 交给 runtime event writer
发出 terminal session.status event
```

`PiTurnRunner` 的设计口径：

```text
PiTurnRunner = per-turn Pi Agent assembler + agent-loop runner + hook caller + event bridge entry
```

它自身不拥有 session 状态。history、message persistence、event writer、resolved model config、tool
context、agent module hook 都由 runtime adapter 通过 `RunTurnInput` 显式注入；event id / runtime
seq 在 agent-core 内部按 turn 闭环生成。

每轮 `runTurn()` 都是清晰的输入输出边界：

```text
RunTurnInput
  -> PiTurnRunner.runTurn()
  -> Promise<void>
  -> terminal session.status RuntimeEvent
```

### 4.1 Turn input contract

`LLMModelConfig.hostMaxOutputTokens` 是静态输出上限，`resolveHostMaxOutputTokens` 可注入 host 的剩余额度读取函数。Core 在每次物理 provider 请求（包括 retry 和辅助请求）前读取，取静态上限、动态额度、调用参数和模型上限的最小值；动态额度为 0 时拒绝请求，不自动放宽限制。它不拥有 Goal 账本，也不把可控输出上限当作 input/reasoning 等总 usage 的硬预算。请求诊断只记录当时解析后的数值，不序列化 resolver。

`pi-turn-runner` 不设置独立 `host-ports` 模块，也不使用 `XxxPort`
后缀表达每轮依赖。每轮 turn 需要的外部能力都通过 `RunTurnInput` 显式传入，并按能力命名：

```text
LLMModelConfig
  runtime adapter 已解析好的本轮模型、provider、streamFn、thinking/cache 等模型运行配置。

PiEventWriter
  接收 EventBridge 输出的 RuntimeEvent[]，并投递到调用侧事件系统。

RuntimeTool[] / RuntimeTool[]
  runtime adapter 为本轮 turn 提供的工具集合。

PiTurnHooks
  本轮 turn 注入的 lifecycle hook 集合，类型定义在 `pi-turn-runner/hooks.ts`。
```

`RunTurnInput.startMode` 决定本轮怎样进入 Pi agent-loop：默认 `prompt` 会追加调用方提供的 user message；
`continue` 则要求 runtime 已提供可继续的 history，并直接调用 Pi `continue()`，不合成隐藏 prompt。是否允许
continue、如何裁剪失败的尾节点，以及对应的产品/持久化状态都属于 runtime 外层职责。

这些字段体现一个核心原则：

```text
agent-core 定义 loop seam 与 hook contract，runtime 选择并注入 agent module。
```

`projectAgentMessagesForModel(...)` 是 `pi-turn-runner` 对外提供的纯 provider-bound projection：normal
Turn 与 Host 发起的辅助模型调用共用 `convertToLlm`、orphan tool-result 清理、目标模型 thinking 兼容和
video projection。它只返回临时请求副本，不改写 canonical History。

目标模型不能接收的媒体也在这里换成文字占位：`video/*` 的 image 块跟随视频支持，其余 image 块跟随图片支持。
支持情况读取模型对象上的可选 `supportsImageInput` / `supportsVideoInput`（`ModelRequestMediaSupport`，由
runtime 的 model resolver 按 capabilities 设置），未设置时回退到 `model.input.includes('image')`。pi-ai
只有一个 `image` 模态，视频也以 image 块传输，所以只支持视频的模型在 `input` 里仍含 `image`，它不能接收的
静态图片由这一步丢弃。

thinking 签名绑定前缀（改动 assistant 轮次之前的任何内容都会让它的签名 thinking 失效）只有一个判定：
`hasThinkingPrefixBinding(model)`（`thinking-prefix-binding.ts`）。它先读模型对象上的
`thinkingPrefixBinding`（`ModelThinkingPrefixBinding`，由 runtime 的 model resolver 按
`capabilities.thinking_prefix_binding` 设置），未声明时按模型 id 识别 Messages API 模型家族。所有保护前缀的步骤都读它：
请求副本不做图片张数截断、request media guard 不换占位、不按请求体字节触发压缩（这三处让前缀保持不变），
以及 isolated 摘要请求去掉 thinking（它的 system 与 tools 不同，前缀必然改变）。跨模型 thinking 回放规则也只在
`normalizeOutboundMessagesForModel` 一处，token 计数直接调用它。

### 4.2 LLM transport retry contract

`pi-turn-runner` 在 provider `StreamFn` 边界提供 host opt-in 的 transport
retry；是否启用由 runtime 通过 `RunTurnInput.llmRetry`
显式决定。当前 local-runtime 为主 turn 和自动 compaction 统一启用，cloud-runtime 不注入该字段，因此保持原行为。

重试 contract：

```text
initial provider request
  -> pre-commit transient failure
  -> bounded backoff
  -> retry provider request
  -> first committed assistant output
  -> no further transport retry
```

- 默认在首次请求后最多重试 5 次；采用 equal-jitter exponential backoff，尊重并钳制
  `Retry-After`，同时受单次 delay 和总 retry elapsed budget 限制。
- 只允许连接 timeout、network failure、HTTP 429、TPM/RPM throttle 和 HTTP 529 /
  overload 进入重试。Token Plan / usage limit、credits、auth、显式 abort、bad request、content
  filter、generic 5xx 和 unknown failure 均 fail closed。
- provider native retry 固定为 0，避免 framework budget 与 SDK budget 叠加。
- `composeStreamFn` 为每个 physical attempt 套首事件与空闲超时（`llm-stream-timeout.ts`），默认首事件 300 秒、空闲 60 分钟：
  首个 provider stream event 300 秒未到，或之后连续 60 分钟无事件时中止该 attempt。只有解析出的模型事件计入，SSE
  注释心跳不计入；缓冲上游、只发心跳的网关会让整段长思考看起来空闲，因此空闲默认值须覆盖长思考生成时间，完全无字节的断连由
  transport body timeout（undici 300 秒）兜底。超时以可重试的 `LLM request timed out`
  错误（`stopReason: "error"`）结束，交给上面的 retry 判定；调用方 abort 原样透传。可用
  `LLMModelConfig.firstEventTimeoutMs` / `streamIdleTimeoutMs` 或
  `MCODE_LLM_FIRST_EVENT_TIMEOUT_MS` / `MCODE_LLM_STREAM_IDLE_TIMEOUT_MS` 覆盖，`0` 关闭；20 分钟总超时仍然生效。
- `start`、空 `text_start` 等结构前缀会暂存在 framework 内；只有尚未提交可见 text、thinking 或 tool
  call 时才允许丢弃失败 attempt。输出一旦提交，后续错误原样交给 Pi，不重新执行该调用。
- 若 provider stream 在首个有效输出前断开，terminal attempt 的 iterator 与 `result()`
  必须以同一个已捕获错误收敛；不得继续等待 provider 未结束的 result
  promise，保证 title、compaction 等 result-only 调用能够结束。
- 每个 physical attempt 独立记录 request 指标；只有最终 logical call 失败才归因到 turn
  failure。retry observer 只暴露有限枚举 reason/scope，不把 sessionId、turnId、callId 写入 metric
  labels。
- `waiting.error.reason` 表示触发当前 retry
  episode 的 transient 错误；若后续 attempt 变成不可重试错误， `exhausted.error` 的 reason / code /
  message 必须取最后一次 provider attempt。对应地， `pi_llm_retry_exhausted_total{reason}`
  按最终错误归因，而 `pi_llm_retry_episode_total{reason}` 始终保留首次触发重试的原因。

重试指标按 physical attempt、logical call、retry
episode 三层拆分，避免把额外请求次数误当成成功率分母：

| metric                       | 计数时机                               | 关键 labels                                                 |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `pi_llm_request_total`       | 每个实际发出的 provider request        | `provider` / `model` / `caller`                             |
| `pi_llm_request_error_total` | 每个失败的 provider request            | 同上 + 有限枚举 `errorKind`                                 |
| `pi_llm_logical_call_total`  | 每个 logical call 的最终终态           | 同上 + `scope` / `outcome` / `errorKind` / `retryTriggered` |
| `pi_llm_retry_episode_total` | 实际触发过重试的 logical call 最终终态 | 同上 + `scope` / `reason` / `outcome`                       |

- 原始 provider request 成功率继续使用既有 physical 指标：(`pi_llm_request_total` -
  `pi_llm_request_error_total`) /
  `pi_llm_request_total`。自动重试不会改变这两个指标的定义，但一次 logical
  call 现在可能产生多个 physical request。
- 重试后的最终成功率使用 `pi_llm_logical_call_total{outcome="success"}` / 全部非取消 logical call。
- 自动重试恢复率使用 `pi_llm_retry_episode_total{outcome="recovered"}` / (`recovered` +
  `failed`)；用户取消单独落入 `cancelled`，不进入恢复率分母。
- 可重试错误类型占比直接复用 `pi_llm_request_error_total{errorKind}`：将 `timeout`、`network`、
  `rate_limited`、`tpm_rate_limited`、`overloaded` 相加后除以全部 request
  error。实际是否发起下一次 request 还受输出是否已提交、retry budget 和取消状态约束。
- `errorKind` 复用有限枚举错误分类，logical 成功统一写 `none`；不增加原始 status
  code、错误 message 或任何 session/turn/call ID label。

### 4.3 宿主发起的 PTC 子调用

`ToolConfig.tools` 是模型可见目录，`ToolConfig.ptcTools` 是宿主显式提供的子调用授权目录。两者分开保存；缺少后者时不提供隐式回退。`pi-turn-runner/ptc-tool-executor.ts` 只接受当前 pending 的真实 `run_code` 父调用，通过 vendored Pi 的共享单次生命周期执行子工具，保留参数准备、原 hooks、真实来源、取消及进度。Worker、工具分类和产品开关都由 Runtime 提供，core 不依赖解释器或 Desktop 实现。

子调用使用宿主分配的 ID，经同一个串行事件出口携带 `parentToolCallId`；它们不写成模型发出的同级 tool call。子调用事件不经过 `agent.subscribe`，所以只有本 Turn 装配了 LLM capture 时，runner 才把 capture 转发器作为 `observeChildLifecycle` 交给 executor，在事件产生、进入串行出口之前同步通知；未装配时 executor 行为不变。PTC 父子事件的必需持久化失败必须传播，开始事实未确认前不能执行副作用。终态先生成安全投影，再发送附有 `details.ptc_child` 的展示副本；原工具结果与来宾结果不因此混入宿主审计字段。

`tools/ptc.ts` 定义外层与子调用事实的共同契约和严格读取函数，Goal、压缩与恢复从该契约消费真实记录，不解析 JS 或模型文本。用户拒绝编排中的审批只让该子调用失败（`PTC_PERMISSION_DENIED`），不是控制状态，程序继续执行；插件终止 Agent 只能在本轮真正的 PTC 父调用上提升为严格终止，不改变原生工具批次的终止语义。

程序墙钟只由 `ptc-tool-executor.ts` 的批次时钟计算，派发检查、来宾墙钟（经 `getBatch`）和子调用的 `ptcDeadline` 都读它。子调用的准入阶段（Pi `beforeToolCall` 链：子工具策略、安全检查、插件 hook、计划模式和权限门，含等待用户审批）不计入墙钟：期间时钟暂停，期限顺延、剩余时间不变，和原生调用在准入之后才开始计时一致。

PTC 的证据归属与权限来源分开处理。Runtime 可随内部执行请求提供可信工具对象的证据身份；core 仅在该对象与实际选中的工具相同时，将它用于安全参数、Bash 退出及结果引用投影。该身份不进入来宾协议、工具参数、事件或持久化，也不改变原 `RuntimeTool.source`。不能为补证据把普通原生工具标成 `builtin`，因为既有权限链会赋予该来源不同语义。

## 5. Lifecycle hooks

`pi-turn-runner` 暴露 agent-loop 生命周期扩展点。Hook 是 `agent-core` 的边界 contract；hook
implementation 由 runtime 或外部模块提供。

Hook contract 统一定义在 `pi-turn-runner/hooks.ts`，并通过 `PiTurnHooks` 注入
`runTurn()`。Hook 字段使用列表表达组合关系，`PiTurnRunner` 负责确定调用顺序和组合语义。

物理 LLM request 的旁路观测通过 `PiTurnRunnerOptions.observeLLMRequest`
注入：request 开始时可返回一个 settlement closure，core 在该 request 结束时传入 cache
telemetry。该 seam 只表达通用 request 生命周期；local/cloud 产品状态、具体工具关联和业务指标均由宿主实现，且 observer 任一阶段抛错都不得影响 turn。

核心 hook 类型统一使用 `xxxHook` 命名：

```text
beforeLlmCallHook
  provider call 前的扩展点，可返回 continue / skip / replaceRequestMessages / replaceMessages /
  appendMessage / respond / abort。appendMessage 只接受隐藏的 typed custom message，且不结束 decision
  pipeline：marker 按注册顺序累积，立即进入后续 hook 的 `messages`（tail marker 在末尾，
  `before-current-user` marker 在当前真实 user 之前）和 `canonicalMessages`，后续 hook 照常执行。
  所有 hook 结束后，PiTurnRunner 先做至多一次 durable replace（含 placed marker；afterCommit 消息排在
  所有 tail marker 之前），再按顺序追加全部 tail marker 并只 flush 一次 history，失败即 fail-closed。
  已登记 append 之后出现 durable `replaceMessages` 会 abort（生产顺序是 compaction 先于所有 append
  reminder）。hook input 的 `messages` 是可被 request-only transform 改写的 provider view，
  `canonicalMessages` 是本次 checkpoint 提交后的 canonical 视图；可选的
  `maxSerializedInputBytes` 由 Host 映射最终 provider request 的 serialized byte cap，供
  post-transform context admission 使用。
  `respond` 只允许 host 已验证的非空文本，并在不发起 provider 请求的前提下生成一条零 usage
  assistant response；它用于将独立执行器已经完成的可信结果提交回当前 Turn，不得用于绕过普通模型调用。

onLlmCallPreparedHook
  主 agent 请求准备完成后的只读观察点；位于 before-LLM 决策/提交与消息变换之后、
  transport retry 之前。每个逻辑调用通知一次；appendMessage 后仍调用，respond/abort
  不调用，compaction/title 辅助请求不调用。观察器异常逐个隔离，不参与业务决策。
  Extension API 通过 on_llm_call_prepared 注册，Eval 与 Session Report 共用这个边界。

afterLlmCallHook
  assistant `message_end` 后、Pi 选择并执行 tool call 前的窄控制点。可返回 continue、
  retry（通过 Pi 内部 follow-up queue 在同一 product turn 重试）或 fail；fail 会删除尚未执行的
  tool intent。retry 拒绝的 response 不进入 EventBridge completed message 或 history；空 response
  被 fail 拒绝时同样丢弃。retry 还会同步删除 Pi loop 中的 tool intent，并在下一次 provider
  call 前从实际 loop context 移除被拒绝 response。hook 异常按 fail-closed 处理，并阻止响应携带的
  tool call 产生副作用。fail 决策还会在当前 step 边界终止 Pi loop，不消费该 step-end hook
  新排入的内部 steering / follow-up，也不再发起 provider call。

beforeToolCallHook / afterToolCallHook
  tool call 前后的扩展点，用于 permission、argument rewrite、result rewrite。
  beforeToolCallHook 可在实际 block 时附带 `blockedBy: 'permission'`。Core 仅在存在 step hook 时
  于当前 step 内存记录 `{ toolCallId, blockedBy }`，经 onStepEndHook 的只读 `blockedToolCalls` 传递；
  调用 step hooks 前交换数组引用，后续 step 不修改已交出的记录。不从工具输出推断，
  before-tool hook result 原样返回，不改变权限决策或 ToolResult/History/provider payload。
  异常隔离保留在各 step hook 和观测回调边界，不为内部数组操作增加 catch 或不可用状态。

onHistoryChangedHook
  history state 变化后的扩展点，用于 runtime 持久化/通知。
  触发源包括 agent-loop 新增 message delta，以及 beforeLlmCallHook 返回
  replaceMessages 后的 message state 替换。
  hook resolve 是 delivery ack：PiTurnRunner 只在全部 hook ack 后推进 history
  cursor；任一 hook 最终失败则本 turn fail-close，不继续执行尚未开始的 tool 或下一次 LLM。

onStepEndHook
  单个 pi step boundary 上的同 step 控制扩展点。字段命名对齐
  `@mavis/agent-runtime` SPI；built-in domain adapters 集中在独立的
  `@mavis/agent-extension`。"step" = 单次 LLM assistant response + tool 执行；
  一整轮 agent.run() 是 "turn"，一个 turn 内多个 step。
  preferred payload 类型为 `PiStepEndHookInput`；历史名称
  `PiTurnEndHookInput` 仅作为 deprecated compatibility alias 保留。

onTurnEndHook (deprecated)
  历史上的 step-boundary 名称；当前仍在每个 pi `turn_end` 时触发。新代码使用
  `onStepEndHook`。若未来需要整轮 `agent.run()` / `agent_end` hook，应新增具有真实
  lifecycle seam 和准确 payload 的独立契约，而不是改变该兼容字段的既有语义。
```

Local Runtime V2 的 product continuation 只通过 `RunTurnInput.getSteeringMessages` 与
`tryBeginClose` 接入；`RunTurnInput` 不提供 external product follow-up callback。Pi
agent-loop 内部的 `followUp()` 仍可由上述 hook policy 使用，但不能承载 Dispatcher queue 或绕过 Host
assembly / Turn admission。

列表语义：

```text
decision hooks
  beforeLlmCallHook / afterLlmCallHook / beforeToolCallHook / afterToolCallHook 按顺序组成
  pipeline。

notification hooks
  onHistoryChangedHook 作为按顺序 await 的 fan-out delivery 列表；全部成功才提交 cursor。

boundary hooks
  onStepEndHook 按顺序执行，避免多个模块争用同一个 step boundary。
  deprecated onTurnEndHook 作为 legacy step hook concat 到 onStepEndHook 后触发。
```

`PiTurnRunner` 负责 hook 调用和必要的 Pi state 写入；hook implementation 负责具体决策。

## 6. `tools`：工具协议层

`tools` 定义 Mavis runtime tool 的核心协议。

它负责描述一个工具如何被模型看到、如何被 runtime 执行、如何被 PiTurnRunner 装配。

核心概念：

```text
ToolDefinition
  模型可见 contract：name、description、schema、executionMode、prepareArguments；
  可选 operationClassifier 为观测提供 source-owned 固定词表，不进入 provider schema。

ToolImpl
  runtime 执行 contract：execute(ctx, input, signal, onUpdate)。

RuntimeTool / RuntimeTool
  ToolDefinition + ToolImpl 的组合体，是 runtime 传给 PiTurnRunner 的工具单元。

ToolResult
  工具执行结果 contract。

ToolExecutionContext
  runtime 注入给工具执行的上下文。
```

工具边界口径：

```text
agent-core owns tool protocol.
runtime owns concrete tools.
```

因此，`tools` 不表达 local 或 cloud 的真实执行环境，只表达所有 runtime tool 共同遵守的协议。

同名工具可以由不同 runtime 提供不同实现和不同模型描述。例如：

```text
local-runtime: bash/read/edit 运行在本地 workspace 和本地权限模型中。
cloud-runtime: bash/read/edit 运行在 cloud sandbox 和 cloud permission / gateway 模型中。
```

`PiTurnRunner` 只关心这些工具是否满足 `RuntimeTool` 协议，不关心工具来自哪个 runtime。

`operationClassifier` 只参与通用 result 大小观测。具体工具维护固定 allowlist 和参数解析，
`PiTurnRunner` 校验分类结果是否属于 allowlist，并将异常或未命中值归入
`unknown`；该分类不改变工具参数、执行、返回值或 provider payload。

## 7. `event-bridge`：消息透出层

`event-bridge` 负责把 agent-loop 内部事件转换成 Mavis canonical runtime event。

```text
EventBridge = AgentEvent -> RuntimeEvent 的 canonical converter
```

它是协议转换层，不拥有事件存储、事件推送通道或 runtime event writer。具体事件投递、持久化、SSE /
callback 输出都由 runtime 负责。

当模型未返回正文而 runtime 需要展示错误时，EventBridge 为补出的错误正文标记
`msg_content_source: system_error`；模型正文不携带该标记，即使本次请求以错误结束。
响应 transform 改写正文后不沿用该标记。Local Runtime 的输出审核只跳过被标记的错误正文，
仍审核 thinking 和已缓冲的模型正文；错误展示及失败终态保持原有处理。

## 8. `protocol`：协议权威层

`protocol` 是 agent-loop 相关协议的权威来源。

它包含两层协议：

```text
AgentEvent
  agent-loop 内部事件词汇，结构上适配 Pi AgentEvent。

RuntimeEvent
  Mavis canonical runtime event，是 agent-core 对外输出的标准事件。

AgentMessage / AgentMessageChunk / RespData
  RuntimeEvent stream_resp payload 内的 SSE / UI 展示结构。
```

协议层的核心口径：

```text
RuntimeEvent 是主干协议。
AgentMessage / RespData 是 RuntimeEvent 承载的展示 payload。
```

`protocol` 只定义 agent-loop message / event / wire contract，不承载 runtime 的业务对象。

## 9. 终态约束

`@mavis/agent-core` 的 public API surface 只对应四个核心模块：

```text
@mavis/agent-core
@mavis/agent-core/pi-turn-runner
@mavis/agent-core/tools
@mavis/agent-core/event-bridge
@mavis/agent-core/protocol
@mavis/agent-core/protocol/agent-message
@mavis/agent-core/protocol/runtime-event
```

终态不变量：

```text
1. agent-core 是纯 agent-loop core。
2. pi-turn-runner 是 agent-loop 主入口。
3. pi-turn-runner 只暴露 lifecycle hook contract，不拥有具体 hook implementation。
4. tools 只表达工具协议，不表达具体 runtime 工具业务。
5. event-bridge 只做 AgentEvent -> RuntimeEvent 转换。
6. protocol 是 agent-loop message / event / wire contract 的权威来源。
7. 所有外部能力都通过显式 turn input / hook 进入 agent-core。
8. 所有类型都从 owner 模块导出，不按泛用 types bucket 组织。
9. runtime owns environment, agent-core owns loop core。
```

最终口径：

```text
agent-core = pi-turn-runner + tools + event-bridge + protocol
```

## 10. 当前模块迁移矩阵

本节只描述当前 `agent-core` 现有模块到终态架构的迁移去向。除 `context-manager`
外，其余非核心模块不在本文展开设计，统一从 `agent-core` 移除，由后续专项方案承接。

| 当前模块          | 终态处理                                                              | 承接方式                                                                                                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context-manager` | 迁出 `agent-core`，落到 `packages/agent-modules/src/context-manager/` | 作为 before-LLM hook implementation，通过 `PiTurnRunner.runTurn({ beforeLlmCallHook })` 注入；可依赖 `agent-core/pi-turn-runner` 的 hook contract，`agent-core` 不反向依赖 `agent-modules`                                                                            |
| `backends`        | 从 `agent-core` 移除                                                  | 由后续专项方案承接                                                                                                                                                                                                                                                    |
| `communication`   | 从 `agent-core` 移除                                                  | 由后续专项方案承接                                                                                                                                                                                                                                                    |
| `cron`            | ✅ 已移除（`backends/cron-backend.ts` + `types/cron.ts`）             | cron 编排核心收敛在 `@mavis/cron`（`packages/agent-modules/cron`，自带 schema/类型）；本地 runtime 胶水（croner scheduler + SQLite store + channel delivery）收束在 `packages/local-runtime-v2/src/service/cron/`；云端调度在 `archon_server`。agent-core 不再持有任何 cron 实体 |
| `hook-registry`   | 从 `agent-core` 移除                                                  | 不作为终态架构模块存在；`local-runtime` 仅保留产品内部工具处理，通过 `PiTurnHooks` 注入 agent-loop；用户自定义 hooks 由 `@mavis/plugin-hooks` 执行，来源包括 Plugin、用户级与项目级配置                                                                                          |
| `host`            | 从 `agent-core` 移除                                                  | 由后续专项方案承接                                                                                                                                                                                                                                                    |
| `memory`          | 从 `agent-core` 移除                                                  | 由后续专项方案承接                                                                                                                                                                                                                                                    |
| `system-reminder` | ✅ 已迁出 `agent-core`                                                | 迁到 `packages/agent-modules/system-reminder/`，包名 `@mavis/system-reminder`；cloud runtime 通过新包注入 `<system-reminder>`，`agent-core` 不再暴露 `./system-reminder` subpath                                                                                      |
| `team`            | ✅ 已迁出 `agent-core`                                                | 迁到 `packages/agent-modules/team/`，包名 `@mavis/team`；cloud runtime 通过新包注入 team plan / verify cycle，`agent-core` 不再暴露 `./team` subpath                                                                                                                  |
| `thread-goal`     | 从 `agent-core` 移除                                                  | 由后续专项方案承接                                                                                                                                                                                                                                                    |
| `types`           | 从 `agent-core` 移除                                                  | 由 owner module 导出各自类型；非 core 类型由后续专项方案承接                                                                                                                                                                                                          |

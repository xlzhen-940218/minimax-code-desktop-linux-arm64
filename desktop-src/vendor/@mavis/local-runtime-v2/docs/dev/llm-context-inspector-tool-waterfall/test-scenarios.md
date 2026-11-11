# LLM Context Inspector Tool Waterfall 场景契约

本文固定 LLM Context Inspector 中 per-Call tool waterfall 的行为与验证范围。
waterfall 展示选中 logical Call 的 provider Response 所声明工具的本地执行时间线；它不新增独立 tab，也不复制 tool result payload。

## 已批准设计

- 以现有 `LlmCaptureRecorder` 为演进点，形成一个 per-turn 深模块：HTTP proxy 输入最终 provider request/response，AgentEvent 输入 tool lifecycle。
- agent-core 从成功 logical Call 的 normalized final AssistantMessage 提取 `toolCallId` / `toolName`；settle 只携带这些 identity 与准确 `callId`，不暴露 content / arguments，也禁止使用“最近一次 Call”猜测归属或解析 provider-specific response JSON。
- PiTurnRunner 在 metrics / RuntimeEvent writer 之前注册并负责释放一个原始同步 AgentEvent fanout；recorder 在首个 enabled Call 前将 callback 懒挂到该 fanout，并立即给 `tool_execution_start` / `tool_execution_end` 打点，避免串行 writer queue 污染并行工具的真实时间。
- `call.captured` 同时持久化 expected tools；后续 start/end 使用 append-only 事件更新投影。缺少任一边界即保持不完整，不推导 duration、不隐藏该工具，也不关联到其他 Call。
- 横轴从 Call 开始，第一行是模型请求（重试、首包、生成三段），到最后一个完整 tool result 结束时结束；保留首次调度等待、工具间空档与并行重叠。PTC 子调用缩进在父 `run_code` 下。
- tool result 内容仍以后续 HTTP request 中最终发给 provider 的 JSON 为唯一真相。tool lifecycle 仅保存 identity、时间与错误状态。
- tool summary 进入 overview，使现有 revision polling 能刷新正在查看的 Call；detail endpoint 不增加第二套轮询。
- 不新增图表依赖；裁剪并复用旧 waterfall 的纯几何与 CSS 思路。无需 library docs。
- 2026-10 扩展：Call 轨迹始终显示（含无工具的 Call），工具行可展开详情；详情区顶部增加 Turn 概览与拖选筛选、缩放、平移；对话工具卡片可深链到某个工具。TS-11 中“无工具不渲染”被本扩展取代。

本次不写 ADR：该能力仅属于 internal Inspector，沿用既有 recorder 与 append-only store，决策可在单个 feature branch 内逆转。

## 场景

| ID | Scenario | Given / When / Then | Type | Priority | Status | Evidence |
|---|---|---|---|---|---|---|
| TS-1 | logical Call 精确绑定 expected tools | Given 一个成功 logical Call 的 normalized final AssistantMessage 声明多个 tool call / When agent-core 仅通过 `onCallSettled` 交给 recorder 准确的 `callId` 与 tool identities / Then `call.captured` 原子记录 expected tools，且不暴露 content / arguments、不依赖“最近一次 Call”或 provider JSON 解析 | unit | P0 | covered | `llm-retry.test.ts`：settle 只携带 normalized expected tools，明确断言无 AssistantMessage / arguments；`capture-recorder.test.ts`：按准确 `callId` 保存两个 expected tools；`history-store.test.ts`：`call.captured` 原子投影全部 expected tools |
| TS-2 | 保留 Response 后首次调度等待和串行空档 | Given Response 在 T0 完成，两个工具分别在 T1-T2 与 T3-T4 执行且 T0<T1<T2<T3 / When 构建 waterfall / Then 横轴为 T0-T4，T0-T1 与 T2-T3 均保留为空白，bar 宽度等于真实 duration | unit | P0 | covered | `LlmContextInspectorPanel.test.tsx`：`buildToolWaterfall` 断言 T0 起点、offset 与 width；`ToolWaterfall.tsx` 使用同一 wall-clock 轴百分比布局 |
| TS-3 | 并行工具保持真实重叠 | Given 多个 tool execution interval 部分或完全重叠 / When 构建 waterfall / Then bar 依据相同 wall-clock 轴重叠，结束顺序不改变 Response 中的稳定行顺序 | unit | P0 | covered | `LlmContextInspectorPanel.test.tsx`：乱序输入的稳定行顺序及重叠 interval 几何断言 |
| TS-4 | 完整 tool result 形成闭合时间区间 | Given expected tool 已捕获 start / When 相同 `toolCallId` 的 `tool_execution_end` 到达 / Then append completed event，投影包含真实 started time、duration 与 `isError`，且不保存 result payload | unit | P0 | covered | `pi-turn-runner.test.ts`：阻塞 serialized writer 时 raw capture 已先观察 start；`capture-recorder.test.ts`：raw start/end 即时打点且 event 不含 result；`history-store.test.ts`：append-only 闭合为 250ms/error 并确认 JSONL 不含 `result` |
| TS-5 | tool 尚未开始即中断 | Given Response 声明 tool call 但 abort、termination 或 capture failure 前没有 start/end / When 读取 overview / Then 工具仍存在并标记不完整，duration 缺失，UI 不生成虚假 bar | unit | P0 | covered | `history-store.test.ts`：无 lifecycle event 时 expected tools 仍在 overview；`LlmContextInspectorPanel.test.tsx`：provider payload capture failure 下仍显示 expected tool，incomplete row 无 geometry且显示 `Incomplete` |
| TS-6 | tool start 后缺少 end | Given start 已持久化但进程退出、abort 或事件丢失导致没有 end / When 重启后重放 JSONL / Then started time 保留、capture 仍为不完整、duration 不被 `now` 或下一事件补算 | unit | P0 | covered | `history-store.test.ts`：新 store 重放 start-only tool，保留 `startedAtMs` 且没有 `durationMs` / `isError` |
| TS-7 | orphan、乱序和重复事件 fail closed | Given unknown `toolCallId`、end without start 或重复 start/end / When 投影 tool lifecycle / Then 事件不会附着到其他 Call，合法重复保持幂等，无法闭合的数据显式不完整；同一 Call 重复 ID 只污染本 Call，下一 Call 从新的 owner batch 开始并可安全复用 ID | unit | P0 | covered | `capture-recorder.test.ts`：覆盖 completed ID 跨 Call 复用，以及 duplicate Call 不记录 lifecycle、下一 Call 复用相同 ID 后正常闭合；`history-store.test.ts`：覆盖 orphan Call、end-before-start、duplicate start/end，首个合法 interval 保持不变 |
| TS-8 | append 后 revision polling 刷新当前 Call | Given UI 正在查看已落盘但工具尚未完成的 Call / When start/end 事件追加到 JSONL / Then overview revision 改变，现有 poll 更新 waterfall，无需切换 Call 或重读 detail | integration | P0 | covered | `history-store.test.ts`：captured/start/completed 三个 revision 均不同；`LlmContextInspectorPanel.test.tsx`：knownRevision poll 在不切换 selected Call、不重读 detail 时刷新为 `Completed` |
| TS-9 | capture lifecycle 与开关保持隔离 | Given recorder 未装配或本 Turn 从未启用 capture / When Agent 执行工具 / Then recorder callback 不挂载、不写 tool lifecycle；Given同一 Turn 随后启用 capture / When 首个 enabled Call 开始 / Then 在 provider 执行前懒挂 callback；Given `call.captured` 已提交 / When 随后关闭新 Call capture / Then 该已捕获 Call 仍可闭合自身 expected tool lifecycle | unit | P0 | covered | `llm-capture-inertness.test.ts`：未注入 recorder 路径保持 inert；`pi-turn-runner.test.ts`：core 预注册/释放 raw fanout 且只交付 `subscribe` capability，capture callback 早于阻塞 writer；`capture-recorder.test.ts`：disabled→enabled 首个 Call 前懒挂 callback、永不启用不挂 callback、settle 后 disable 仍追加 start/end |
| TS-10 | IDL、controller 与 UI client 无损映射 | Given overview 含完整和不完整 tool summaries / When 通过 generated DesktopService、controller 与 UI service 映射 / Then tool identity、可选时间、duration 和错误状态保持一致，空列表合法 | integration | P0 | covered | IDL `TestLlmContextInspectorToolSummaryContract` 与 policy check；本地 IDL generation 重复执行 SHA-1 不变；controller test 与 UI service test 均覆盖完整/不完整 wire mapping |
| TS-11 | waterfall 仅出现在对应 Response 下 | Given选中 Call 的 Response 有 tool calls / When 打开 Response view / Then structured Response 下、Usage 前显示 waterfall；Given Response 无 tool call / Then 不渲染空 waterfall，也不新增 tab | unit | P0 | covered | `LlmContextInspectorPanel.test.tsx`：DOM 顺序为 content → waterfall → usage，raw fallback 仍显示；无 tools 时不渲染 waterfall，且没有新增 tab |
| TS-12 | 不完整状态可感知且不只依赖颜色 | Given tool 缺 start 或 end、或完整 tool result 为 error / When 渲染 waterfall / Then 可见文本表达不完整或错误，bar/占位不伪造 duration，并在窄 drawer 中可读且不造成页面级横向溢出 | unit | P1 | covered | `LlmContextInspectorPanel.test.tsx`：显式断言 `Completed` / `Error` / `Incomplete`；`ToolWaterfall.tsx`：`min-w-0`、truncate 与局部 `overflow-hidden` 约束窄 drawer，无页面级横向容器 |
| TS-13 | 四种 provider API 共用 normalized 关联 | Given anthropic-messages、openai-completions、openai-responses 或 openai-codex-responses 返回 tool call / When logical Call settle / Then agent-core 从 normalized final AssistantMessage 生成统一 tool identity contract，recorder 只消费 identities，provider reassembler 仍只负责 provider-native Response JSON | unit | P1 | covered | `llm-retry.test.ts` 断言 normalized identities 且无 content / arguments；`capture-recorder.test.ts` 只消费 settled identities；`provider-response-reassembler.test.ts` 独立覆盖四种 provider-native JSON；UI response tests 覆盖四种 API 展示 |
| TS-15 | PTC 子调用归属父 Call 并闭合 | Given 已捕获 Call 声明 `run_code` / When 其子调用产生 start/end / Then 子调用以 `parentToolCallId` 追加在声明工具之后并闭合；父调用未知、父本身是子调用或重复 start 均不进入投影；未装配 capture 时 runner 不给 executor 观察者 | unit + integration | P0 | covered | `capture-recorder.test.ts`、`history-store.test.ts`、`ptc-tool-executor.test.ts`、`ptc-capture-relay.test.ts`（去掉 runner 改动时失败）、`llm-context-inspector-composition.integration.test.ts` 真实 PiTurnRunner + 落盘 store |
| TS-16 | 最终 attempt 拆分重试、首包与生成 | Given 重试后成功的 Call / When settle / Then 记录最终 attempt 的请求时间与首个流事件时间；未观察到时缺省且 Viewer 不拆分 | unit | P0 | covered | `capture-recorder.test.ts`、`history-store.test.ts` JSONL 往返、`LlmContextInspectorWaterfallModel.test.ts`、`LlmContextInspectorToolTrace.test.tsx` |
| TS-17 | 工具详情来自真实载荷 | Given 展开普通工具 / Then 入参来自本 Call Response、结果来自下一 Call request、定义来自本 Call `tools`；PTC 子调用读取会话消息并标明来源，定义取子工具目录 | unit | P0 | covered | `LlmContextInspectorToolPayload.test.ts` 三种 provider 形态、`LlmContextInspectorToolTrace.test.tsx` |
| TS-18 | 工具卡片深链与未捕获提示 | Given Inspector 可用且捕获开启 / When 点击工具卡片 Inspect / Then 按上次展示方式打开并定位到所属 Call 的该工具；不在捕获中时提示；任一条件不满足时不显示入口 | unit | P0 | covered | `ToolCallRowInspect.test.tsx`、`InternalDeveloperToolsHost.test.tsx`、`LlmContextInspectorToolTrace.test.tsx` |
| TS-19 | Turn 概览拖选筛选 Call | Given 多 Call 的 Turn / When 拖选时间段 / Then 左侧只保留该时间段内活跃的 Call，清除后恢复；滚轮缩放与平移不越界 | unit | P1 | covered | `LlmContextInspectorToolTrace.test.tsx`、`LlmContextInspectorWaterfallModel.test.ts` |
| TS-14 | 真实 internal Electron 路径可人工验收 | Given internal build 开启 Inspector 并执行包含串行、并行或失败工具的 Session / When 查看对应 Call 的 Response / Then waterfall 与日志可观察的真实时间顺序一致，等待空档可见，页面轮询后从不完整收敛到完整 | e2e | P1 | skipped | 按任务约束本仓库不新增或执行 E2E；保留给 Step 8 internal Electron 手工验收 |

## 约束与验证命令

- IDL 先在 `weaver/idl` 更新并通过其 lint/test，再运行 `pnpm gen:thrift -- --idl-dir <idl-worktree>`；生成产物不得手改。
- 只运行受影响 focused tests，不运行 repo-wide 或 package-wide 全量测试。
- 修改 `agent-core` 时验证 focused retry/capture tests；修改 `local-runtime-v2` composition/persistence 时验证 focused recorder/store/controller/service tests，并运行 `check:architecture`、`test:architecture` 与 `scripts/test/local-runtime-layout-check.test.mjs`。
- UI 运行 Inspector service/panel focused tests；真实 Electron/internal 行为留给 Step 8 手工验收。
- `.harness/test-surface-contract.json` 中 utility-process E2E/evidence 是历史映射，不作为本次 commit、push 或 MR ready gate。

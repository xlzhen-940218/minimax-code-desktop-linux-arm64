# Local Runtime V2 AgentHost / SessionSystem / TurnSystem 接入实施计划

## 1. 状态与事实基线

本文记录 2026-07-27 至 2026-07-29 的接入决策、实施计划与最终状态。第 4 至 10 节保留当时的 commit 拆分和验收计划作为历史记录；第 11 至 13 节记录完成后的自审与边界收敛。最终事实以 2026-07-29 最新
`origin/feat/local-runtime-v2-session@50a60238ca9735ee008b9de347842a9511fd69fb` 及其后续 Turn
ingress 收敛源码为准。

最终状态：

- 已完成真实两父 merge commit；
- 已收敛唯一 AgentHost / Turn control contract；
- 已建立 SessionSystem 与 TurnSystem production owner graph；
- 已完成 Queue priority fence、single-item FIFO dispatch、Session 级 public `steer`
  与 AgentHost 独占 runtime/history/stream projection；
- 已完成 v1 narrow AgentHost capability adapter、production owner composition 与 Cron public `steer`
  接线；active-or-activate 分支只保留在 TurnSystem 内部；
- 已完成 Session/Queue/Project generated Application 与五个 Conversation Application use case；
- 已完成 neutral conversation contract 的 19 个接口及 `service/v1-conversation-compat`
  production 实现；
- 已统一 `submit(allowQueue)`：外部不再获得 enqueue capability，Queue
  admission 与首次 dispatch 由 TurnSystem 持有；每条 Queue item 预留独立 `turnId`；
- 已完成 Desktop HTTP fallback、Channel、Task、Background Task、Communication、Questionnaire、Thread
  Goal 和 Greeting consumer 的完整 cutover；
- 已关闭 production legacy conversation writer，并删除 SessionSystem/v1 rotation execution
  handoff；`requestRotation` 不在 v2 allowlist，production front door 交给 v1 Desktop compatibility
  handler 返回稳定 501；
- 已完成 v1/v2 全量 unit、v2 coverage/architecture/layout、仓库 lint、Electron utility
  runtime、embedded-browser 与 real-agent 影响面验证；
- Session 删除使用进程内 gate 封住 direct admission、steer、user Message commit 与 Queue
  mutation，并在同一个 `sessionDeletion(sessionId, cleanup)` 调用中保持 Dispatcher
  quiesce，直到 Session-owned cleanup 完成；admitted-before-register、running 与 closing
  Turn 仍须 exact release，Session metadata/tree 的极低概率并发与进程崩溃窗口交给幂等重试；
- 已将 manual compaction 的 operation gate 收窄到 durable admission 与 controller register；
  `onStarted` 和 Host outcome 通过 non-thenable handoff 在 gate 外等待，使 Session 删除可先 abort
  accepted compaction，再等待 settlement/release；
- 已按 v1 双通道语义拆开 canonical history 与 display Message：canonical
  append/replace 不再转换或重建 display rows；display assistant row 只消费 reviewed final
  `STREAM_RESP/AgentMessage`，chunk 与 terminal assistant error 不持久化；
- 已补齐 compaction 三态 display 与 Global Event：SessionSystem 按 attempt 串行
  `compaction_start -> compaction/compaction_failed`，service
  composition 发布对应 started/completed/failed event；
- 已对齐 v1 failed Turn history：正常 runner failed outcome 保留 user
  message 与成功提交历史，只过滤 terminal assistant Pi error；Host invariant/fatal path 的保护不变；
- canonical history 文件路径改为由 Session record 的 `sessionId + createdAtMs` 直接计算，统一使用
  `session_`，不再全目录扫描；没有新增 DB table、index 或 migration；
- 已补齐 Legacy OpenCode production importer/readiness/tombstone，并在 v2 bridge 存在时关闭 v1
  importer；
- 已补齐 content output recall 的 display Message rewind、durable stream boundary、Global
  Event 与 Thread Goal retraction 投影；
- 已将 v2 Session/Queue/Turn committed fact 直接写入 v2 EventBus，v1 event
  source 只转发独立产品领域事件。

历史分析锁定于 2026-07-27：

- AgentHost source：
  `origin/feat/local-runtime-v2-agent-host@fb6b2caab80b5641a516e864c788a18c009b8757`；
- Session/Turn target：
  `origin/feat/local-runtime-v2-session@6c91731ddcd9bd9e15e06e7d3b8ba3101c126f89`；
- delivery 前最终 Session/Turn target：
  `origin/feat/local-runtime-v2-session@f8c0e904e9caf4368cc5251182c8f06bd11d3c90`；
- 本轮边界收敛前同步的 source：
  `origin/feat/local-runtime-v2-agent-host-2@883f0fbaf1ec7a8dc861d4ffbd2e0a2801ea6e86`；
- 当前 Session/Turn target：
  `origin/feat/local-runtime-v2-session@4d15155bc8fd2f8b4e9f6995776bbcbc9de1f642`；
- 分层与反向注入参考： `origin/feat/session_refactor@1e34eb97b242f248d1717ab20d0eab6ce0c2ab4a`；
- 当时的 MR：[!4827](https://gitlab.xaminim.com/matrix/agent-archon/-/merge_requests/4827)；
- 设计进展：
  [飞书文档 Part 9](https://vrfi1sk8a0.feishu.cn/wiki/QhBgwiwDHi0CwikA1dMcdYUXn8c#share-Im2xdD5Gqoea0lx5kpTcOv13n6g)，revision
  124。

飞书 Part 9 和以上 SHA 是实施输入，不是当前状态；最终 ownership 与接口矩阵见
`.harness/docs/specs/local-runtime-v2-session-application-cutover.md`。

## 2. 结论

1. 使用 **merge，不使用 rebase**。第一项代码提交必须是
   `feat/local-runtime-v2-session -> feat/local-runtime-v2-agent-host` 的真实两父 merge commit。
2. `AgentHost -> SessionSystem` 是 v2 内部 service 注入，不属于
   `compat/v1`。Session-owned 能力定义和实现在 `session-system`，consumer-shaped
   adapter 与 production AgentHost composition 在 `turn-system`，最终由 `services.ts` 接线。
3. v2 仍需调用的 v1 能力统一从 `compat/v1`
   输出窄 capability。AgentHost、TurnSystem、SessionSystem 不得直接 import
   `packages/local-runtime`。
4. v1 调用 v2 使用 runtime-neutral 的
   `@mavis/conversation-contract`，由 v1 只依赖 contract。具体实现放在 v2
   `service/v1-conversation-compat`，直接组合 SessionSystem/TurnSystem public
   capability；不放 application，也不放负责 v2 -> v1 adapter 的 `compat/v1`。
5. generated Session/Queue/Project 方法由 named Application 持有 wire mapping 和跨 capability
   workflow；send、resume、abort、queue-send、requestCompaction 由 Conversation
   Application 持有。两者共用同一个 SessionSystem/TurnSystem graph。
6. AgentHost required runtime Event pipeline 是 Session 状态、final display message、stream 和 turn
   fact 的唯一 terminal projection 路径；committed history callback 先进入 Session Message/history
   projector，再进入 turn fact/Usage。普通 append 不重建 display rows，只有 committed output
   recall 精确 rewind 对应 Turn 的 display Message。ExecutionCoordinator 只保留 Turn ownership
   settlement、controller release 和 Queue wake，不重复写 Session terminal 或关闭 stream。
7. rotation 从 v2 AgentHost/TurnSystem 和 neutral conversation contract 删除；generated
   `requestRotation` 不进入 v2 allowlist，production front door 交给 v1 Desktop compatibility
   handler 返回稳定 501，但不会进入 legacy runtime/daemon 的 rotation 执行。普通追加消息走 exact
   active Turn steering；没有 active Turn 时才 activate 新 Turn。tool-result
   tail 仍是独立的 exact-lease control lane。
8. Cron 本次只改执行投递与完成 cutover 所需的最小 Session 接线。所有投递统一使用 public
   `steer`：TurnSystem 内部在 exact active
   Turn 存在时 steer，否则直接 activate 新 Turn，任何分支都不得写 Queue。明确不修改 Cron
   list、`session_kind` 查询、schema、index 或 migration，这些由并行任务处理。

## 3. 当前实现判断

### 3.1 已经可以复用

- AgentHost 已收敛为非泛型 `run({ lease, request })`，只接受
  `AcceptedTurnLease + AgentHostExecutionRequest`；
- AgentHost 已实现 Session 主动读取、canonical input、AgentRuntime assembly、native Pi
  runner、canonical History、required Event pipeline、terminal seal、manual/automatic
  compaction 和 scoped Turn control；
- SessionSystem 已迁移 Sessions、Projects、Messages、Files、Queue、Usage、legacy
  migration 和 Session stream 的 domain/persistence owner；
- TurnSystem 已实现 durable
  admission/receipt/lease、TurnService、TurnController、ExecutionCoordinator 与 QueueDispatcher；Application 层已具备 shared
  user Message commit 和 HTTP/SSE 映射基础；
- `feat/session_refactor` 已证明 `@mavis/conversation-contract + DeferredRuntimeConversation`
  能切断 v1/v2 package cycle。

### 3.2 已完成的 production closure

- production `services.ts` 只构造一套 SessionSystem、TurnSystem 与 AgentHost owner graph；
- AgentHost concrete Session/history/message/state/stream/turn-control provider 均已 required 注入；
- QueueDispatcher 已使用 durable single-item claim 与 exact ack/release；
- Session/Queue/Project transport mapping 已从 Controller 收敛到 named Application；
- v2 Cron 只使用 v2 Session/Turn port，不回调 v1 Session HTTP 或 store；
- v1 consumer 通过 neutral `RuntimeConversation` 反向调用 v2，legacy writer 与 v1
  importer 在该模式下关闭；
- content rollback、legacy lazy import、Session deletion 与 Root replacement 均进入同一 owner
  graph。

### 3.3 历史冲突处理结果

原 merge 的文本与语义冲突均已解决。仓库只保留一套 AgentHost public contract；旧
`turn-system/agent-host.contracts.ts` 平行 truth、rotation capability 与 speculative
delivery 接口均已删除，architecture gate 防止 owner-local contract 再回堆到根 facade。

## 4. 目标依赖与启动顺序

### 4.1 稳态依赖

```text
generated DesktopService / HTTP / SSE
  -> application/conversation
       -> SessionSystem public capability
       -> TurnSystem public capability

TurnSystem
  -> SessionSystem public capability
  -> concrete AgentHost facade
       -> SessionSystem-backed read/history/event capabilities
       -> TurnSystem-owned scoped control and turn-fact projector
       -> compat/v1-backed capabilities that have not migrated to v2

Cron v2 executor / deliverCron
  -> existing SessionSystem session resolution/creation capability
  -> TurnSystem public steer
       -> exact active Turn: steer
       -> idle/new Cron Session: direct Turn activation
       -> never Queue

packages/local-runtime (v1 consumers)
  -> @mavis/conversation-contract
       -> DeferredRuntimeConversation
            <- services.ts binds service/v1-conversation-compat
                 -> SessionSystem/TurnSystem public service capabilities
```

禁止的方向：

```text
session-system -> turn-system
service -> application
service -> HTTP/generated IDL
packages/local-runtime -> packages/local-runtime-v2
AgentHost/TurnSystem/SessionSystem -> packages/local-runtime
```

### 4.2 production composition

`runtime.ts` 只保留 lifecycle orchestration；service-specific wiring 在 `services.ts`：

```text
runtime.ts
  1. create compat/v1 aggregate and deferred conversation bridge
  2. create v1 host with the neutral bridge and legacy conversation disabled
  3. initialize shared DB and background infrastructure
  4. createRuntimeServices(...)
       4.1 initialize SessionSystem owner aggregate
       4.2 build v1-backed narrow AgentHost capabilities
       4.3 build SessionSystem-backed AgentHost adapters
       4.4 initialize production AgentHost
       4.5 initialize TurnSystem with the real AgentHost
       4.6 initialize v1-conversation-compat service
       4.7 initialize Cron with SessionSystem + TurnSystem capabilities
       4.8 initialize application/conversation
  5. services.ready():
       5.1 run ingress -> lease -> Queue recovery in dependency order
       5.2 bind v1-conversation-compat to the deferred bridge exactly once
  6. expose HTTP and activate v1 producers
```

初始化失败必须 fail
closed，并按与构造相反的 dependency-safe 顺序释放。shutdown 先停止 producer 和 front
door，再使 deferred
bridge 永久失效，随后释放 application、Cron、TurnSystem、AgentHost、SessionSystem、background
infra、DB 和 v1 host。

## 5. 代码归属

| 能力                                                   | 归属                                              | 说明                                                               |
| ------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| Session read/query/lifecycle                           | `service/session-system`                          | owner public capability，不泄露 DAO                                |
| Canonical History durable provider                     | `service/session-system`                          | 复用现有 canonical source、lane、checkpoint 和 message owner       |
| Session/message/stream required projectors             | `service/session-system`                          | neutral capability；不 import AgentHost contract                   |
| Turn fact projector                                    | `service/turn-system`                             | Turn repository/receipt/lease owner                                |
| SessionSystem -> AgentHost shape adapter               | `service/turn-system/agent-host` 邻近 composition | consumer-side mapping，避免 SessionSystem 反向依赖                 |
| Agent config/model/tool/permission/file 等未迁 v1 能力 | `compat/v1`                                       | 只暴露窄 capability，禁止传整个 v1 host                            |
| AgentHost/TurnSystem aggregate construction            | `service/turn-system/initialize.ts`               | 接受已注入 capability，不打开 DB、不创建 v1                        |
| Cron 最小 Session resolution/creation                  | `service/session-system`                          | 复用既有 capability；不改 list/index/migration                     |
| Cron delivery                                          | `service/cron` -> `service/turn-system`           | 只调用 public `steer`，禁止 Queue fallback                         |
| business service composition                           | `services.ts`                                     | 唯一 production 接线点                                             |
| 已有 conversation API flow                             | `src/application/conversation`                    | 只搬 send/resume/abort/queue-send/compaction                       |
| Thrift/HTTP/SSE mapping                                | `http/controllers/session.controller.ts`          | 不包含 busy/Queue/terminal/recovery 决策                           |
| v1 -> v2 neutral contract                              | `packages/agent-modules/conversation-contract`    | types、errors、deferred bridge；不含业务实现                       |
| neutral contract 的 v2 实现                            | `service/v1-conversation-compat`                  | service delegation、DTO mapping、bind/shutdown；不依赖 application |

`compat/v1` 只负责 v2 调 v1 的窄 adapter。v1 调 v2 的 neutral contract 实现属于
`service/v1-conversation-compat`；AgentHost 与 SessionSystem 都在 v2 内部，它们之间的注入也不得绕进
`compat/v1`。

## 6. 提交顺序

每个行为提交都按测试先行执行：先在 `/tmp`
trace 记录 RED，随后实现并在同一 commit 前得到 GREEN。不能通过弱化 coverage、complexity、file
length、dependency 或 layout gate 收口。

### Commit 0：本计划文档

建议 commit：

```text
docs(local-runtime-v2): plan AgentHost session turn integration
```

只新增本文并让旧 SessionSystem migration guide 指向本文；不改 production code。

### Commit 1：纯 merge 与冲突解决

建议 commit：

```text
merge: sync local runtime v2 session train
```

执行约束：

- fetch 后重新锁定 source/target SHA；
- 使用 `git merge --no-ff --no-commit origin/feat/local-runtime-v2-session`；
- 生成真实两父 commit，不 cherry-pick、不 squash、不 rebase；
- 只解决上述 7 个文本 conflict，以及让两父代码能共同 typecheck 所必需的机械 contract
  import/name 收敛；
- 允许合并 specs 索引、package scripts/dependencies、SessionSystem contract exports、TurnSystem root
  exports，并用 pnpm 9.12.0 重新生成 lockfile；
- 如果平行 AgentHost contract 使 merged tree 无法编译，可以在本 merge commit 中做 temporary private
  alias 或选择 canonical public export，但不得构造 concrete AgentHost、创建 owner
  adapter 或改变 runtime behavior。

明确禁止：

- 不改 `services.ts`、`runtime.ts` 或 HTTP allowlist；
- 不新增 SessionSystem/AgentHost production adapter；
- 不把 mock Host 换成 concrete Host；
- 不改变 terminal、Queue、steering、recovery 或 v1 cutover 行为；
- 不顺手重构 target 带入的代码。

提交前通过 first-parent/second-parent/combined diff audit 证明：手工变化只服务于 conflict
resolution，所有新增业务行为留到后续 commit。

### Commit 2：收敛唯一 AgentHost / TurnSystem contract

建议 commit：

```text
refactor(turn-system): converge AgentHost ownership contracts
```

工作：

- 删除 target 的平行 mock contract，`agent-host/contracts.ts` 成为唯一 AgentHost truth；
- TurnSystem 统一映射： `AcceptedAgentTurn -> AcceptedTurnLease`、
  `submission -> AgentHostExecutionRequest`、
  `run({ turn, submission }) -> run({ lease, request })`；
- Queue `claimId` 只保留在 Queue/Turn settle path，不进入 AgentHost request；
- 删除 `rotation` source/profile；
- TurnController 实现 `scope(lease)`，所有 callback 绑定 exact
  Session/Turn/lease 并在 replacement/release 后 fail closed；
- 普通 product steering 使用一个 FIFO lane；tool-result tail 保持独立 open/close/claim/ack fence；
- 去掉 speculative `system-reminder`、`step-follow-up` delivery contract 和 public `activeTurnId`
  耦合。

本 commit 仍可使用 contract-compatible fake Host，目标是先固定 owner boundary，不做 production
dependency wiring。

### Commit 3：形成 SessionSystem production owner aggregate

建议 commit：

```text
feat(session-system): expose AgentHost owner capabilities
```

工作：

- `initializeSessionSystem(...)`
  一次性构造 Sessions、Projects、Messages、Files、Queue、Usage、Legacy migration、Session
  stream 与 readiness/recovery owner；
- public facade 只导出 service capability，不导出 concrete DAO；
- 提供 AgentHost 所需的 Session read 与 canonical History durable capability；
- 提供 neutral Session state、reviewed final display message、Session stream
  projector 和 history-failure projector；canonical History 不通过 mapper 转换成 display Message；
- Usage 作为 fresh history append 与 required projection 成功后的 best-effort
  projection；不进入 event replay，不新增 receipt/outbox/watermark；
- 明确 `ready()`、startup recovery 与 `dispose()`，防止 stream subscriber、lane 或 recovery
  handle 泄漏；
- 使用现有 `AppDb`、canonical JSONL source、repository 和 migration，不创建第二个 store。

SessionSystem 不 import TurnSystem/AgentHost。AgentHost-shaped mapping 在 consumer side 完成。

### Commit 4：接入 production AgentHost 并完成 TurnSystem

建议 commit：

```text
feat(turn-system): wire production AgentHost orchestration
```

工作：

- `compat/v1` 为尚未迁移的 Agent/model/credential/tool/permission/file 能力提供窄 adapter；
- TurnSystem aggregate 组装
  `createNativeAgentHostProductionDependencies -> LocalAgentHost`，但暂不切换全局 `services.ts`；
- 注入 SessionSystem read/history/projectors、TurnSystem scoped control/turn-fact projector；
- ExecutionCoordinator 调用 real Host，并删除 Session terminal、message、stream 的重复 projection；
- Coordinator 只保留 exact Turn settle、controller release、Queue ack/release/reject 和 wake；
- QueueDispatcher 按 FIFO 一次领取一条 item，每条只启动一个 Host/Pi run；Queue
  ownership 不进入 Host；
- 实现 Session 级 `steer`：exact active
  Turn 存在时普通消息 steer，否则创建新 Turn；内部 active-or-activate 决策不对 producer 暴露；
- direct send、dispatcher、abort、manual/automatic compaction、resume cursor、failure seal、expired
  lease/orphan claim recovery 全部接入；
- startup 顺序固定为 expired Turn recovery -> Queue claim recovery -> pending Session wake；
- aggregate 提供幂等 `ready()` / `close()`，不留下 timer、reservation、subscriber 或 pending claim。

production factory 不隐式启用 AgentHost 当前未声明的 built-in extensions；该项不与本次接线混做。

### Commit 5：Cron 改用 v2 Session 与 steer delivery

建议 commit：

```text
refactor(cron): bind v2 session and steer delivery
```

工作：

- 拆开当前聚合的 `CronSessionPorts`：Agent/default workspace 等未迁能力继续由 `compat/v1`
  提供，Session resolution/creation 复用 SessionSystem 既有 capability，delivery 只注入 TurnSystem
  public `steer` capability；
- 移除 `compat/v1/cron.ts` 中的 `getSessionById`、`agentRoutes.createSession` 和 v1 HTTP message
  loopback；只保留尚未迁移的 Agent default、metrics、cleanup 等窄 capability；
- internal `CronExecutor` 与 generated `deliverCron` route 复用同一个 v2 delivery use case；
- delivery 使用 `producerId = cron:<cronId>`、`idempotencyKey = runId` 和 Cron provenance；exact
  active Turn 存在时进入普通 steering FIFO lane，没有 active Turn 时直接 activate 新 Turn；
- active Turn
  closing、compacting 或其他不可 steer 状态显式失败，绝不 fallback 到 Queue，绝不创建 Queue
  row/claim/wake；
- `CronRun.delivered` 表示输入已被 exact active Turn 接受或已直接激活新 Turn，不表示模型执行完成；
- shutdown 先停止 Scheduler 与 delivery ingress，再释放 TurnSystem/SessionSystem，避免 late
  delivery。

明确不修改 `listByCronOriginPage`、`session_kind` filter、Drizzle schema、SQLite index、migration
catalog 或对应 query-plan 测试。增量测试只证明同一 `runId`
幂等、active/idle 两条投递路径均无 Queue 写入，steer 失败不会静默排队。

### Commit 6：把 Session 对话入口迁到精简 application 层

建议 commit：

```text
refactor(local-runtime-v2): move session turn flow to application
```

新增一个小型 `application/conversation` facade，只搬迁 controller 已有实现：

- `sendMessage`：retry-continuation、附件可用性、Turn submission 与 application DTO；
- `resumeSession`：Session existence、active Turn cursor 与 Session stream resume；
- `abortSession`：Session existence、Turn abort 与稳定冲突语义；
- `enqueueMessage` transport：输入转换、`submit(allowQueue=true)` 与稳定 error
  mapping；Application 不持有 Queue enqueue capability；
- `requestCompaction`：名称/Session 校验、TurnSystem 调度与 rejection mapping。

不做：

- 不为每个 service method 创建 handler + facade + adapter 三层；
- 不实现 controller 中当前为 `NotImplemented` 的 Session/Queue
  CRUD、tree/search、usage、diff、files、root replacement 等能力；
- `deliverCron` 继续是 controller 到 Cron delivery service 的 transport mapping，不塞入 conversation
  application；
- 不复制 Session/Queue/Turn state machine；
- 不让 application 实现 `RuntimeConversation`；
- 不 import concrete repository；
- 不把 Thrift/generated type 带入 service。

`session.controller.ts` 最终只保留 generated request/response mapping、RequestContext、SSE
transport、Cron transport mapping 和 application
error 到 HTTP 的映射。其他未实现方法保持既有 fallback/NotImplemented 状态，本 commit 不扩展 application
surface。

### Commit 7：建立 v1 -> v2 service 注入边界

建议 commit：

```text
feat(local-runtime): inject v2 conversation services
```

工作：

- 从 `feat/session_refactor` 迁入并收敛 `@mavis/conversation-contract`；
- contract package 只保留 runtime-neutral DTO、service capability、稳定错误和 deferred bridge；
- v1 `CreateLocalRuntimeHostOptions` 接受 contract，不 import local-runtime-v2；
- v1 的 HTTP fallback、Channel、Task、Communication 等 conversation consumer 改用注入 contract；
- 新增符合 service layout 的
  `service/v1-conversation-compat/{contracts.ts,initialize.ts,index.ts,...}`，具体 service 实现 trimmed
  `RuntimeConversation`，直接聚合 SessionSystem query/lifecycle 与 TurnSystem ingress/maintenance
  capability；
- `service/v1-conversation-compat` 不 import application、HTTP、generated IDL 或 concrete
  repository；`compat/v1` 不承载这个反向实现；
- 为 `services.ts` 提供 owner ready 后的一次性 bind seam；bind 前、bind 失败和 shutdown 后均 fail
  closed；
- v1 在显式传入 external conversation contract 时关闭 legacy conversation
  writer；本 commit 只增加 opt-in seam，production runtime 到 Commit
  8 才启用，避免中间 commit 破坏现有入口；
- 不迁入 `feat/session_refactor` 的 `RuntimeConversationApplicationAdapter` 和第二套
  `RuntimeApplicationUseCases` graph。producer 通过同一个 service
  contract 完成 create/submit/steer/Queue management/abort/history-only 等操作。

contract 的 public surface 以真实 v1 consumer 为准，不机械复制未使用能力；允许相对
`feat/session_refactor` breaking trim。rotation 不进入 contract。

Root replacement 通过现有 `replaceRootSession` 暴露 committed fact：
`service/v1-conversation-compat` 负责读取 exact plan、best-effort abort 旧 Root Turn 并原子 commit
SessionSystem 状态；v1 application 仅消费返回的 `nextRoot`、`previousRoots` 与
`archivedRootTitle`、`fallbackName`，完成仍由 v1 owner 持有的 pinned Channel binding
migration、archive title trigger 和 committed Session/Agent event 投影。Channel `/new`
必须进入这个 application 入口，不得另设直接创建并 promote Root 的 lifecycle shortcut。

### Commit 8：production cutover、恢复与端到端验收

建议 commit：

```text
feat(local-runtime-v2): cut over conversation runtime
```

工作：

- `services.ts` 完成 SessionSystem -> AgentHost -> TurnSystem ->
  v1-conversation-compat/Cron/application 的 production composition；
- `createControllers` 注入 application facade，Session conversation routes 进入 v2 allowlist；
- v1 只保留未迁移的非 conversation fallback；
- HTTP、Channel、Task、Communication 通过 neutral contract 进入同一个 v2 conversation
  owner；Cron 已在 Commit 5 直接使用 v2 SessionSystem/TurnSystem；
- 启动失败、正常 shutdown、并发 send/steer、Queue single-item
  dispatch、abort、resume、compaction、restart recovery 进入 integration/E2E；
- 更新 Behavior Spec、owner README、OpenWiki、changelog 和 MR 描述。

本 commit 不自动 merge MR。CI、Code Review 和要求的 Test Agent 全部 PASS 后，只通知用户确认。

## 7. 验证矩阵

### 7.1 merge commit

- `git diff --check`；
- `pnpm --filter @mavis/local-runtime-v2 typecheck`；
- `pnpm --filter @mavis/local-runtime-v2 lint`；
- AgentHost 与 TurnSystem focused tests；
- `pnpm --filter @mavis/local-runtime-v2 test:architecture`；
- `node --test scripts/test/local-runtime-v2-architecture-wiring.test.mjs`；
- `node scripts/check-local-runtime-layout.mjs`。

### 7.2 service / application / compatibility commits

至少覆盖：

- exact lease fence、replacement/release 后 callback fail closed；
- ordinary steer 与 close race、tool-result tail fence；
- direct send duplicate/busy/priority/ingress conflict；
- Queue single-item claim、ack/release/reject、crash replay；
- required projector 顺序、幂等、失败 propagation 和无重复 terminal；
- canonical History append/replace/reconcile/compaction 与 final runtime display
  projection 分别验证，断言 canonical replace 不改写 display rows；
- Session state、message、stream、turn fact 的成功/失败/abort terminal；
- Cron scheduled execution 与 generated `deliverCron` 均覆盖 active steer、idle direct
  activation、重复 `runId` 和不可 steer failure，并断言 Queue row/claim/wake 零新增；
- application 只覆盖 controller 已有 send/resume/abort/queue-send/compaction 行为及搬迁前后 parity；
- contract bind-once、bind failure、shutdown、legacy writer disabled；
- v1 Channel/Task/Communication 不再写 legacy conversation storage，v2 Cron 不再访问 v1
  Session/conversation；
- startup recovery 顺序和 owner disposal。

命令：

- `pnpm --filter @mavis/conversation-contract build`；
- `pnpm --filter @mavis/local-runtime-v2... build`；
- `pnpm --filter @mavis/local-runtime-v2 typecheck`；
- `pnpm --filter @mavis/local-runtime-v2 lint`；
- `pnpm --filter @mavis/local-runtime-v2 test:coverage`；
- `pnpm --filter @mavis/local-runtime-v2 test:architecture`；
- local-runtime v1 compatibility focused unit/integration；
- `node --test scripts/test/local-runtime-v2-architecture-wiring.test.mjs`；
- `node scripts/check-local-runtime-layout.mjs`；
- `node --test scripts/test/local-runtime-layout-check.test.mjs`；
- `pnpm quality:test-surface-contract`；
- `pre-commit run --all-files`。

### 7.3 E2E

因为 production conversation 会真实调用 LLM，最终 ready 不能只靠 mock AgentHost：

- 新增或扩展 isolated profile/dataDir 的真实 Agent/Pi chain E2E；
- 覆盖 send -> stream -> terminal -> 分别持久化 canonical history 与 reviewed final display
  message；
- 覆盖 active Turn steering、Queue 下一条独立 Turn、abort、resume、manual compaction；
- 覆盖 Cron 新建/指定 Session 的 active steer 与 idle activation，验证 Queue 数量不变；
- 覆盖 Scheduler 自动触发与 generated `deliverCron`，两者复用同一 v2 use case；
- 覆盖进程重启后的 ingress/lease/claim recovery；
- 至少执行影响面相关的 `pnpm test:e2e:archon-real-chain`；
- 如果 route
  cutover 改变 Electron 用户路径，再补真实 Electron/Playwright 路径和截图；若 UI 不变，不新增装饰性 UI 测试。

## 8. 完成定义

以下条件同时满足才算接入完成：

1. MR source 包含可辨识的纯 merge commit，两个 parent 均为执行时锁定的 source/target HEAD；
2. repository 中只有一套 AgentHost public contract；
3. production chain 为
   `HTTP/v1 producer -> application or neutral service contract -> TurnSystem -> concrete AgentHost -> Pi`；
4. AgentHost 所有 required owner 均有 production provider，缺失时 fail closed；
5. SessionSystem 是 Session/history/message/stream 的唯一 owner，TurnSystem 是 admission/lease/receipt/Queue
   handoff 的唯一 owner；
6. Coordinator 不重复写 AgentHost required terminal projection；
7. v1 不 import v2，v2 service 不 import v1；v2 -> v1 只经 `compat/v1`，v1 -> v2 只经 neutral
   contract 与 `service/v1-conversation-compat`；
8. legacy conversation writer 关闭，production 不双写、不 silent fallback；
9. Cron 不依赖 v1 Session/conversation delivery，所有 delivery 均调用 public `steer`
   且 Queue 零写入；本 MR 不修改 Cron list/index/migration；
10. controller 的现有 send/resume/abort/queue-send/compaction conversation
    flow 已迁出，未扩展其他 application；
11. focused unit/integration、coverage、architecture、layout、真实 E2E、CI 和 Code
    Review 全部 PASS。

## 9. 风险与回滚

- **contract 双真相**：先固定唯一 AgentHost contract，再做 provider
  wiring；不在两个 mock 之间写 adapter。
- **terminal 双写**：用 required Event
  pipeline 集成测试冻结 projector 次序与 exactly-once；Coordinator 只 settle Turn。
- **startup 半绑定**：deferred bridge 只 bind 一次；构造失败
  `fail()`，shutdown 永久 invalidate；legacy writer 从启动开始禁用，不能失败后回落双写。
- **Queue 数据丢失**：claim/ack/release/reject 始终由 Queue/Turn
  owner 持有，AgentHost 不接触 claimId；单条 item 失败按该 claim 的 durable policy 处理。
- **Cron 意外排队**：Cron 只拿 public `steer` capability，不拿 enqueue capability；用 Queue
  repository before/after 断言锁死零写入，任何不可 steer 状态显式失败。
- **application 再度膨胀**：用 architecture gate 禁止 application import repository、service import
  application、controller import Turn repository/controller；以五个既有 conversation
  method 为固定 surface。
- **一次切流过大**：提交按 contract、owner adapter、Turn graph、Cron、application、v1
  bridge、cutover 分层；每个 commit 都必须独立 GREEN。cutover 前旧 product
  path 不变，cutover 后不保留 runtime fallback。

回滚 production cutover 时只回滚 Commit 8 的 route/producer activation；不能重新启用双写。若 v2
graph 未 ready，runtime 整体 fail closed，由发布回滚恢复旧版本。

## 10. 已确认决策

1. **application scope**：只搬迁 `session.controller.ts`
   已有的 send/resume/abort/queue-send/requestCompaction conversation flow；不实现其他 application。
2. **Cron scope**：实现 v2 Session 级 `steer` delivery 与最小 production wiring；不修改 Cron
   list、`session_kind` 查询、index 或 migration。
3. **rotation**：删除 v2 execution/contract 能力；generated 入口由 v1 Desktop compatibility
   handler 返回稳定 501，不进入任何 legacy runtime/daemon execution。
4. **conversation contract**：复用 `packages/agent-modules/conversation-contract`
   位置，按当前 consumer breaking trim；具体实现归
   `service/v1-conversation-compat`，禁止放 application。
5. **MR history**：关闭 !4827 squash，保留纯 merge commit 与后续行为 commit。
6. **production cutover**：Desktop HTTP、Channel、Cron、Task、Communication 全部切到同一个 v2
   conversation owner，关闭 legacy conversation writer，不拆后续 MR。

## 11. 交付前自审

2026-07-28 按第 8 节完成定义重新检查 merge history、production composition、Session/Turn
owner、application、neutral contract、Cron delivery、shutdown 与验证证据。自审确认并修复以下问题：

1. `QueueDispatcher.close()` 原先只关闭 acceptance
   waiter，未阻止新 notify/recovery，也未处理 shutdown 期间才取得的 claim；`TurnController`
   原先没有 owner close，abort 后 lease renewal timer 仍存活。现改为先封住新工作、释放 raced
   claim、drain dispatcher，并 abort/等待 exact active Turn release。
2. v1 compatibility 删除 Session 时原先只调用进程内 `abort`，既把 closing
   Turn 误判为 not-running，也无法封住检查后的新 admission。现由 TurnSystem 使用进程内 deletion
   gate、operation gate 与 Queue Dispatcher quiescence 阻止 direct submit、steer、Message
   ingress 和 Queue mutation，等待 admitted-before-register、running、closing Turn exact
   settlement 与 controller release，再在同一 quiesced scope 内执行 Session-owned cleanup。Turn
   repository 只在 active Turn drain 阶段保留 owner-local deletion
   lock，不把 Session 删除状态扩散到 Session metadata/tree 或新 DB 状态机。
3. committed Pi Usage 的首次接线曾因 bounded event replay 增加进程内 `Set`，随后又新增 m0011 durable
   receipt。复审确认两者都超出 Target/v1 的 best-effort analytics 语义：现删除 m0011、receipt
   repository API 与 replay identity，把 Usage 调度移到 committed History writer；只有 fresh
   append 及 required projection 成功后才投影本次 delta，失败或崩溃窗口允许缺行。
4. Session title generation 原先不属于 owner shutdown drain。SessionSystem 的幂等 `close()`
   现在先等待 pending title，再释放 Stream subscriber。
5. conversation application 原先直接引用 `SessionRepository` contract。现只消费 Session query
   capability，repository 仍封装在 SessionSystem 内。
6. Turn/Cron behavior spec、Session/Turn README 与已完成的 production cutover、FIFO single-item
   dispatch、Session 级 public `steer`、best-effort
   Usage 和 shutdown 语义同步，删除已完成接线的旧 TODO。
7. clean CI Docker context 原先没有复制新增的 `@mavis/conversation-contract`
   manifest 与 source，导致隔离构建无法解析 workspace package。现由 Dockerfile 与 context
   check 同步锁定这两项输入。
8. 指定 reviewer closure review 发现 manual compaction 原先把 `onStarted` 与完整 Host
   outcome 都包在 Session operation gate 内，而删除路径先等待 gate drain、后 abort active
   compaction，形成互等。现把 gate 收窄到 Session check、durable admission 与 controller
   register，并在 gate 内返回 non-thenable handoff；删除可正常触发 compaction lease signal，terminal
   settlement 与 controller release 完成后才进入 cleanup。signal-driven compactor 与 pending
   `onStarted` 的 fail-closed/retry 均有回归。
9. 后续架构复审发现 `CommittedHistoryService + mapPiMessagesToDisplay` 把 canonical Pi
   history 误当成 display Message 来源，偏离 v1 的独立双通道。现删除该 mapper/writer 路径；required
   committed-history callback 只投影 Turn fact/Usage，display row 只由 Application-committed user
   Message、reviewed final runtime `AgentMessage` 与 compaction lifecycle 写入。
10. v1 parity 复审发现 v2 compaction 只写 terminal display row，production
    composition 也未注入 observer。现由 SessionSystem 按 attempt 串行写同 `msg_id` 的
    `compaction_start -> compaction/compaction_failed`，再把中立 fact 映射为三类 Global
    Event；concrete compactor 只在真正开始 summary generation 前触发 start，filter-only /
    unchanged 不制造 lifecycle，delayed start 也不会覆盖 terminal。
11. 正常 runner failed outcome 原先使用 turn retraction 把本 Turn 全部 canonical append
    replace 回初始 snapshot。现对齐 v1：保留 user message 与所有成功提交记录，仅在 committed
    append 边界过滤 terminal assistant Pi error；Host invariant/fatal retraction 仍保留。
12. canonical history artifact 原先为查找 Session manifest 遍历完整
    `v2/sessions/YYYY/MM/DD`。现所有操作先获取 Session record，并由 `sessionId + createdAtMs`
    直接定位
    `HH-mm-ss-SSS-session_<base64url>`；只校验该路径 manifest，不扫描其他目录，也不新增 SQLite
    schema。

以上修复均有 focused unit/integration 或 migration/rehearsal 回归；最终门禁和指定 reviewer
closure 结论在复审收口后记录到 MR。

## 12. 接入后的边界收敛计划

本节基于以下 source truth：

- 本轮 parity 修复前接入分支：
  `feat/local-runtime-v2-agent-host-2@883f0fbaf1ec7a8dc861d4ffbd2e0a2801ea6e86`；
- 本轮统一 ingress 前的 Session/Turn target：
  `feat/local-runtime-v2-session@50a60238ca9735ee008b9de347842a9511fd69fb`；
- Session SSE 正确语义参考： `feat/session_refactor@1e34eb97b242f248d1717ab20d0eab6ce0c2ab4a`。

目标不是撤销已经完成的 production cutover，而是在保持 durable admission、exact lease、Queue
claim/recovery 和 AgentHost terminal
ownership 不变的前提下，重新收窄 TurnSystem 对 application 与 v1 consumer 暴露的能力。

### 12.1 TurnSystem public capability

TurnSystem 对外只暴露业务调用需要的稳定 capability。`TurnSystemOwner` 持有
`turns`、`maintenance`、`ready()` 与
`close()`；Host、Controller、Dispatcher、Repository 和 lifecycle 只存在于 `initializeTurnSystem()`
创建的内部 composition graph，不能成为 application、Cron、Channel 或 v1 compatibility 的 public
API。

目标 public surface：

```ts
interface TurnService {
  submit(input: SubmitTurnSubmission): Promise<SubmitTurnResult>;
  steer(input: SteerSessionInput): Promise<SteerSessionResult>;
  abort(input: AbortTurnInput): Promise<AbortTurnResult>;
  requestCompaction(input: RequestCompactionInput): Promise<RequestCompactionResult>;
  dispatchSessionQueue(sessionId: string): Promise<void>;
  dispatchQueue(sessionId: string): Promise<void>;
  sessionDeletion(sessionId: string, cleanup: () => Promise<void>): Promise<void>;
}
```

语义：

- `submit({ allowQueue: false })` 只尝试立即创建一个新 Turn。已有 active
  Turn、compaction 或更早 Queue item 时返回 typed rejection，Queue 零写入；
- `submit({ allowQueue: true })` 预留 `turnId`，durable
  enqueue 一条 item 后立即尝试 dispatch。调用成功表示 Queue
  admission 成功，不表示 Turn 已完成；wake 失败不回滚 Queue commit；
- public `steer` 是 Session 维度投递：active Turn 可接收时 steer；Session
  idle 时直接 activate 新 Turn。调用方不提供 `turnId`，也不知道内部 active-or-activate 分支；
- submit 与 steer 共用完整 message/attachment schema。active steer 不支持 model override；idle
  activation 可以按请求 override；
- Controller 的 exact Turn steering 保留为 TurnSystem internal capability，建议命名为
  `steerActiveTurn`，继续使用 exact Session/Turn/lease fence；
- `dispatchSessionQueue` 是用户显式 resume/drain；`dispatchQueue` 是 Queue mutation/release
  compatibility wake。producer 不需要在 submit 后自行调用；
- Dispatcher 是 level-triggered single-item drain；调用方不知道 claim、recovery 或 Dispatcher 实例；
- `sessionDeletion` 是删除 Session 时唯一的 TurnSystem cleanup capability，详见 12.6。

以下能力从 public surface 删除：

- `activeTurnId`、`getStatus`、`isBusy`；
- `steerOrActivate`；
- `wakeQueue`、`notify`、public Dispatcher；
- `waitQueueAccepted`；
- public `quiesceSession`；
- 独立的 `deleteSessionData` 或 `completeSessionDeletion`；
- public Host、Controller 与 Repository。

### 12.2 Session SSE 续传语义

`resumeSession` 是 Session 维度的 durable replay + live stream，不是 active
Turn 的恢复接口。UI 主路径只提供 `session_id` 与 `after_msg_id`；`after_cursor`
可以保留为同一进程、同一 ring epoch 下的可选快速路径，但不能成为正确性依赖。

当前接入分支存在半迁移：

- generated `ResumeSessionReq` 已经没有 `turnId`；
- conversation application 仍查询 `activeTurnId` 并传入 StreamService；
- `ResumeSessionInput` 又增加了 `turnId`；
- active Session 会按 Turn filter，并在该 Turn terminal 时关闭；
- idle Session 只做一次 durable replay 后关闭。

目标实现恢复 `feat/session_refactor` 的 Session 级算法：

1. 校验 Session 存在；
2. 在读取持久化 Message 前先订阅该 Session 的 live ring，避免 DB 查询窗口丢事件；
3. 读取当前 ring snapshot，并记录 watermark `W0`；
4. 调用 Message owner 的 `listAfter(sessionId, afterMsgId)`；
5. DB 查询完成后读取 `W0` 之后的 ring catch-up；
6. 将 snapshot 与 catch-up 中的 `message-committed`、`messages-replaced` 作为 durable
   boundary，把 DB snapshot 与查询期间发生的 commit/replace 折叠成唯一 durable message 序列；
7. 把最后一个 durable boundary 的 cursor 放到最后一条 durable replay
   frame，再发送该 boundary 后尚未持久化覆盖的 chunk/runtime frame；
8. 过滤已经由 replay 发送的 ring cursor，随后继续消费 live subscription；
9. 仅在客户端断开、Session 删除、Runtime shutdown、subscriber
   overflow 或必须 resync 时结束；任何单个 Turn terminal 都只是 Session frame，不能关闭连接。

这里不需要持久化 `msgId -> ring index` 表。`BoundedRing`
本身是 Session 维度的内存结构，每个 entry 已有单调 cursor；`message-committed` / `messages-replaced`
frame 是 durable Message 与 live chunk 之间的 seam。恢复时扫描 bounded
snapshot，找到最后一个 durable boundary 即可：

```text
durable messages after after_msg_id
  + commits/replacements captured while DB was being read
  + ring frames after the last durable boundary
  + subsequent live frames
```

当前 ring 最多保留 2,000 frames / 8
MiB，线性扫描成本有明确上限，因此先不增加第二套内存索引。如果 profiling 证明有必要，可以增加
`Map<msgId, cursor>` 作为纯优化，但必须随 ring eviction 同步删除，且不能成为恢复正确性的唯一依据。

ring cursor 使用 Session scope + process
epoch。进程重启后旧 cursor 会失效，但 Message 表仍是 durable source；UI 以 `after_msg_id`
重连即可。找不到 durable anchor、cursor epoch/scope 不匹配，或需要的 ring
prefix 已被淘汰时，必须返回 `resync-required`，不能猜测 index。

Session frame 可以继续携带 `turnId`
作为事件关联元数据，但 Resume 的订阅 identity、filter 和 lifecycle 都不能依赖它。`sendMessage`
返回的单 Turn response SSE 是另一条 application delivery 链路，可以按 Turn terminal 结束，不能与
`resumeSession` 混为同一 stream 语义。

### 12.3 Producer 投递矩阵

| Producer / use case                   | TurnSystem 调用            | admission / completion 语义                              |
| ------------------------------------- | -------------------------- | -------------------------------------------------------- |
| Desktop/UI 即时 `sendMessage`         | `submit(allowQueue=false)` | busy 明确失败；SSE observer 异步观察 terminal            |
| Desktop/API queue-send                | `submit(allowQueue=true)`  | 内部单条 enqueue + 首次 dispatch；不等待 Turn            |
| 微信、飞书、Telegram inbound          | `submit(allowQueue=true)`  | 不查询 active Turn；不等待 Turn                          |
| Cron                                  | `steer`                    | active steer、idle activate；admission 即 delivered      |
| 同步 Task 子 Agent                    | `submit(allowQueue=true)`  | caller 等 completion 返回 child outcome/final text       |
| Background Task 执行子 Agent          | `submit(allowQueue=true)`  | runner 等 completion 形成 terminal task result           |
| Background Task terminal notification | `steer`                    | admission 成功即写 `deliveredAt`                         |
| Team task                             | `submit(allowQueue=true)`  | Queue admission 后返回                                   |
| Thread Goal                           | `submit(allowQueue=true)`  | Queue admission 后返回；Goal 继续拥有附件/recovery 状态  |
| Agent Communication                   | `steer`                    | admission 成功即记录 delivered                           |
| Questionnaire 回复                    | `submit(allowQueue=true)`  | Queue admission 后返回                                   |
| Greeting / system reminder            | `submit(allowQueue=true)`  | admission 后返回并记录 `turnId`；terminal event 异步结算 |
| Team cancel / Stop                    | `abort`                    | 根据 abort result 判断是否存在/终止了 Turn               |

`send_msg` 的 busy application error 应明确表达：

```text
Session already has an active Turn. Retry with queueing enabled to deliver it later.
```

application 不在 `submit` 前预查 busy；durable
admission/lease 才是并发真值，预查询会产生 check-then-act race。

Queue position 仍只表示 SessionSystem Queue
row 顺序；TurnSystem 在首次 dispatch 后用内部 Queue 快照与 `activeTurnId` 计算
`ahead`，因此 IM 第一条等待消息也会把当前 active
Turn 计为一项。该计算留在 TurnSystem 内部，不向 application 暴露 `isBusy` 或 TurnController。

### 12.4 删除 `isBusy`

当前 v1 `isBusy` 只有三类用途，均可被 authoritative operation result 替代：

1. Resume SSE：按 12.2 改为 Session stream 后不再需要；
2. Team cancel：直接调用 `abort`。`aborted` / `released` 表示存在并已终止或释放； `not-running`
   表示空 abort，调用方据此返回 `turnAborted = false`；
3. Thread Goal continuation：直接调用 `submit(allowQueue=true)`；TurnSystem 内部完成 durable Queue
   admission 与 dispatch，不再以 `active-turn` 作为 producer 分支。

这不会引入双 Turn：每条 Goal item 有稳定 client request identity 与预留 `turnId`，Queue
FIFO 和 durable Turn admission 是最终互斥点。Goal 仍自己拥有 attachment
snapshot、pending/enqueued/consumed 状态与 recovery；TurnSystem 不读取 Goal domain。

### 12.5 Channel Queue 与返回事件路由

Channel 只负责消息接入和对外回复，不负责判断 Session 是否 active：

```text
Channel inbound
  -> application/channel
       -> TurnService.submit(allowQueue = true, source = channel:*)
            -> SessionSystem.queue.enqueue(one item)
            -> QueueDispatcher.dispatch(sessionId)

QueueDispatcher
  -> claimNext(one FIFO item)
  -> internal QueueTurnExecutor
  -> TurnExecutionService
  -> AgentHost

AgentHost required event pipeline
  -> Session/Message/Stream/Turn projection
  -> injected best-effort observer
  -> ChannelSystem.ChannelFinalReplyObserver
  -> injected v1 product Channel final-reply capability
  -> concrete Channel adapter
```

现有数据链已经保存了大部分路由事实：

- Queue item 保存 `source` 与 `channelContext`；
- Queue claim 生成 `routingFingerprint` 与 `sourceContext`；
- Dispatcher 将 provenance 交给 AgentHost ingress；
- AgentHost `AgentEventContext` 继续携带 provenance；
- committed display message 保存 `source` / `sourceContext`。

本轮 Channel delivery owner 已按以下边界完成：

- neutral conversation contract 与 v1 Channel runner 已删除 `waitForResult` /
  `waitAccepted(queueItemId)`；Channel inbound 只调用 `submit(allowQueue=true)`，不再补第二次
  `dispatchQueue`；
- AgentHost 不得 import Channel，也不直接做网络发送；
- `service/channel-system/ChannelFinalReplyObserver` 只在 required Message/Session/Stream/Turn
  projector 全部成功后观察 terminal event；中间 chunk 不进入 Channel；TurnSystem 只接收 generic
  observer port；
- source 为 `channel:*` 时路由到对应 Channel adapter；其他 source 不进入 Channel；
- Queue 每条 item 独立成为一个 Turn；provenance 的 `source + routingFingerprint`
  仍绑定该 item 的平台/chat/thread/binding，保证一个 Turn 只对应一条 Channel route；
- observer 优先使用当次 `AgentEventContext.provenance`；重启或进程内 context 丢失时，按
  `sessionId + turnId` 从 durable user Message 的 `source/sourceContext` 恢复 route；
- ChannelSystem 只依赖 `ChannelFinalReplyDelivery` capability，实际发送由
  `packages/local-runtime/src/api/hosted-channel-capabilities.ts` 提供，并经
  `compat/v1/agent-host.ts` 的独立 Channel capability 注入；AgentHost 不知道具体 IM 渠道；
- observer 不维护 waiter、acceptance registry、typing handoff、recent-result cache、delivery
  receipt 或 dedupe。一次 terminal callback 只要存在 committed assistant
  Message 就调用一次发送；重复 callback 可能重发，进程在 Message
  commit 与 callback 之间崩溃时也不承诺自动 replay。可靠 outbox 属于后续独立增强。

`service/channel-system` 是 Channel 领域统一迁移位置。当前先拥有 terminal final-reply
routing；后续 v1 Channel
inbound、binding、transport 与 lifecycle 迁移时继续进入该 owner，不能重新放回 SessionSystem、TurnSystem 或 AgentHost。

### 12.6 Session 删除

外部 Delete Session API 仍是一个 application use
case，但内部必须保留“先封住新工作，再等待旧工作退出，最后删除数据”的顺序。只调用普通 `abort`
不够，因为还存在：

- durable admit 已完成、Controller 尚未 register 的 Turn；
- closing 但尚未完成 terminal projection/release 的 Turn；
- Queue 正在 claim、recovery 或 raced dispatch；
- 删除检查后进入的新 submit/steer/Queue mutation。

TurnSystem 对 application caller 只暴露一个 `sessionDeletion(sessionId, cleanup)`。它内部完成：

1. 调用 SessionSystem 的进程内 deletion gate；不存在的 Session 幂等返回；
2. 阻止该 Session 的新 Turn operation、user Message commit 与 Queue mutation；
3. 停止并 drain 该 Session 的 Queue dispatch；
4. 等待 admitted-before-register handoff；
5. abort exact active/closing Turn，并等待 durable settlement 与 Controller release；
6. 验证 durable/local quiescence；
7. 删除 TurnSystem-owned Session 数据，包括 Turn ingress receipts、client request
   mapping、per-Session sequence mapping 与 Turn lease；durable deletion fence 继续保留；
8. 在 operation gate 和 Dispatcher 仍处于 blocked 状态时执行注入的 Session-owned cleanup；
9. cleanup 成功后删除 durable deletion fence，再释放进程内 deletion/operation gate。

不再额外暴露 `beginDeletion`、`deleteSessionData`、`quiesceSession` 或
`completeSessionDeletion`。Application 注入 cleanup closure，TurnSystem 只提供 quiesced
scope，不 import SessionSystem implementation：

```text
TurnSystem.turns.sessionDeletion(sessionId, async () => {
  await SessionSystem.sessions.deletion.deleteSession(sessionId)
})
  -> process-local Session deletion gate begin
  -> drain/abort/release
  -> delete Turn-owned data
  -> delete Queue/File/Usage/Message/History/Stream/Session record
  -> release process-local gates
```

HTTP route 与 v1 compatibility 只调用统一 Session lifecycle use
case，不感知 Controller 或 Dispatcher。若 Turn quiescence 失败，cleanup 不执行；若 Session-owned
cleanup 失败，Session record 与进程内 gate 保留，显式重试继续 fail
closed。进程重启会先完成 Dispatcher 的 repository、Session 与 Queue claim
recovery，并注销当前 recovery operation；随后接管死亡 owner 的 durable deletion
fence，通过同一幂等 workflow 续删。续删失败时 fence 保留并按既有 recovery
timer 重试，close 会 drain 已开始的续删、取消未开始的 timer，并停止启动同一批次中后续的 Session
续删，使其 durable fence 留给下次启动恢复。不得在 Dispatcher 当前 recovery Promise 内调用 deletion
workflow，否则 `quiesceSession()` 会等待当前 recovery 自己；也不得通过忽略 recovery 来削弱删除隔离。

SessionSystem 的 Queue、File、Usage、Message、History、Stream 和 Session
record 删除仍属于 SessionSystem，不能为了“一个接口”搬进 TurnSystem。`sessionDeletion`
只提供 TurnSystem-owned cleanup 与 quiesced scope。Session metadata update、Root replacement、child
creation/reparent 不额外参与删除 gate。

原先讨论过的三段式 application 流程不再采用：

```text
SessionSystem.beginDeletion
  -> TurnSystem.prepareSessionDeletion
  -> SessionSystem.deleteSession
```

其中 begin 已内聚进 TurnSystem 的 `sessionDeletion` 调用 SessionSystem fence
capability，所以对 consumer 仍是上面的两个稳定 owner 调用，不增加第三个 public API。

### 12.7 实施与回归顺序

1. 恢复 Session 级 Resume SSE 与 durable/ring/live stitching，删除 Resume 对 `activeTurnId` /
   `completeTurn` 的依赖；
2. 收窄 TurnService，并把 exact Controller steer、Dispatcher、Host、deletion
   primitives 隐藏到 owner 内部；
3. 统一 `submit(allowQueue)`，把 enqueue
   capability 收回 TurnSystem，并固定单条 enqueue 后立即 dispatch；
4. 将 Cron 改为只调用 public `steer`；
5. 删除 v1 `isBusy`，分别按 submit/abort/Queue query result 改 consumer；
6. 建立 provenance-aware 的 Channel terminal observer 与 v1 product delivery capability，随后删除
   `waitQueueAccepted` / `waitForResult`；
7. 将进程内 Session deletion gate 归 SessionSystem，并收敛一个覆盖 cleanup callback 的
   `sessionDeletion` Turn capability；
8. 将 Turn execution 放入 `execution/`、operation/deletion/recovery 放入 `lifecycle/`，删除泛化
   `orchestration/` 与旧的对外/application enqueue workflow；
9. 更新 neutral conversation contract、README、behavior spec、architecture/layout
   gates 和 production composition。

新增回归至少覆盖：

- Resume 在 DB snapshot 期间同时发生 commit/chunk 时不丢失、不重复，跨多个 Turn 保持连接；
- missing anchor、ring eviction、invalid epoch 显式 resync；
- `send_msg` busy 返回 queueing 指引且 Queue 零写入；
- Channel active/idle 两种状态都只调用 `submit(allowQueue=true)`，且不重复 dispatch；
- Channel provenance 跨 Queue -> AgentHost -> Message/Event 保持；每条 item 独立 Turn，terminal
  callback 直接发送且不建立 waiter/dedupe；
- Cron active steer、idle activate，Queue 永远零写入；
- Goal submit 保持 exact client request idempotency，并由 Queue FIFO 调度；
- Background Task terminal notification 与 Communication admission 成功即 delivered，不等待 Turn；
- Team 空 abort 与 active abort result 映射；
- process-local deletion gate 后并发 submit/steer/Queue mutation/claim 为零，closing Turn
  release 前不开始 cleanup，cleanup 完成前不释放 gate，Turn 与 Session 各自只删除 owner 数据。

### 12.8 本轮落地结果

上述 12.1 至 12.7 已在本分支完成：

- `TurnSystemOwner.turns` 只保留六个稳定方法；public
  barrel 不再导出 Controller、Dispatcher、Repository、Host implementation 或 deletion primitive；
- public `submit` 统一接收 `allowQueue`：false 直接 activation，true 预留 `turnId`、单条 durable
  enqueue 并立即 dispatch。Direct Send Application 额外负责 Message commit/accept、Session stream
  reservation、Session activation 与 title notification；Queue Dispatcher 调用 internal
  `QueueTurnExecutor`，只增加 claim/item identity 的 `ingress` 元数据。普通与 Queue claim
  execution 共用 `busyReason: turn` admission，只有 compaction 使用不同 `busyReason`；
- queued completion 继续使用预留 `turnId`，通过 Queue committed fact 与实际 Turn
  completion 绑定；没有新增 `submissionId`。cancel/expire/admission
  reject 会在同一 handle 上结算 aborted/failed；
- active `steer` 接受与 submit 相同的 message/attachment schema，attachment 经过 native Pi input
  preparation；active model override 明确拒绝，idle activation 仍可 override；
- Session resume 已改为 Session 级 durable/ring/live stitching，跨 Turn terminal 保持连接；
- Desktop queue-send、Channel、Task、Background Task execution、Team、Thread
  Goal、Questionnaire 与 Greeting 统一调用
  `submit(allowQueue=true)`；外部 contract 不再暴露 enqueue；
- Queue message 分别持久化执行附件与结构化展示附件；dispatch 将展示附件原样交给 User Message
  projection；
- Cron、Background Task terminal notification 与 Agent Communication 统一调用 public
  `steer`；后两者 admission 成功即记录 delivered，不等待 completion；
- Greeting submit admission 成功后立即返回并记录预留 `turnId`；只有对应 `session.finish` 写
  `greeting_sent=true`，error/abort 保持 false 供后续重试；
- Channel terminal delivery 使用 Queue provenance 与 Agent event
  context 路由；context 缺失时回查 durable user Message。neutral contract、v1
  runner 与 SessionSystem 已删除 Queue waiter/recent-result 状态，具体发送只经 v1 product
  capability 注入；
- accepted 后的 Message/Session side effect 失败通过可拒绝的 execution-start
  handoff 交给 Coordinator，在 Host 进入前投影 failed terminal 并 exact settle/release；durable
  accepted Turn receipt 保留，Message 不维护另一套恢复状态；
- duplicate admission 由 SessionSystem Message service 按 stable Message identity 与 exact
  `inputDigest` 幂等修复；Direct、Queue/headless 与 v1 compatibility 均覆盖该路径；
- Direct Send、Queue claim/headless 与 v1 compatibility 共用 Application
  `UserMessageTurnDeliveryService`；Direct Send 只额外 reserve SSE/准备 Session
  activation，Queue 只额外传递 claim identity；
- v1 compatibility 的 submission adapter 只依赖 public
  `TurnService.submit/steer`，不再暴露或注入Queue enqueue workflow，也不复用 `turn-system/execution`
  内部 executor；
- Turn deletion 在同一个进程内的 quiesced scope 执行 Session-owned cleanup，并覆盖 direct
  Turn admission/Message commit、Queue mutation/claim、admitted-before-register、closing
  Turn 与 compaction；删除协调不持久化 Session 状态；
- TurnSystem 目录已拆为 `execution/`、`lifecycle/` 与 `persistence/`，根部只保留 public
  contract、initializer、composition 和 Queue Dispatcher；`initialize.ts` 不再充当内部 component
  barrel。

## 13. TurnSystem / AgentHost 结构收敛

### 13.1 范围

本轮只优化内部 ownership 与 production composition，不修改已验收的 Turn、History、terminal、Session
deletion 或 Compaction 业务语义。实施项固定为：

1. 将 TurnSystem 与 AgentHost 的集中式 contracts 按 owner 拆分；
2. 将 `LocalAgentHost` 中的 preflight 与 History/Event/terminal commit pipeline 提取为独立组件；
3. 删除透明 composition 转发层，并让 Session title 与 AgentHost 共享同一 preparation/model
   capability；
4. 将 `model-system` 从 TurnSystem 子目录提升为 sibling service。

manual/automatic Compaction 仍保留原入口、算法、lease、History commit、observer 与 lifecycle
settlement，只有相关 type contract 移到 `agent-host/compaction/contracts.ts`。

### 13.2 Contract ownership

TurnSystem 根 `contracts.ts` 只保存 public `TurnService`、Queue/Application 交界、Host composition
capability 与 initializer contract；它不依赖 owner-local implementation contract：

```text
turn-system/
├── contracts.ts
├── execution/contracts.ts
├── lifecycle/contracts.ts
└── persistence/contracts.ts
```

AgentHost 根 `contracts.ts` 只保存稳定 Host facade 与 constructor
seam；其余纯类型由对应 owner 维护，并通过 module facade 保持既有内部导入兼容：

```text
agent-host/
├── contracts.ts
├── preparation/contracts.ts
├── history/contracts.ts
├── events/contracts.ts
├── runner/contracts.ts
└── compaction/contracts.ts
```

架构测试同时固定根 contract 不重新吸收 Repository、Controller、History、Event、runner 或 Compaction 内部类型。

### 13.3 AgentHost lifecycle

`LocalAgentHost` 仍是唯一顶层 lifecycle owner，顺序保持：

```text
TurnPreflight
  -> AgentRuntime assembly
  -> turn_start
  -> LocalRuntimeTurnExecutor
  -> TurnCommitPipeline drain/reconcile
  -> turn_end
  -> authoritative terminal commit
```

- `preparation/turn-preflight.ts` 负责 Session、Agent、canonical History、model/config
  preparation、canonical input 与 secret-free assembly context；
- `events/turn-commit-pipeline.ts` 是唯一 terminal state owner，负责 ordered Event lane、History
  replay/retraction/reconcile、runtime outcome 映射和 authoritative terminal acknowledgement；
- `LocalRuntimeTurnExecutor` 继续只负责 native runner、tools、steer、safety、file 与 Background Task
  execution，不再保留第二套 terminal collector；
- `LocalAgentHost` 只决定上述阶段顺序及失败补偿，不再内联各阶段实现。

### 13.4 Composition 与 ModelSystem

production graph 保留 `initializeTurnSystem({ createHost })` 的 cycle
inversion，但删除只做参数转交的 `initializeTurnSystemAgentHost`：

```text
services.ts
├── createProductionAgentPreparation
├── initializeSessionSystem
├── initializeTurnSystem
└── createLocalAgentHost
```

`services.ts` 只创建一次 preparation；其中的 ModelSystem resolver 同时被
`createProductionSessionTitleModel` 与 AgentHost 使用，避免两套 config/model/auth
resolution。仍保留的 native/base dependency builder 分别拥有 AgentRuntime/tool
assembly 与 fail-closed adapter validation，并非公开 product workflow。

`service/model-system` 具有标准 `contracts.ts`、`initialize.ts`、`index.ts` 与
`resolution/`；它不依赖 TurnRepository、Controller、AgentHost lifecycle 或 Session
persistence，其他 service 只能从 `service/model-system/index.ts` 消费 capability。

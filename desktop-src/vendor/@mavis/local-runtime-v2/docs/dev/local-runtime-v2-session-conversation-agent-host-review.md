# Local Runtime v2 Session / Conversation / AgentHost 全量 Review

## 1. 结论

本报告审查 `feat/local-runtime-v2-session`
合入 AgentHost 后的当前交付状态，范围包括 Session、Message、Queue、Turn、canonical
history、stream、AgentHost、Channel、Thread
Goal、Cron、Project、DesktopService 路由，以及仍然使用对话能力的 v1 product consumer。

当前结论：

1. Session / Message / Queue / Turn / canonical history / stream 的 production owner 已经迁到
   `packages/local-runtime-v2`，没有发现仍会回写 legacy conversation storage 的正常产品路径。
2. Electron front door 由 v2 接管 57 个唯一 DesktopService 方法；另有 `requestRotation`
   明确保留 compatibility 501。其余 133 个方法属于尚未迁移的独立产品 domain，不是本次 Session /
   Conversation 迁移遗漏。
3. 中立的 `RuntimeConversation` 已包含并实现 19 个 query / lifecycle / ingress /
   maintenance 方法。v1 consumer 通过这个边界调用 v2，不直接依赖 v2 repository。
4. 本轮明确要求的行为已经落到当前实现和测试中：
   - failed Channel Turn 即使没有 assistant Message，也会给 IM 用户发送错误回复；
   - 应用重启会中断旧进程留下的运行状态并释放占用，但不会自动继续旧 Turn，也不会自动发送 Queue；
   - 用户新发消息或点击“立即发送所有排队消息”可以重新唤醒 FIFO；
   - 所有 Queue source 都是一条 item 对应一个 Turn，不再对 Desktop/API 消息做 batch；
   - Goal 自己持久化首次 Turn 的附件，Queue 只保存可执行副本；
   - Channel typing、Desktop Session lifecycle 指标、builtin command 指标已接入；
   - `createSession(projectId)` 对非零值明确返回 400。
5. 没有保留已完成修复的 finding。当前只保留两项经过产品决策接受的边界：
   - graceful shutdown 不等待已经开始发送的 Channel final reply；
   - canonical history exact retry 不增加跨进程强幂等账本。

本报告只描述当前实现和仍然有效的设计边界，不保留修复前行为的待办记录。

## 2. Review 基线与方法

| 项目               | 当前口径                                                                            |
| ------------------ | ----------------------------------------------------------------------------------- |
| 目标分支           | `origin/feat/local-runtime-v2-session`                                              |
| 同步基线           | `50a60238ca9735ee008b9de347842a9511fd69fb`                                          |
| AgentHost 接入 tip | `590d7f19c22d2d58cd32fe7e238724c1af9655ca`                                          |
| 最终交付           | 本文所在提交；精确值以远端目标分支 tip 为准                                         |
| v1 业务参照        | `packages/local-runtime` 当前 compatibility consumer 和迁移前保留测试               |
| Cloud history 参照 | `packages/cloud-runtime/src/messages/message-store.ts` 与 `remote-message-store.ts` |
| Review 日期        | 2026-07-29                                                                          |

审查方式不是只看 diff，而是从四个方向交叉核对：

1. 从 191 个 generated DesktopService 方法出发，确认 production front door 的真实 owner。
2. 对 57 个 v2 route 和 `requestRotation` 逐项检查 request
   mapping、业务调用、错误映射和用户可见行为。
3. 从所有 v1 consumer 反向检查 `RuntimeConversation` 19 个方法，确认没有绕开 v2 owner。
4. 从 SessionSystem、TurnSystem、AgentHost、ChannelSystem、Goal 和 startup /
   shutdown 生命周期检查内部状态迁移、持久化顺序、恢复和副作用。

关键入口：

- v2 route allowlist： `packages/local-runtime-v2/src/http/routing/allowlist.ts`
- production composition： `packages/local-runtime-v2/src/services.ts`
- v1 compatibility：
  `packages/local-runtime-v2/src/service/v1-conversation-compat/v1-conversation-compat.ts`
- 中立 contract： `packages/agent-modules/conversation-contract/src/index.ts`
- v1 host 注入： `packages/local-runtime-v2/src/compat/v1/runtime.ts`

## 3. Production ownership

### 3.1 数据与调用方向

```text
Desktop HTTP
  -> v2 Application
     -> SessionSystem / TurnSystem
        -> AgentHost

v1 product consumer
  -> @mavis/conversation-contract
     -> DeferredRuntimeConversation
        -> V1ConversationCompatibilityService
           -> 同一套 SessionSystem / TurnSystem

AgentHost
  -> 只通过窄 capability 使用尚未迁移的 Agent、Model、Tool、Permission、
     Channel transport、Goal、Diff 等独立产品能力
```

当前 production 只创建一套 SessionSystem
owner。Applications、TurnSystem、AgentHost、ChannelSystem、Cron 和 `RuntimeConversation`
共享同一套 Session / Message / Queue / history / stream 能力。

v1 host 在 compatibility service 绑定前关闭 legacy conversation writer。startup 先完成 v2
recovery 和 Goal kickoff 对账，最后才开放 deferred bridge，因此 recovery 期间不会意外走 legacy
storage。

### 3.2 191 个 DesktopService 方法的归属

| Domain        |    总数 | v2 production | v1 / compatibility | 判断                                                |
| ------------- | ------: | ------------: | -----------------: | --------------------------------------------------- |
| Demo          |       9 |             4 |                  5 | 只迁基础探针，符合范围                              |
| Plugin        |       9 |             0 |                  9 | 独立产品 domain                                     |
| MCP           |       2 |             0 |                  2 | 独立产品 domain                                     |
| ModelProvider |      13 |             0 |                 13 | 独立 owner；AgentHost 只用窄 capability             |
| Agent         |       5 |             0 |                  5 | Agent identity/config owner 未迁                    |
| Pin           |       4 |             0 |                  4 | preference owner 未迁                               |
| Cron          |      13 |            13 |                  0 | 7 个 v2 API；6 个 retired API 稳定 501              |
| Goal          |       4 |             0 |                  4 | Goal 是独立 domain；对话调度走 v2 Queue             |
| Channel       |       9 |             0 |                  9 | binding/transport 留在 v1，conversation state 走 v2 |
| Questionnaire |       5 |             0 |                  5 | 独立产品 domain                                     |
| Skill         |      11 |             0 |                 11 | 独立产品 domain                                     |
| Project       |       9 |             8 |                  1 | `updateProject` 不在迁移范围                        |
| Session       |      32 |            31 |                  1 | `requestRotation` compatibility 501                 |
| Memory        |      28 |             0 |                 28 | 独立产品 domain                                     |
| Permission    |       6 |             0 |                  6 | 独立产品 domain                                     |
| WorkspaceFile |      31 |             0 |                 31 | workspace utility owner                             |
| Events        |       1 |             1 |                  0 | v2 Global Event stream                              |
| **合计**      | **191** |        **57** |            **134** | ownership 闭环                                      |

134 个 compatibility 方法中，133 个属于独立 domain；另一个是明确不支持的 `requestRotation`。

## 4. 迁移相关 DesktopService 接口逐项 Review

以下 58 项包括 57 个 production v2 route 和一个 intentional compatibility route。

|   # | 接口                     | 当前实现与 v1 / 产品语义对比                                                                                   | 判断                   |
| --: | ------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------- |
|   1 | `ping`                   | 基础健康探针和 response shape 保持                                                                             | 一致                   |
|   2 | `getEcho`                | body binding 和 echo 保持                                                                                      | 一致                   |
|   3 | `getPathEcho`            | path binding 和 echo 保持                                                                                      | 一致                   |
|   4 | `streamEcho`             | SSE chunk、结束边界保持                                                                                        | 一致                   |
|   5 | `subscribeGlobalEvents`  | v2 EventBus 提供 heartbeat、容量保护和 unsubscribe；v1 独立 producer 通过 write-only publisher 汇入同一 stream | 一致；owner 更清晰     |
|   6 | `listCronDefinitions`    | 读取 v2 Definition，而不是旧 CronTask                                                                          | 符合 Cron v2 设计      |
|   7 | `getCronDefinition`      | Definition ID exact query 和 not-found mapping                                                                 | 符合 Cron v2 设计      |
|   8 | `createCronDefinition`   | Definition commit 后协调 Scheduler，失败有 compensation                                                        | 符合 Cron v2 设计      |
|   9 | `updateCronDefinition`   | 版本化 mutation 和 Scheduler 收敛                                                                              | 符合 Cron v2 设计      |
|  10 | `deleteCronDefinition`   | 删除 Definition 并收敛 Scheduler                                                                               | 符合 Cron v2 设计      |
|  11 | `triggerCronRun`         | pending-first durable Run 状态机                                                                               | 符合 Cron v2 设计      |
|  12 | `listCronRuns`           | durable Run + cursor pagination                                                                                | 符合 Cron v2 设计      |
|  13 | `deliverCron`            | active 时 steer，idle 时 activate；不通过普通 Queue 假装 user message                                          | 符合 Cron v2 设计      |
|  14 | `sendMessage`            | `submit(allowQueue=false)`；先持久化 user ingress，再 admission、Host execution、SSE；busy/priority 明确失败   | 核心一致，事务边界更强 |
|  15 | `resumeSession`          | 默认只订阅 durable catch-up/live stream；`drainQueued=true` 时先订阅再显式 wake Queue                          | v2 明确设计            |
|  16 | `abortSession`           | exact active lease abort，等待 release；无 active Turn 稳定返回 409                                            | 一致，fence 更强       |
|  17 | `enqueueMessage`         | transport 名称保留；内部统一为 `submit(allowQueue=true)`，单条 enqueue 后立即尝试 dispatch                     | 一致                   |
|  18 | `requestCompaction`      | 使用 v2 compactor，不启动普通 Agent loop；记录 `compact` builtin 指标                                          | 一致                   |
|  19 | `requestRotation`        | 不进入 v2 allowlist；compatibility handler 稳定返回 unsupported，不启动 legacy rotation                        | 一致且为明确退出       |
|  20 | `listCrons`              | retired contract 稳定 501                                                                                      | 预期 breaking cutover  |
|  21 | `listCronSessions`       | retired contract 稳定 501                                                                                      | 预期 breaking cutover  |
|  22 | `createCron`             | retired contract 稳定 501，阻止旧表写入                                                                        | 预期 breaking cutover  |
|  23 | `triggerCron`            | retired contract 稳定 501，阻止双执行                                                                          | 预期 breaking cutover  |
|  24 | `updateCron`             | retired contract 稳定 501                                                                                      | 预期 breaking cutover  |
|  25 | `deleteCron`             | retired contract 稳定 501                                                                                      | 预期 breaking cutover  |
|  26 | `getRootSession`         | 唯一 Root query / repair                                                                                       | 一致                   |
|  27 | `replaceRootSession`     | atomic root swap；保留 Turn abort、Channel binding、archive title 和 committed events                          | 一致；并发完整性更强   |
|  28 | `listSessions`           | filter、sort、keyset pagination 下推 SQLite                                                                    | 功能一致；实现优化     |
|  29 | `createSession`          | 字段和 error mapping 保持；非零 `projectId` 明确 400；记录 `new` 与 lifecycle 指标                             | 一致                   |
|  30 | `getSidebarSessionTree`  | 本地产品仍明确不支持，稳定 501                                                                                 | 一致且预期             |
|  31 | `getSessionTree`         | parent/child、filter、pagination 保持                                                                          | 一致                   |
|  32 | `searchSessions`         | keyword/filter/cursor 保持                                                                                     | 一致                   |
|  33 | `getSession`             | exact Session view 和 not-found mapping 保持                                                                   | 一致                   |
|  34 | `updateSession`          | title/model/run policy mutation 和 committed event 保持                                                        | 一致                   |
|  35 | `getSessionUsage`        | token row 和 aggregate shape 保持                                                                              | 一致                   |
|  36 | `getPeekContext`         | context snapshot 和 missing mapping 保持                                                                       | 一致                   |
|  37 | `getSessionDiff`         | v2 持有 eligibility/mapping，底层 file-change storage 通过窄 product port                                      | 功能一致；明确过渡     |
|  38 | `deleteSession`          | durable Turn quiesce、跨 domain cleanup、pin cleanup 和 committed event                                        | 一致且更强             |
|  39 | `archiveSession`         | archive/unarchive flag 保持，记录 lifecycle 指标                                                               | 一致                   |
|  40 | `compressSession`        | 保持 v1 的 archive alias，不等于 context compaction                                                            | 一致                   |
|  41 | `getMessages`            | display Message pagination、parts、attachments、usage 保持；`rawJson` 为 additive 字段                         | 一致                   |
|  42 | `listQueueMessages`      | 只列 composer-visible `queued` 项，稳定 FIFO                                                                   | 一致                   |
|  43 | `getQueueItem`           | exact GET 可见 `queued` 和 `claimed`；mutation 对 claimed 仍返回不可编辑                                       | 合理且已冻结的增强     |
|  44 | `updateQueueItem`        | 只允许 queued 且 `source=api` 的 Desktop composer item mutation；Channel / Goal 等业务来源不可编辑             | 一致；保护 routing     |
|  45 | `reorderQueue`           | 要求完整 permutation，并阻止跨 claimed boundary 修改                                                           | 一致                   |
|  46 | `deleteQueueItem`        | queued-only cancel；claimed 不可编辑                                                                           | 一致                   |
|  47 | `getTurnDiff`            | selector/mapping 保持，底层 file-change port 独立                                                              | 功能一致；明确过渡     |
|  48 | `revertTurnDiff`         | eligibility + fail-closed mutation                                                                             | 一致                   |
|  49 | `reapplyTurnDiff`        | eligibility + fail-closed mutation                                                                             | 一致                   |
|  50 | `listSessionFiles`       | attachment/artifact 由 v2 asset index 提供                                                                     | 一致；owner 已迁移     |
|  51 | `listProjects`           | identity、order、pin、hidden query 保持                                                                        | 一致                   |
|  52 | `listProjectSessions`    | Project filter + stable Session list                                                                           | 一致                   |
|  53 | `setProjectPinned`       | preference mutation 保持                                                                                       | 一致                   |
|  54 | `setProjectHidden`       | hidden mutation 保持                                                                                           | 一致                   |
|  55 | `putProjectsOrder`       | complete order 和 validation 保持                                                                              | 一致                   |
|  56 | `archiveProjectSessions` | 稳定串行 best-effort，返回成功/失败 ID                                                                         | 一致                   |
|  57 | `listRecentProjects`     | recent order/limit 保持                                                                                        | 一致                   |
|  58 | `touchRecentProject`     | timestamp upsert 保持                                                                                          | 一致                   |

逐接口复查没有发现仍需修改的 observable parity 问题。

## 5. 明确继续由独立 v1 domain 持有的 133 个接口

这些接口可以留在 v1 product owner，但不得读写 legacy Session / Message / Queue /
Turn。需要对话能力时必须调用 `RuntimeConversation`。

- Demo 5 个： `getHeaderEcho`, `getQueryBindingEcho`, `getNestedQueryBindingEcho`,
  `submitFieldEcho`, `submitNestedFieldEcho`
- Plugin 9 个： `listMarketplacePlugins`, `getMarketplacePlugin`, `listInstalledPlugins`,
  `listEnabledPlugins`, `installPlugin`, `uninstallPlugin`, `enablePlugin`, `disablePlugin`,
  `refreshPlugins`
- MCP 2 个： `listLocalMcpServers`, `setLocalMcpServerEnabled`
- ModelProvider 13 个： `listModels`, `selectModel`, `listModelProviders`, `listUserModelProviders`,
  `getMiniMaxApiKeyStatus`, `upsertMiniMaxApiKey`, `createUserModelProvider`,
  `updateUserModelProvider`, `deleteUserModelProvider`, `testUserModelProvider`, `testUserModel`,
  `getMinimaxModelSource`, `setMinimaxModelSource`
- Agent 5 个： `listAgents`, `createAgent`, `getAgent`, `updateAgent`, `deleteAgent`
- Pin 4 个： `pinAgent`, `pinSession`, `getPinnedItemsOrder`, `putPinnedItemsOrder`
- Goal 4 个： `createGoal`, `getGoal`, `patchGoal`, `deleteGoal`
- Channel 9 个： `listChannelBindings`, `unbindChannel`, `bindTelegram`, `startWechatBind`,
  `getWechatBindStatus`, `bindFeishu`, `startLarkOnboard`, `getLarkOnboardStatus`,
  `cancelLarkOnboard`
- Questionnaire 5 个： `beginQuestionnaire`, `replyQuestionnaire`, `dismissQuestionnaire`,
  `getPendingQuestionnaire`, `getQuestionnaire`
- Skill 11 个： `listSkills`, `listSkillHub`, `installSkill`, `previewSkill`, `createSkill`,
  `getSkill`, `listSkillFiles`, `getSkillFile`, `deleteSkill`, `setSkillEnabled`,
  `listRuntimeSkills`
- Project 1 个： `updateProject`
- Memory 28 个： `getMemory`, `appendMemory`, `writeMemory`, `editMemory`, `searchMemory`,
  `listMemoryTopics`, `getMemoryTopic`, `writeMemoryTopic`, `deleteMemoryTopic`,
  `appendMemoryTopic`, `editMemoryTopic`, `searchMemoryTopics`, `listMemoryDaily`, `getMemoryDaily`,
  `writeMemoryDaily`, `appendMemoryDaily`, `deleteMemoryDaily`, `listMemoryArchive`,
  `getMemoryArchive`, `writeMemorySummary`, `snapshotForMemoryCleanup`, `archiveOldMemoryDaily`,
  `triggerMemoryCleanup`, `markMemorySession`, `getUnremindedMemorySessions`, `markMemoryReminded`,
  `markMemoryReflected`, `getMemoryReflectionTimestamp`
- Permission 6 个： `replyPermission`, `replyQuestion`, `rejectQuestion`, `listPendingPermissions`,
  `dismissPermission`, `batchReplyPermissions`
- WorkspaceFile 31 个： `listWorkspaceFileTree`, `readWorkspaceFile`, `saveWorkspaceFile`,
  `searchWorkspaceFiles`, `previewWorkspaceFile`, `getWorkspaceFileDiff`, `listWorkspaceFileDiffs`,
  `getWorkspaceDiffContext`, `getWorkspaceFileStatus`, `openWorkspaceApp`, `listIdeApps`,
  `openWorkspaceFile`, `revealWorkspaceFile`, `openWorkspaceFileInIde`, `suggestCommitMessage`,
  `probeWorkspaceGit`, `getWorkspaceGitChanges`, `getWorkspaceGitMetadata`,
  `getWorkspaceGitBranches`, `getWorkspaceGitBranchPicker`, `getWorkspaceGitDefaultBranch`,
  `checkoutWorkspaceGitBranch`, `createWorkspaceGitBranch`, `commitWorkspaceGit`,
  `pushWorkspaceGit`, `applyWorkspaceGitChangeAction`, `listWorkspaceGitWorktrees`,
  `createWorkspaceGitWorktree`, `removeWorkspaceGitWorktree`, `listFsDirs`, `getFsGitInfo`

## 6. `RuntimeConversation` 19 个内部接口逐项 Review

### 6.1 Query

|   # | 方法                 | v1 consumer 用途                     | v2 实现                   | 判断 |
| --: | -------------------- | ------------------------------------ | ------------------------- | ---- |
|   1 | `query.getSession`   | Channel/Task/Goal exact Session      | SessionSystem exact query | 一致 |
|   2 | `query.listSessions` | consumer 枚举和 recovery             | SQL-backed exact list     | 一致 |
|   3 | `query.listMessages` | product adapter 读取 display history | Message query pagination  | 一致 |

### 6.2 Lifecycle

|   # | 方法                           | v1 consumer 用途            | v2 实现                                                               | 判断       |
| --: | ------------------------------ | --------------------------- | --------------------------------------------------------------------- | ---------- |
|   4 | `lifecycle.createSession`      | Task/Channel 等内部 Session | root/internal 分流、workspace resolve                                 | 一致       |
|   5 | `lifecycle.createRootSession`  | Agent provisioning          | 首次 provisioning 保留 caller pointer commit；已存在 Agent 时 promote | 一致       |
|   6 | `lifecycle.replaceRootSession` | Root swap                   | v2 root workflow + post-commit participants                           | 一致       |
|   7 | `lifecycle.updateSession`      | title/metadata mutation     | Session lifecycle mutation                                            | 一致       |
|   8 | `lifecycle.deleteSession`      | domain cleanup              | v2 fenced deletion workflow                                           | 一致且更强 |

### 6.3 Ingress

|   # | 方法                                  | v1 consumer 用途                           | v2 实现                                                 | 判断                              |
| --: | ------------------------------------- | ------------------------------------------ | ------------------------------------------------------- | --------------------------------- |
|   9 | `ingress.submit`                      | direct 或允许排队的普通 Turn               | `submit(allowQueue)`；Queue admission 内部 enqueue+wake | 一致                              |
|  10 | `ingress.steer`                       | Cron/通知/Agent communication continuation | active steer、idle activate；不写 Queue                 | 一致                              |
|  11 | `ingress.listQueued`                  | UI/product recovery                        | composer-visible queued list                            | 一致                              |
|  12 | `ingress.findQueuedByClientRequestId` | Goal kickoff exact idempotency             | exact lookup 同时看 queued 和 claimed                   | 必要增强                          |
|  13 | `ingress.updateQueued`                | 普通 Queue 编辑                            | queued-only update                                      | 一致                              |
|  14 | `ingress.promoteQueuedSource`         | 通用 source mutation compatibility         | queued-only promote 后 wake                             | 能力完整；Goal 不再依赖它保存附件 |
|  15 | `ingress.cancelQueued`                | cleanup/cancel                             | queued cancel；claimed 返回不可编辑                     | 一致                              |
|  16 | `ingress.reorderQueued`               | FIFO UI reorder                            | complete permutation                                    | 一致                              |
|  17 | `ingress.abort`                       | v1 consumer 中止 Turn                      | exact v2 abort                                          | 一致                              |
|  18 | `ingress.dispatchQueue`               | 用户或业务显式唤醒                         | level-triggered dispatcher                              | 一致                              |

`ingress` 不再暴露纯 `enqueue`：Desktop queue API、Channel、Task/Background Task、Team、Thread
Goal、Questionnaire 与 Greeting 都调用
`submit(allowQueue=true)`，由 TurnSystem 内部完成单条 enqueue 和首次 dispatch。Desktop 即时 SSE 调用
`submit(allowQueue=false)`。Cron、Background Task terminal notification 与 Agent Communication 使用
`steer`。

admission 与 terminal 也已拆开：Background Task notification 在 steer 成功后立即写
`deliveredAt`，Communication 在 steer 成功后立即记 delivered，Questionnaire 在 queued
submit 成功后返回；三者都不等待完整 Turn。同步 Task/Background child
runner 仍需要 completion 来返回子 Agent outcome。Greeting sender 在 submit
admission 后立即返回并记录预留 `turnId`，由 terminal event 在 completed 时写
`greeting_sent=true`，failed/cancelled 保持 false。Desktop
SSE 只由 observer 异步观察 completion 以关闭 stream。

### 6.4 Maintenance

|   # | 方法                  | v1 consumer 用途        | v2 实现                      | 判断 |
| --: | --------------------- | ----------------------- | ---------------------------- | ---- |
|  19 | `maintenance.compact` | product 触发 compaction | v2 compactor + stable result | 一致 |

19 个方法均由 v2 实现。compatibility boundary 不包含 legacy Session / Message / Queue / Turn
fallback，也不存在正常路径双写。

## 7. Service 内部功能 Review

### 7.1 SessionSystem

| 能力                     | 当前实现                                                        | 与 v1 的关系                |
| ------------------------ | --------------------------------------------------------------- | --------------------------- |
| Session record/lifecycle | AppDb + `SessionRecordService` / lifecycle owner                | 业务语义一致，owner 收口    |
| Query/tree/search        | SQLite filter/sort/keyset                                       | 功能一致，查询更明确        |
| Root/title               | atomic swap + post-commit binding/title/events                  | 功能一致，并发更强          |
| Project                  | Project repository/service + preference port                    | 一致                        |
| Display Message          | durable Message owner + required projection                     | 一致                        |
| User ingress             | stage、receipt bind、accept、restart recovery                   | 一致，crash 边界更清楚      |
| canonical history        | deterministic JSONL append/replace + required writer/retraction | 正常语义一致                |
| Queue                    | durable queued/claimed、claim receipt、exact lookup             | 一致，并补强 in-flight 幂等 |
| Stream                   | Session-scoped durable catch-up + live ring                     | v2 明确重设计               |
| Usage                    | token rows/aggregate                                            | 一致                        |
| Files/assets             | v2 asset index；file-change storage 通过窄 port                 | ownership 合理              |
| Legacy import            | readonly source + deterministic import + tombstone              | v2 明确迁移设计             |
| Restart                  | startup 标记旧 started Session 为 interrupted                   | 符合当前产品预期            |

### 7.2 TurnSystem

| 能力                  | 当前实现                                                 | 判断                 |
| --------------------- | -------------------------------------------------------- | -------------------- |
| Admission/idempotency | transaction 内 lease、accepted sequence、Turn receipt    | 比 v1 更强           |
| Active control        | exact lease controller、renew、abort、release            | 一致                 |
| Execution             | ExecutionService + Coordinator 唯一 handoff              | 预期收敛             |
| Queue dispatch        | level-triggered Dispatcher；Turn release 继续唤醒        | 符合 FIFO            |
| Queue classification  | Goal item 在 claim 后、执行前判断 ready/defer/cancel     | 避免失效 Goal 被执行 |
| Compaction            | 同一 Host/history writer；manual 不跑普通 loop           | 预期设计             |
| Deletion              | quiesce Dispatcher、等待/abort active Turn、exact settle | 一致且更强           |
| Startup               | 恢复 ingress、旧 Session/Turn/claim；不 dispatch         | 符合当前产品预期     |
| Shutdown              | 阻止新 admission，drain Dispatcher/controller            | Turn 自身完整        |

### 7.3 AgentHost

| 能力                    | 当前实现                                                            | 判断                       |
| ----------------------- | ------------------------------------------------------------------- | -------------------------- |
| Preparation             | immutable preflight + narrow product capabilities                   | 与 v1 功能一致，依赖更清楚 |
| Runner/hooks/permission | 复用 Pi runner、content safety、tool/permission                     | 一致                       |
| Runtime events          | required projection 按 Session → Message → Stream → Turn fact 顺序  | 预期收敛                   |
| History commit          | deterministic operation + JSONL writer + fatal retraction           | 正常路径一致               |
| Failure                 | 保留 user/history，投影 terminal error；Channel 有 error-only reply | 一致                       |
| Replay                  | process-local semantic replay                                       | 接受的边界，见第 10 节     |
| Background Task         | ordinary steer；admission 成功即写 delivered，terminal 走 Event     | 功能一致                   |

### 7.4 ChannelSystem

| 能力                | 当前实现                                                                                                | 判断           |
| ------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| Inbound             | v1 transport adapter 调用 v2 Queue/Turn                                                                 | owner 边界正确 |
| Provenance          | route context 持久化到 Message/Queue/Turn                                                               | 比 v1 更明确   |
| Terminal reply      | terminal observer 读取 durable Turn messages，再调用 v1 transport；Telegram text/media 保留 forum topic | 架构合理       |
| Failed empty reply  | failed 且无 assistant Message 时仍把 terminal error 交给 delivery 并发送错误文本                        | 与 v1 对齐     |
| Typing              | accepted Turn execution 前 start；terminal reply finally 中 end；进程内 exact Turn 去重                 | 与 v1 对齐     |
| Shutdown final send | product observer detached，不纳入 graceful shutdown drain                                               | 明确接受       |
| Binding/transport   | 继续由独立 v1 product owner 提供                                                                        | 预期差异       |

### 7.5 Thread Goal

| 能力                               | 当前 owner/实现                                                           | 判断                    |
| ---------------------------------- | ------------------------------------------------------------------------- | ----------------------- |
| objective/status/budget/accounting | `@mavis/goal` + SQLite Goal store                                         | owner 清晰              |
| kickoff attachments                | Goal row 的 immutable attachment snapshot                                 | owner 正确              |
| kickoff materialization            | Goal commit 后 best-effort 生成 `thread-goal` Queue item                  | Queue 只负责调度        |
| kickoff idempotency                | `goalId` 派生 client request ID；exact lookup 包括 claimed                | 能识别 in-flight        |
| kickoff state                      | `pending -> enqueued -> consumed`                                         | 可恢复且不会重复创建    |
| continuation                       | Turn settlement 后 `submit(allowQueue=true)`                              | FIFO 正确               |
| restart                            | 只对账/补建 Queue item，不自动 dispatch                                   | 符合产品预期            |
| invalid item                       | complete/missing Goal 取消，paused/blocked/permission/questionnaire defer | 安全                    |
| UI                                 | `createGoal` 直接携带附件；banner 读取 `hasKickoffAttachments`            | 不依赖 UI Queue staging |

### 7.6 CronSystem

| 能力        | 当前实现                                     | 判断            |
| ----------- | -------------------------------------------- | --------------- |
| Persistence | Definition / Run / Scheduler durable state   | v2 重设计       |
| CRUD        | Definition mutation + Scheduler compensation | 符合新 contract |
| Execution   | pending-first，active steer / idle activate  | 功能一致        |
| Recovery    | pending Run 按 receipt/state 收敛            | 符合设计        |
| Metrics     | 保留稳定 Cron metric names/tags              | 一致            |

### 7.7 Global Events 与 file changes

当前 production EventBus 是 v2 owner：

- v2 committed Session/Queue/Turn/compaction fact 直接写 EventBus；
- 仍在 v1 的 Agent/Pin/Goal 等 producer 只拿到 write-only publisher；
- 注入 `RuntimeConversation` 时，v1 Desktop wrapper 不再重复发布 title/delete；
- `session.created`、`session.title_updated`、`session.deleted` 的 exactly-once 路径有 runtime
  composition integration test；
- Turn file changes 不再读取 v1 display Message row ID；v2 eligibility/mapping 和独立 file-change
  port 之间没有重新引入 Message owner 依赖。

这是符合预期的依赖收口，不是功能差异。

## 8. 已冻结的关键业务行为

### 8.1 failed Channel Turn 没有 assistant Message

业务场景：

1. 用户在微信、飞书或 Telegram 发来消息；
2. 系统已经接收消息并开始准备回答；
3. model/provider、preflight、permission 或 runner 在输出第一条 assistant Message 前失败；
4. 用户只能看到 IM，无法看到 Desktop SSE。

当前行为：

- completed 且没有 assistant output：不发送空回复；
- aborted 且没有 assistant output：保持静默；
- failed 且没有 assistant output：仍调用 Channel delivery，并携带具体 terminal error；
- failed 已有 assistant partial：发送已提交的 assistant 内容并携带 error；
- 无论 delivery 成功还是失败，typing end 都在 `finally` 中执行。

实现位置：

- `packages/local-runtime-v2/src/service/channel-system/delivery/channel-final-reply-observer.ts`
- `packages/local-runtime/src/api/hosted-channel-capabilities.ts`
- `packages/local-runtime/src/channels/runner.ts`

### 8.2 应用重启后的 Turn 和 Queue

可以把 Turn
lease 理解为数据库中的“这个会话正在回答，请不要启动第二个回答”标记。应用正常结束时会删除它；应用在回答中途退出时，原来的 Agent 已经不存在，但标记可能仍有接近 30 分钟才过期。

当前 startup 使用本进程的 `processStartedAtMs` 作为简单边界：

1. HTTP 尚未开放，也没有新 Turn 可以进入；
2. 恢复 staged user ingress；
3. 把上个进程留下的 started Session 标记为 `interrupted`；
4. 把上个进程留下的 accepted Turn 标为 failed，并释放 transient lease；
5. claimed Queue 如果已有 accepted Turn receipt，则 ack/remove；否则恢复成 queued；
6. Goal 对账可以补建缺失的 kickoff Queue item；
7. 不 dispatch 任何 queued item；
8. 完成以上步骤后才绑定 v1 consumer bridge，并开放 HTTP。

因此用户重启应用后不会看到以下两类意外：

- 一个实际不存在的回答继续占用会话 29 分钟；
- 仅仅重启应用就让昨晚排队的消息自动开始发送。

用户后续操作：

- 没有旧 Queue 时，新消息正常创建 active Turn；
- 有旧 Queue 时，priority fence 让新消息进入队尾，并从最早消息开始按 FIFO 执行；
- 点击一次“立即发送所有排队消息”会发送
  `resumeSession(drainQueued=true)`：先建立 stream，再给 Dispatcher 一个 wake；
- 每个 Turn release 后会继续唤醒下一项，直到 Queue 为空或遇到需要 defer 的 head。
- queued submit 返回的 `position` 只表示 Queue row；面向 IM 的 `ahead`
  由 TurnSystem 在首次 dispatch 后加上当前 active Turn，避免第一条等待消息被误报为前方 0 条。

这里按单 profile、单 local runtime owner 设计，不引入 boot generation、heartbeat 或分布式 lease
protocol。

实现位置：

- `packages/local-runtime-v2/src/service/turn-system/initialize.ts`
- `packages/local-runtime-v2/src/service/turn-system/persistence/turn.repository.ts`
- `packages/local-runtime-v2/src/service/session-system/sessions/recovery/recovery-service.ts`
- `packages/local-runtime-v2/src/service/turn-system/queue.dispatcher.ts`
- `packages/local-runtime-v2/src/application/conversation/conversation-application.ts`
- `packages/ui/src/components/layout/ChatPanel/composer/useChatQueueFlow.ts`

### 8.3 Queue single-item 规则

所有 Queue source 都只通过 `claimNext` 领取一条 item，并为该 item 使用 submit 时预留的独立
`turnId`。Desktop/API、IM、Task、Background Task、Team、Thread
Goal、Questionnaire 与 Greeting 没有例外；Cron、Background Task terminal
notification 和 Communication 已改用 `steer`，正常新路径不写Queue。

Queue message 同时保存 Agent 执行附件和 Desktop 结构化展示附件。前者进入 Pi input，后者经过
`QueueTurnDeliveryInput` 原样进入 User Message
projection，避免排队后丢失 cloud/local/meta 展示字段。

即使用户点“全部发送”，这里的“全部”也表示持续按 FIFO 一条一条执行到 Queue为空，不表示把多条消息拼进同一个 Turn。若未来重新引入 batch，必须同时重新设计预留
`turnId`、逐 submit completion、ack/idempotency、model 与 attachment
projection，不能只扩大 claim 数量。

实现位置：

- `packages/local-runtime-v2/src/service/session-system/queue/repo/drizzle.ts`
- `packages/local-runtime-v2/src/service/turn-system/queue.dispatcher.ts`

### 8.4 Goal attachment ownership

Goal 创建请求直接携带附件。运行时先把 objective、budget 和附件快照一起写入 Goal
row，然后再 best-effort materialize Queue item。

这样拆分后：

- Queue enqueue 失败不会丢 Goal 或附件；Goal 保持 `pending`，后续可以重试；
- startup 只根据 Goal snapshot 补建 Queue，不需要 UI staging；
- Queue item 被 claim 时，exact client request lookup 仍能看到它，不会误判为“已经丢失”；
- Queue item 被真正接受后，Goal 把 kickoff state 标为
  `consumed`，但附件摘要仍保留在 Goal 生命周期内；
- Goal complete/delete 或指向其他 Goal 的陈旧 Queue item 会被原子 cancel；
- paused/blocked、pending questionnaire 或 permission 时，Queue head 被 defer，不会绕过暂停。

SQLite compatibility pass 会条件式补齐 kickoff 字段和索引，同时兼容历史上 migration version
26 的编号碰撞；新的 Goal marker 使用 version 27。

实现位置：

- `packages/agent-modules/goal/src/types.ts`
- `packages/local-runtime/src/thread-goal/store.ts`
- `packages/local-runtime/src/thread-goal/host-integration.ts`
- `packages/local-runtime/src/thread-goal/kickoff-host.ts`
- `packages/local-runtime/src/persistence/db.ts`
- `packages/ui/src/operations/threadGoalOperations.ts`

### 8.5 Channel typing

typing 是 product feedback，不得影响 Turn 结果：

1. Turn 已经被 admission 接受；
2. 真正进入 AgentHost execution 前，按 Channel provenance 调用 adapter 的 `notifyTurnStart`；
3. 同一 `sessionId + turnId` 的进程内重试不会重复 start；
4. terminal observer 完成 final reply（或 delivery 抛错）后，在 `finally` 中调用 `notifyTurnEnd`；
5. start/end adapter 自身失败全部 best-effort，不改变 Turn outcome。

实现位置：

- `packages/local-runtime-v2/src/service/channel-system/delivery/channel-turn-lifecycle.ts`
- `packages/local-runtime-v2/src/application/conversation/user-message-turn-delivery.ts`
- `packages/local-runtime/src/api/hosted-channel-capabilities.ts`

### 8.6 Desktop metrics 与 `projectId`

当前 v2 Application 记录与 v1 对齐的低基数指标：

- `builtin_command_total{command=new,status=started|succeeded|failed}`
- `builtin_command_total{command=compact,status=started|succeeded|failed}`
- `session_lifecycle_total{action=create|delete|archive|unarchive|resume|abort,status=ok|error}`

`compressSession` 保持 v1 的 archive alias 语义，不额外伪装成 lifecycle action。metrics
sink 是纯诊断能力；sink 抛错会被隔离，不得把成功业务操作改成失败。

`createSession` 对 `projectId` 的当前规则：

- omitted 或 `0`：按本地 Session 创建；
- 非零值：在任何 Session side effect 和指标前返回 400 `VALIDATION_ERROR`，不静默忽略。

实现位置：

- `packages/local-runtime-v2/src/application/session/metrics.ts`
- `packages/local-runtime-v2/src/application/session/lifecycle-application.ts`
- `packages/local-runtime-v2/src/application/conversation/conversation-application.ts`

## 9. 符合预期的 v1 / v2 差异

以下差异是设计选择，不是迁移遗漏：

1. `resumeSession` 是 Session durable stream，不自动启动 Turn；只有显式 `drainQueued=true` 才 wake
   Queue。
2. v2 Queue 把 `queued` 与 `claimed` 分开。列表隐藏 claimed，但 exact `getQueueItem` 和 idempotency
   lookup 可以看到 claimed。
3. v2 stream 支持 durable catch-up、cursor 和 overflow/resync；不是 v1 的单个调用栈 SSE。
4. v2 Session query/search/filter 下推 SQLite，而不是在 Node 内做全量过滤。
5. Root replacement、Turn admission、Queue claim/ack 和 deletion 使用更强 transaction/fence。
6. Cron 使用 Definition / Run / Scheduler 状态机，旧 Cron API 稳定 501。
7. `getSidebarSessionTree` 和 `requestRotation` 在本地产品明确 unsupported。
8. v2 canonical history、display Message、stream 和 usage 是不同 projection，不重新合并成一个 v1
   store。
9. Channel transport/binding、Goal、Agent、Model credential、Permission、Diff 等可以继续由独立 v1
   product owner 提供，但不能重新取得 conversation ownership。

## 10. 明确接受的边界

### 10.1 graceful shutdown 不等待 Channel final reply

自然语言场景：

1. Agent 已经完成回答，数据库里的 Turn 和消息都已提交；
2. 系统开始把最终回复发送到微信或飞书；
3. 恰好此时用户退出 Desktop 或进程被关闭；
4. 外部平台请求可能来不及完成，所以最后一条 IM 回复可能没有送达；
5. 用户重新打开 Desktop 后，本地对话记录仍然完整，但系统不会自动重发这条 IM。

当前实现有意接受这个很窄的窗口。若要强保证，需要 durable
outbox、外部 receipt、重试和去重、以及 shutdown drain 协议；这会把 Channel
transport 的分布式投递状态引入 Turn settlement。当前收益不足以覆盖复杂度。

代码在 terminal product observer 处有明确注释和“永不 settle 的 observer 不阻塞 required
projection”的测试：

- `packages/local-runtime-v2/src/service/turn-system/agent-host/events/required-agent-event-delivery.ts`
- `packages/local-runtime-v2/src/service/turn-system/agent-host/events/required-agent-event-delivery.test.ts`

### 10.2 canonical history exact retry 只做进程内强保障

当前 v2：

- 单个 runtime 是同一 Session 的 writer；
- JSONL 是 canonical fact source；
- deterministic operation/revision 和进程内 replay registry 能收敛同一进程里的 callback retry；
- 文件写入和 replace 有自己的原子性/序列校验；
- 不承诺“写入成功、业务 receipt 未落盘、进程立刻崩溃”之后，在新进程内识别同一个语义operation 并保证绝不重复。

Cloud Runtime 的 `messages.jsonl` 也采用相近取舍：

- `MessageStore` 用内存 dirty pointer 保存待 flush tail；
- `OssRemoteMessageStore` 用进程内 position cache，并在 position mismatch 时 refresh 后重试；
- 上游约束同一 Session 不并发写；
- 没有为每个 message append 增加独立 durable operation receipt 或第二账本。

因此这个风险需要同时命中写入/receipt 之间的窄窗口和进程崩溃，属于低概率边界。当前不新增跨进程 semantic
receipt、projection watermark 或第二份 ledger；保持与 cloud 同级别的实现复杂度。

参考：

- `packages/local-runtime-v2/src/service/turn-system/agent-host/history/`
- `packages/local-runtime-v2/src/infra/file/canonical-history-jsonl.ts`
- `packages/cloud-runtime/src/messages/message-store.ts`
- `packages/cloud-runtime/src/messages/remote-message-store.ts`

## 11. 验证

最终交付要求覆盖以下层次：

| 层次         | 验证内容                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Contract     | thrift generator golden、generated types/routes、source IDL check                                         |
| Type         | `local-runtime-v2`、`local-runtime`、UI、thrift-gen typecheck                                             |
| Unit         | Channel error/typing、Session metrics/projectId、Queue single-item/exact lookup、Goal ownership/migration |
| Integration  | Session recovery、Queue repository、Session/Turn HTTP、runtime composition                                |
| Architecture | package architecture、service layout、dead code、duplication                                              |
| E2E          | Channel product path、Thread Goal product path、runtime startup                                           |

具体命令和最终结果在提交前由本轮验证写入 changelog/commit
trailers；本文只维护稳定的 review 结论，不记录容易失效的临时日志。

## 12. 最终判断

在本报告覆盖的所有迁移接口和内部 service 中，当前没有发现需要继续保留的实现 finding。

后续修改时应持续守住以下回归线：

1. startup recovery 只能收敛旧状态，不能顺手 dispatch Queue；
2. 所有 Queue source 永远一次只 claim 一条；
3. 非 `api` Queue item 不允许走 Desktop 编辑路径，避免覆盖 Channel routing provenance；
4. Goal attachment 的 source of truth 是 Goal，不是 UI draft 或 Queue；
5. Channel terminal error 和 typing 是 best-effort product side effect，不能改变 durable Turn
   outcome；
6. metrics/event publisher 失败不能回滚已提交业务；
7. v1 独立 domain 只能经 `RuntimeConversation` 使用 conversation state；
8. 新增 Desktop route 时必须重新核对 191-method ownership 表和 production allowlist。

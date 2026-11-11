# Session 存储迁移说明与后续计划

本文整理 [MR !4783](https://gitlab.xaminim.com/matrix/agent-archon/-/merge_requests/4783)
完成后关于 Session storage、Canonical History、Turn ingress、Dispatcher，以及 `session-system` /
`turn-system` 后续迁移的讨论结论。它用于补充
[`session-storage-migration.md`](./session-storage-migration.md)：后者描述已经落地的数据库迁移，本文件重点解释存储迁移与运行时业务迁移的边界，以及后续代码应该如何接入。

前置文档：

- [local-runtime-v2 Database 代码设计](https://vrfi1sk8a0.feishu.cn/wiki/TJTzwJpFji3TjjkwwQlcgDwznxg)
- [Session System：DB 与 JSONL 数据源逐表迁移审计](https://vrfi1sk8a0.feishu.cn/docx/XS8jdnBPQoeb5kxZWGccoQ2pnIh)

## 1. 当前完成度

当前分支已经完成：

- 全局 migration catalog 中的 version 4–6；
- Session、Project、FTS 和 Turn ingress 的数据库收敛；
- Canonical History JSONL 的 codec、source selection 和 durable file primitive；
- 最终 Session storage 的 Drizzle schema 与物理一致性校验；
- Phase 1 `session-system` DAO：Sessions、Projects、Messages/Assets、Queue、Usage、History
  checkpoint/readers、Legacy OpenCode readonly source/audit 的完整 persistence capability；
- 永久 package subpath `@mavis/local-runtime-v2/session-system`、cleanup ownership
  freeze，以及只在临时副本上运行的真实数据 Repository rehearsal。

当前分支尚未完成：

- Phase 2 `session-system` Query、Lifecycle、Recovery、readiness、history
  selection/lane/importer、Stream 等 application Service；
- `turn-system` 业务 service 接入；
- Session/Turn HTTP route 切流；
- profile/dataDir 到 `messages.jsonl` 路径的 owner 解析；
- per-Session writer lane；
- Canonical History 首次物化与 DB checkpoint 的业务编排；
- v1 `runTurnToStream` 到 v2 Turn owner 的完整切换。

因此，当前版本提供的是完整的 Phase 1 persistence boundary，不是完整的 Session/Turn production
cutover。Phase 1 Repository 只接受已经完成 migration 和 schema consistency 的 shared
`AppDb`；它不创建 connection、不执行 DDL，也不修改 `runtime.ts`、`services.ts`、HTTP/Electron
production wiring。

### 1.1 与 `feat/session_refactor` 的关系

本 MR 以 `feat/session_refactor`
的最终数据语义、业务约束和测试场景为主要参考，但不是整目录 cherry-pick，也不是对其 storage 实现的逐行复刻。

复用或保持一致的语义主要包括：

- Session columnar v3 模型，以及 status、kind、runtime、visibility 等规范化规则；
- worktree 到 canonical Project workspace 的映射；
- Project identity 合并、用户 preference、Session association 和 aggregate 规则；
- Session FTS document 与查询字段；
- Turn ingress receipt、dispatcher claim、accepted sequence 和 client request 幂等关系；
- Canonical History envelope、sequence 校验、首次懒物化和 source priority；
- `target -> ledger -> SQLite rows -> SQLite blob -> empty` 的单一权威来源选择。

实际实现必须以 `feat/local-runtime-v2-session` 的架构为准：

- 唯一 `DatabaseClient` 和共享 `AppDb`；
- 单一全局 migration catalog；
- `infra/db/schema/*` 作为 current Drizzle schema；
- 普通 runtime CRUD 使用 Drizzle；
- raw `better-sqlite3` 只用于 migration、backup、schema consistency 和 PRAGMA；
- `services.ts` 作为后续业务 service 的 Composition Root。

因此，不迁移 `feat/session_refactor` 中自行打开 SQLite connection、service 启动时建表、domain-local
migration catalog 和 `session-system/storage-owner.ts` 等旧 ownership。

| 范围                 | 来自 `feat/session_refactor` 的基线                        | 本 MR 的适配或新增                                                  |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Session DDL          | 表、列、索引、FTS、Project trigger 的最终形态              | 集中为 Drizzle schema，并由 0004 创建或接管                         |
| Session backfill     | legacy blob/v2/v3 转换、workspace、Project、FTS 规则       | 改为 0005 全局 migration transaction                                |
| Project 构建         | canonical identity、preference 和 aggregate 语义           | 确定性 alias 合并、历史 ID/sequence 高水位与 safe-integer 检查      |
| Turn ingress         | receipt、claim、sequence、client request、input descriptor | 改为 0006 启动迁移和严格冲突修复                                    |
| Canonical History    | envelope、source priority、append/replace/snapshot         | 抽成独立 path-based public primitive，并加强 credential/file safety |
| Session DAO          | 原分支已有完整 persistence 语义                            | 已按 shared `AppDb`、现有 schema 与 public package boundary 重写    |
| Session/Turn service | 原分支已有完整 system 设计                                 | 当前 MR 尚未迁移，后续按本文第 5.2 节接入                           |

主要额外增强如下。

#### 全局、全有或全无的 migration

`feat/session_refactor` 的 Session
backfill 按行提交，坏行保持 pending，最后通过 readiness 阻止 service 开放。0005 改成全局 migration
runner 中的单个 transaction：任一 Session、Project、FTS 或 postcondition 失败，0005 的全部写入和 version
marker 一起回滚。

目标分支原本已经具有 `DatabaseClient`、backup-before-pending-migration、migration runner 和 version
1–3；本 MR 不是重新实现这些基础设施，而是注册 version 4–6，使 Session storage 复用同一生命周期。

#### 精确物理契约

0004 在 additive create/adopt 之外，新增对以下内容的精确校验：

- column order/type/null/default/PK；
- CHECK 集合和 FK action；
- AUTOINCREMENT；
- index owner/order/direction/collation/predicate；
- trigger body；
- 完整 FTS definition。

已有物理对象不兼容时整体回滚，不通过 `CREATE IF NOT EXISTS` 或 `ALTER TABLE` 静默接受未知形态。

#### 确定性数据修复与 allocator 保护

0005/0006 额外处理：

- Project、FTS 和 Turn sequence 的历史 `sqlite_sequence` 高水位；
- Project/FTS/sequence 的 JavaScript safe-integer 边界；
- Project preference alias 的稳定合并顺序；
- orphan/stale sequence projection 的确定性重建；
- client request 跨 Session/Turn 冲突；
- dispatcher claim、receipt lifecycle 和 input JSON 的严格校验；
- migration 前后 Queue 与 lock 数据不变。

sequence 等内部 projection 可以按冻结规则修复；client request 等外部 durable
identity 发生冲突时必须 fail closed，不能使用 `INSERT OR IGNORE` 吞掉冲突。

#### Canonical History 文件安全

相比 `feat/session_refactor` 中嵌入 `session-system` 的 file
store，本 MR 将文件能力拆成不拥有 dataDir、DB、per-Session lane 或 checkpoint 的独立数据源，并新增：

- model credential-bearing key 的递归清理；
- 非有限数字、稀疏数组、循环引用、accessor 和非 plain object 拒绝；
- first publish/snapshot no-replace；
- staging 文件 `0600`、file fsync 和 best-effort directory fsync；
- Windows transient rename retry；
- append short-write recovery；
- 无法确认 append 是否提交时返回 `JsonlAppendCommitUncertainError`。

这些增强主要收紧迁移一致性、崩溃恢复和文件安全，不新增 Session 产品行为。完整 `session-system` /
`turn-system` 业务接管仍属于后续切片；当前生产 `runTurnToStream` 和旧 PI History
migration 路径仍由 v1 承担。

## 2. 三类迁移必须分开

后续讨论中的“Session 迁移”可能指三件不同的事情：

| 层级              | 执行时机                     | 处理内容                                                                 | Owner                                    |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| 数据库版本迁移    | runtime 启动、service 开放前 | 全库 schema、Session columns、Project、FTS、Turn ingress                 | `initializeDatabase` + migration catalog |
| 单 Session 懒迁移 | 第一次访问指定 Session       | Canonical History、legacy OpenCode、display/queue legacy payload         | `session-system` readiness/importer      |
| Turn 运行时接管   | 每次输入被接受和执行时       | admission、receipt、lock、dispatcher、Agent execution、terminal handling | `turn-system`                            |

判断逻辑是：

- 所有 Session 在列表、搜索或 Project 聚合中都必须满足的条件，放数据库版本迁移；
- 只有打开某个 Session 才需要准备的数据，放 per-Session 懒迁移；
- 一份输入如何成为 Turn、如何执行和结束，放 `turn-system`。

## 3. 启动时数据库迁移

启动顺序固定为：

```text
DatabaseClient 打开 runtime-state.sqlite
  -> 读取 migration history
  -> 有 pending version 时创建并校验 online backup
  -> 按版本顺序执行 0001 ... 0006
  -> 每个版本独立 BEGIN / COMMIT
  -> 执行最终 schema consistency check
  -> 创建业务 service
```

每个 version 只有在全部写入和 postcondition 成功后才写 marker。失败时该 version 整体回滚，修复源数据后可重试。

完整工作流：

```text
initializeOwnerRuntime
  -> new DatabaseClient(dataDir)
  -> 打开 runtime-state.sqlite
  -> 创建 rawDb
  -> 在 rawDb 上创建 AppDb 包装
  -> initializeDatabase(rawDb)
      -> 备份
      -> 执行 0001～0006
      -> schema consistency
  -> createBackgroundRuntime(AppDb)
  -> createRuntimeServices(AppDb)
  -> 各 Service 创建自己的 Repository
  -> ready
```

### 3.1 Version 0004：建立和接管物理结构

`create_session_storage` 只处理物理契约：

- 创建或兼容接管 Session、Project、display message、Queue、Preference、Usage 表；
- 创建 Session lock、Turn ingress、sequence 和 client request mapping；
- 创建“记录 PI History 文件迁移结果”的 DB checkpoint 表，以及 legacy Session import audit 表；
- 创建 Session/Project 索引、FTS 和 Project aggregate trigger；
- 对列顺序、类型、默认值、约束、FK、索引、trigger 和 FTS 定义做精确校验。

0004 不处理：

- `record_json` 业务解析；
- Session row backfill；
- Project 或 FTS 内容重建；
- Turn ingress 输入清理；
- Canonical History JSONL 发布；
- Session/Turn service 或 HTTP route。

如果发现不支持的旧物理结构，整个 0004 回滚，不根据列名或历史内容猜测业务语义。

### 3.2 Version 0005：全库 Session、Project 与 FTS 收敛

`backfill_session_storage` 是启动时全库 migration，不是按 Session 懒迁移。

它必须在 service 开放前处理所有 Session，因为即使用户没有打开某个 Session，以下功能也要求全库数据一致：

- Session list/search/tree；
- Project 下的 Session 数量；
- Project 最近活动时间；
- FTS 搜索、排序和分页；
- Session 到 Project 的 association。

Session 收敛规则：

- v0/v1：严格解析历史 `record_json`，生成 columnar v3；
- v2：以 typed columns 为主要输入，补齐 v3 字段；
- v3：typed columns 是事实源，过期 `record_json` 不能覆盖；
- 规范化 status、kind、runtime、type、visibility、workspace、时间戳和 `extra_data`；
- 无法解释的枚举、identity、JSON 或时间戳直接失败。

Project 收敛规则：

- 根据 canonical workspace 合并同一 Project；
- 合并旧 Project row、Session association 和 Project preference；
- 保留安全的历史 Project ID 与 SQLite sequence 高水位；
- 重算 `session_count` 和 `latest_activity_at_ms`；
- 恢复最终 Project trigger 和索引。

FTS 收敛规则：

- 删除 orphan key；
- 尽量保留无冲突的历史 rowid；
- 确定性分配缺失 key；
- 从最终 v3 Session columns 完整重建 FTS；
- 保证 allocator 仍位于 JavaScript safe integer 范围内。

0005 不负责 Canonical History、OpenCode import、Session recovery、消息懒加载或 Turn execution。

### 3.3 Version 0006：规范化 Turn ingress

`normalize_turn_ingress` 处理已经存在的 Turn 接收凭证：

- 规范化 input digest 和安全 metadata，并将旧 `input_json` scrub 为 `{}`；
- 修复 `accepted_sequence` 和 sequence projection；
- 保留历史 allocator 高水位；
- 规范化 `(session_id, client_request_id) -> turn_id` 幂等映射；
- 验证 dispatcher claim、Queue item identity 与 receipt lifecycle；
- 保证 Queue 和 lock 业务数据逐 byte 不变。

sequence 是内部可修复 projection；client request 是外部 durable
identity，发生冲突时不能猜测或重新生成。

## 4. 单 Session 懒迁移

下面这些逻辑不属于 0005，而属于 `session-system` 运行时 readiness。

### 4.1 Canonical History 首次物化

每个 Session 第一次读取 Agent history 或准备执行时：

```text
取得该 Session 的串行 lane
  -> 目标 messages.jsonl 已存在：直接读取，空文件也具有权威性
  -> 不存在：按固定优先级选择唯一 legacy source
  -> 转换为 canonical envelope
  -> 严格验证 identity、顺序、role、tool pairing、compaction boundary
  -> 原子 publishInitial
  -> strict read/revision 校验
  -> 写 DB migration checkpoint
```

固定 source priority：

```text
existing target
  -> authoritative ledger snapshot
  -> SQLite message rows
  -> SQLite message blob
  -> empty
```

选中的 source 失败时必须向上返回错误，不能降级到次优来源，也不能拼接多个来源。

文件发布必须先于 DB
checkpoint。若文件成功而 checkpoint 失败，重试时已有 target 是权威来源，校验后补写 checkpoint 即可。SQLite 与文件系统不能伪装成一个跨介质 transaction。

### 4.2 Legacy OpenCode Session import

旧 OpenCode Session 第一次进入 v2 read/execution readiness 时，由 `session-system/legacy-migration`
完成：

- Session identity 和 metadata import；
- display message import；
- Canonical History materialization；
- legacy migration audit/checkpoint；
- 可选 pinned/root 等 owner-specific participant。

Importer 必须是 per-Session、幂等、可重试的，不应在 runtime 启动时批量读取所有历史文件。

### 4.3 Display message 与 Queue legacy payload

如果保留 `session_refactor` 的产品语义：

- display message blob 到 row projection 在首次 Message access 时由 `messages` store 懒 backfill；
- Queue blob 到 row projection 在首次 Queue access 时由 `queue` store 懒 backfill；
- 只读 guard 先检查 legacy 数据是否合法，失败时不能写 marker 或删除源数据；
- 完成后 current writer 只写 row model，不长期双写 legacy blob。

这些 lazy backfill 的 persistence 必须使用共享
`AppDb`。如果未来决定改为全库启动迁移，则必须新增 version
`0007+`，不能把 service 内的隐式 DDL 当成 migration。

### 4.4 Session crash recovery 与 archived activation

Session `status` 是展示和 crash recovery 状态，不是实时 active owner。

- 遗留 `started` 且没有 active owner 的 Pi Session，在新的 Turn admission 成功后由
  `SessionRecoveryService` 收敛为 `interrupted`，再准备本次执行；
- `error`、`aborted`、`interrupted` 表示上一轮结果，不要求用户额外执行 Reset；
- archived Session 只有在本次用户输入已经取得 admission 后才 durable reopen；
- recovery 不自动重放上一轮输入，也不自动重试可能已经发生的 tool 副作用；
- `ResumeSession` 是只读 SSE reader，不触发状态恢复。

## 5. `session-system` 代码迁移原则

`feat/session_refactor` 可以作为业务语义、接口和测试参考，但不能整目录原样 cherry-pick。

目标分支的实现 SoT 是：

- 唯一 `DatabaseClient`；
- 唯一共享 `AppDb`；
- `infra/db/schema/*` 是 current Drizzle schema；
- `infra/db/migrations.ts` 是唯一 migration catalog；
- `services.ts` 是业务 service Composition Root；
- 普通 runtime CRUD 使用 Drizzle；
- raw `better-sqlite3` 仅用于 migration、backup、schema consistency 和 PRAGMA。

### 5.1 不能原样迁移的代码

| `session_refactor` 旧实现            | 目标分支处理                               |
| ------------------------------------ | ------------------------------------------ |
| `session-system/storage-owner.ts`    | 不迁移；使用现有 `DatabaseClient`/`AppDb`  |
| 各 domain 自行打开 SQLite connection | 改成构造参数注入 `AppDb`                   |
| service 启动时自行建表               | 删除；物理结构由 versioned migration 管理  |
| `ensureSessionsColumnarSchema`       | 已由 0004 替代                             |
| `runSessionsBackfill`                | 已由 0005 替代                             |
| 旧 ingress schema/init SQL           | 已由 0004/0006 替代                        |
| 旧 file history store                | 适配当前 `CanonicalHistoryJsonlDataSource` |
| service-local migration catalog      | 删除；新增变化必须使用全局 0007+           |

迁移的是业务行为、公开 capability、错误语义和测试；持久化与启动 wiring 要按照目标分支重写。

### 5.2 推荐迁移阶段

#### Phase 1：DAO / persistence（本 MR 已完成）

- 迁移 Session types、normalization、serialization、pagination 与完整 Repository contract；
- 使用已经初始化完成的 shared `AppDb`
  重写 Sessions、Projects、Messages/Assets、Queue、Usage、History checkpoint/readers 和 Legacy
  migration audit；
- 将现有 `CanonicalHistoryJsonlDataSource` 包装为 path-only adapter，不复制 file primitive；
- 将 Legacy OpenCode external DB 隔离为只接受显式候选文件的 readonly infra
  source，并实现完整 Session/Message/native/Agent/manifest contract；
- 冻结 public package export、cleanup ownership、无绑定 handle 与无导入副作用边界；
- 通过 fixture/integration、architecture、package freeze 和真实数据 rehearsal 验证；
- 不创建 application Service，不修改 production composition、route allowlist 或 Electron wiring。

#### Phase 2：Application Service（后续独立 MR）

- 在公开 Repository contract 上实现 Session Query、Lifecycle、Recovery 和 readiness；
- 编排 Root Session、Project association 与各 owner 的窄 cleanup participant；
- 编排 display/queue legacy readiness、Canonical History source selection、首次物化、revision
  checkpoint 与 per-Session lane；
- 实现 archived activation、状态 writer、startup claim recovery、Stream、Usage/Files 查询和 Legacy
  importer；
- 在 shared database 初始化完成后由 `services.ts` composition root 注入 Repository 与 path/source
  capability；
- Service 行为完成并验证后，再以独立切片执行 shadow compare 与 route cutover。

#### T1：Turn admission 和 ingress

- 实现 `TurnAdmissionStore` 和 persistent Session lock；
- 使用共享 `AppDb` 实现 `IngressReceiptStore`；
- 实现 direct/dispatcher identity 和 sequence allocation；
- 实现 stale receipt/lock recovery。

#### T2：Dispatcher、TurnController 和 execution

当前具体接入顺序、owner 边界、commit 切分与验证矩阵见
[AgentHost / SessionSystem / TurnSystem 接入实施计划](agent-host-session-turn-integration-plan.md)；该计划覆盖并替代本节的泛化描述。

- 迁移 Dispatcher、TurnController、ExecutionCoordinator；
- 迁移 AgentHost 的 canonical history read/write；
- 迁移 Agent event 到 Session/message/stream projection；
- 迁移 ordinary steering、abort、compaction、Queue single-item dispatch 和 release retry；v2
  execution 不保留 rotation profile。

#### T3：生产切流

建议 route 顺序：

```text
Session query
  -> Session lifecycle
  -> Messages
  -> Queue
  -> ResumeSession
  -> sendMessage/abort
  -> compaction
```

每个 route 进入 allowlist 前必须满足：

- v2 已经是该事实的唯一 writer；
- route 不再调用 v1 同类业务实现；
- lazy migration、并发和 crash recovery 有测试；
- HTTP controller 只做 generated contract mapping；
- 未迁移 domain 才能由 gateway fallthrough 到 v1。

### 5.3 目标依赖方向

```text
DatabaseClient / AppDb
  -> session-system Repository
       -> sessions / projects
       -> messages / assets
       -> queue / usage
       -> history checkpoints/readers
       -> legacy migration audit
CanonicalHistoryJsonlDataSource -> path-only history adapter
explicit external candidate -> readonly Legacy OpenCode infra source
  -> session-system Application Service
       -> query / lifecycle / recovery / readiness
       -> history selection / lane / importer / stream
  -> turn-system
       -> admission/ingress
       -> dispatcher/controller
       -> AgentHost/coordinator
  -> HTTP controllers
```

约束：

- `turn-system` 只依赖 `session-system` 公开 capability，不 deep import DAO；
- `session-system` 不反向 import `turn-system`；
- 新消息只能经 `TurnService.submit(allowQueue=true)` 进入 Queue；TurnSystem 在 durable
  commit 后立即唤醒 Dispatcher，外部不再持有 enqueue + wake 两段式 callback；
- HTTP 不判断 busy、Queue、status transition 或 recovery 策略；
- gateway/DesktopService glue 不成为 domain router。

## 6. 后续数据库 migration 规则

0004、0005、0006 一旦发布即冻结。未来字段或数据语义发生变化时：

1. 新增 0007、0008……；
2. 注册到全局 `ALL_MIGRATIONS`，保持连续、唯一、严格递增；
3. current Drizzle schema 与 migration 同步更新；
4. migration 使用冻结、self-contained 的 SQL/codec/转换规则；
5. 不从当前 service schema、mutable helper 或 production enum 导入历史规则；
6. 每个 version 独立 transaction，成功后才写 marker；
7. 覆盖 fresh、supported legacy、bad data、rollback、repair/retry 和 schema consistency。

如果一个变化只在某个 Session 首次访问时有意义，优先实现为显式、幂等的 lazy
readiness；如果它改变所有数据库都必须满足的查询或完整性条件，则使用新的全局 migration。

## 7. 验证重点

### 数据库 migration

- fresh 0001→最新版本；
- 支持的 legacy schema/data；
- 不兼容 schema fail closed；
- bad Session/Project/FTS/ingress 整体回滚；
- 修复源数据后重试；
- allocator safe integer 边界；
- 最终 schema consistency。

### 单 Session 懒迁移

- target 已存在，包括 authoritative empty file；
- ledger、rows、blob 和 empty source priority；
- 选中来源损坏后不 fallback；
- 同一 Session 并发首次打开；
- 文件成功但 DB checkpoint 失败后的收敛；
- legacy source 只读保留；
- credential 不进入 Canonical History。

### Turn 与 Dispatcher

- direct client request 幂等；
- dispatcher exact claim handoff；
- receipt commit 与 Queue ack 之间崩溃；
- Queue claim 未接受时 release；
- sequence 高水位与唯一性；
- stale lock/release-pending recovery；
- terminal 先于 Queue ack 和 Queue ack 先于 terminal；
- JSONL commit-uncertain 不盲目重试；
- Session delete 显式清理 receipt/sequence。

## 8. 结论速记

```text
0004：建立和验证物理结构
0005：启动时全库收敛 Session、Project、FTS
0006：规范化 Turn acceptance receipt、sequence 和 client identity

首次打开才执行：Canonical History、legacy OpenCode、display/queue readiness
输入如何被接受和执行：turn-system
Queue 如何交给 Turn：Dispatcher + ingress receipt
后续代码迁移：复用 session_refactor 的行为与测试，按当前 AppDb/migration 架构重写 persistence/wiring
Phase 1 DAO：已完成，未接入 production composition
Phase 2 Service：后续独立 MR，在公开 Repository contract 上实现
```

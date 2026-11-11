# Session Storage Migration

本文描述 local-runtime-v2 的 Session storage migration 与 owner 边界。Session domain
capability 可以使用迁移后的 `AppDb`/Drizzle DAO；application、Turn workflow、HTTP
route、profile/dataDir 解析、Dispatcher 与 production wiring 不在本切片中。

关于启动时全库迁移与按 Session 懒迁移的区别、Turn ingress/Dispatcher 存储语义，以及后续
`session-system` / `turn-system` 接管步骤，见
[`session-system-migration-guide.md`](./session-system-migration-guide.md)。

## Ownership 与执行边界

- `DatabaseClient` 仍拥有唯一 `runtime-state.sqlite` connection 与共享 `AppDb`。
- `infra/db/migrations.ts` 静态维护全量 migration
  catalog；每个 version 由全局 runner 在独立 transaction 内执行，失败时不提交 version marker。
- migration 可以在同一 raw SQLite
  connection 上执行冻结、参数化的数据转换；运行期 CRUD 必须通过 Drizzle schema/service。
- 历史 migration 不依赖当前 Drizzle schema、service 常量或可变 production helper。migration-local
  codec、SQL 与 path 规则一经发布即冻结。
- DB migration 只收敛数据库事实。Canonical History JSONL 发布由未来 Session owner 使用独立
  `canonical-history` 子路径编排，不能在 SQLite transaction 内伪装成同一原子提交。

### 显式 Test 构建的迁移隔离

精确 `NEXT_PUBLIC_BUILD_ENV=test` 且构建时显式设置
`MAVIS_LOCAL_RUNTIME_ISOLATION=true` 的 Electron 启动在创建 utility
runtime 之前，先从默认 dataDir 构建一个受管副本，并把 `MINIMAX_DATA_DIR`
切到该副本。首次启动执行完整复制，后续启动复用已完成的副本；所以本文件描述的 m1→m11
migration、backup、repair 与运行期写入都不会修改源 dataDir。

副本同时以 `quarantined` cold-start
policy 启动：Scheduler 会载入持久化 job 供查询、取消或后续交互式 reschedule，但不会为复制来的 job 恢复 timer；Cron
service 不恢复复制来的 pending run。v1 compatibility host 也不会自动执行复制来的 Cron、启动 Channel
inbound loop，或恢复 Questionnaire、Thread Goal 与 built-in greeting。Channel outbound
client 仍会按复制的绑定注册；新建任务、手动触发和启动后的正常交互不受影响。

普通 test 构建不包含 isolation 标记，继续使用源 dataDir 与正常 cold-start policy；`dev`、
`staging`、`prod` 与未设置 build env 的启动也不启用该复制策略。该能力没有 UI 或 runtime
开关。受管副本的具体路径、构建命令、排除项、并发指纹与 symlink 规则见
`/openwiki/data-and-domains/local-state.md` 的 “显式 Test 构建 dataDir 隔离”。

## Version 5：Plugin 状态接管

`adopt_plugin_state` 接管早期 Plugin service 自建状态表并删除其私有 migration
marker。该已发布 version 保持冻结；Session storage 从后续 version 6 开始收敛。

## Version 6：物理契约

`create_session_storage` 创建或兼容接管 Session、Project、message
projection、queue、preference、usage、turn ingress/sequence/client mapping、lock、legacy
audit、FTS、index 与 Project aggregate trigger。

version 6 不回填 Session row、不清空 ingress input、不重建 Project/FTS，也不创建 owner
ledger。对已存在对象按列顺序/type/null/default/PK、精确 CHECK 集、FK action、AUTOINCREMENT、index
owner/order/ direction/collation/predicate、trigger body 与完整 FTS
definition 做后置校验；不兼容对象导致整个 version 回滚。旧 11-column Project 表只允许作为 version
6 前的明确 transitional shape。

## Version 7：Session、Project 与 FTS 收敛

`backfill_session_storage` 按稳定顺序处理 legacy Session：

- v0 从严格 `record_json` 解析并写入 columnar v3；
- v2 补齐 v3 字段；
- v3 以 typed columns 为事实源，不让 stale blob 覆盖现值；
- status/kind/runtime/type/visibility、identity、时间戳、extra-data allowlist 与跨平台 workspace
  path 均 fail closed 或按冻结规则规范化；
- workspace worktree marker 只识别 `.worktrees`、`.worktree` 与受支持的 nested agent worktree
  layout，不能把 `.codex/worktrees` 等普通工具数据目录截断成错误 Project identity；
- 重建 Project，合并 canonical workspace；同一 canonical Project 的多条 legacy
  preference 先按稳定 key 顺序逐字段 last-defined-wins，缺失或 `null`
  不清掉其它 alias 已提供的字段，显式 `false` / `0` 仍覆盖；合并后的稀疏 preference 是完整 B
  user-state projection，最终未提供字段按 B 语义写入 `false` / 默认顺序 /
  `null`，而不是对 transitional H Project 做 patch；随后重连 Session
  association，并由 trigger/aggregate postcondition 校验计数和时间；
- 清理 FTS orphan/key 后从最终 Session projection 完整重建；FTS key 与 `sqlite_sequence`
  必须保留 JavaScript safe integer 的未来分配空间。

任一行无效、合并冲突或 postcondition 失败会回滚 Session、Project、association、FTS 与 version
marker；修复源数据后可重试。

## Version 8：Turn ingress 收敛

`normalize_turn_ingress` 按 SQLite rowid 稳定处理 ingress receipt：

- sequence mapping 是可修复 projection；只保留 positive safe integer、全局唯一且与同 turn
  mapping 相容的主表值，其余按确定性顺序重建；
- sequence allocator 刻意不对 receipt 建外键：正式 accept 顺序是在同一 transaction 内先分配 sequence
  row、再写 receipt，生命周期 owner 在 GC / Session delete 时显式一并清理；version
  7 负责修复既有孤儿 projection 并保留历史高水位；
- 新 sequence 严格高于主表、mapping 与 `sqlite_sequence` 的历史高水位，后续 allocation 保持单调；
- client request 是外部 durable identity，primary mapping 使用 ordinal
  0；跨 session/turn 冲突不猜测、直接失败；
- `input_json` 必须是 plain JSON
  object，递归稳定排序后计算 SHA-256 与精确 metadata，核对已有 digest/ metadata 后将 payload
  scrub 为 `{}`；
- queue 与 lock 表逐 byte 不变。

`m0006` 的兼容接管只补齐物理结构，不代表既有 row 已通过语义校验。来源实现历史上只写入
`send | dispatcher | compaction | rotation`；`m0008` 将其它值（包括
`user`）视为坏 source。坏 source/status/claim、非 canonical
identity、digest/metadata 冲突或 mapping 冲突均触发全 version 回滚，不根据字符串含义猜测映射。

## Version 9：Session-system 查询索引

`session_query_indexes` 为 Queue row 增加 source、client request、dedupe、expiry、claim 与 routing
projection，并从冻结的 `data_json` 回填；同时增加 Queue FIFO/routing、Usage model/UTC-day 与 Message
asset latest-occurrence 查询所需 B-tree/expression index。坏 Queue
JSON 或 projection 失败会让完整 version 回滚。

## Version 10：Queue sole-input 收敛

`converge_session_queue` 在同一个 runner transaction 内读取 `local_runtime_queues` legacy
blob 与当前 `local_runtime_queue_items`：legacy slot 在前，current 同 `itemId`
覆盖原 slot，其余 current row 追加； `running` 归一为 `queued`，terminal row 丢弃，并 scrub Turn
lifecycle 字段。source、message、model、channel、client request、dedupe、expiry 与有效 claim 保留。

每个 Session 重写 row projection、写幂等 readiness marker 后才删除 legacy
blob。局部坏 blob/item/current row（JSON、identity、active status/source 或字段契约错误）写入
`local_runtime_queue_migration_quarantine` 并跳过，其余有效记录继续迁移；terminal
row 仍按契约正常淘汰。数据库结构或 postcondition 等非局部失败会连同 version
marker 整体回滚。m0010 提交后运行期只读取 `local_runtime_queue_items`；`local_runtime_queues`
不再是 lazy readiness 输入。expiry harvest 使用
`idx_local_runtime_queue_items_session_status_expiry_id(session_id,status,id,expires_at_ms)`，同时保持 FIFO
fact 顺序并避免 `USE TEMP B-TREE`。

## Version 11：File API upload cache

`create_file_api_upload_cache` 新增 Session-scoped 引用缓存和 expiry
index。它只持久化媒体、endpoint、caller 与 TTL 的摘要及裸
`fileId`，不保存原媒体、endpoint 或凭证；Session 删除通过 FK cascade 清理。

## 验证要求

至少覆盖 fresh m1→m11、legacy transitional adoption、每个版本的失败回滚与修复重试、完整
`assertDatabaseSchemaConsistent`、production-only dead-code、migration registry
architecture、真实 DatabaseClient 初始化/重启和 Electron utility-runtime owner path。只跑 migration
unit tests 不足以作为 MR ready 证据。

### 本地真实数据 rehearsal

真实数据自测是显式 opt-in，不进入默认 package test。运行前必须：

- 完全停止使用该 dataDir 的 Electron/local-runtime；
- 使用迁移前副本：允许没有 v2 migration marker 的 legacy v1 数据，或
  `local_runtime_v2_schema_migrations` 精确为 versions 1–4 / 1–5；其它 history fail closed；
- 确认 `<dataDir>/v2/sqlite/runtime-state.sqlite` 存在；
- 传入绝对路径，不使用默认 profile 或端口。

Component rehearsal：

```bash
MAVIS_REHEARSAL_SOURCE_DATA_DIR=/absolute/pre-migration/data-dir \
  pnpm --filter @mavis/local-runtime-v2 test:rehearsal:session-storage
```

Electron production-owner E2E：

```bash
MAVIS_REHEARSAL_SOURCE_DATA_DIR=/absolute/pre-migration/data-dir \
  pnpm --filter @mmx-agent/electron test:e2e:session-storage-real-data-rehearsal
```

两个命令都先对 DB/WAL/SHM 做前后稳定指纹，在系统临时目录复制文件，再只对副本执行 SQLite online
backup 和 migration；不会把源 dataDir 交给 Electron，也不会复制 auth/config/附件。成功报告只包含版本、行数、DB/WAL/SHM 指纹和 SHA-256
logical digest。失败报告只包含 invariant code、表名、计数和哈希行标识，不输出业务 ID、Session
record、Turn input、workspace 或源绝对路径。文件和 logical
digest 都流式计算，超大 Session/Turn 选择集不会展开成 SQLite bind 参数。

Component rehearsal 使用两个独立 clone：markerless legacy
v1 先运行 m0001→m0004，并确认全部 pre-existing
table 未变化；随后逐步运行 m0005→m0006→m0007→m0008→m0009→m0010→m0011，并在每一步执行代码 invariant。另一个 clone 调用生产
`initializeDatabase()` 验证 migration backup、最终状态、重开和二次初始化幂等。Electron
E2E 使用第三个 clone，通过 production utility owner 连续完成两次冷启动、v2 ping 和 graceful
stop，并确认第二次不新增 backup。跨启动摘要只冻结源 Session 的 columnar migration
fields、Turn 和 Project stable fields；legacy runtime 的 root-session dedup 可以更新
`record_json/updated_at_ms`，但这两个字段在 m0006 完成时仍由 component
verifier 逐行精确核对保真。每次启动仍会对全库 Project
aggregate 独立重算，因此 runtime 在同一 Project 创建正常 root Session 不会造成误报。

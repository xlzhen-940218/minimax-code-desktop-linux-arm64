# Scheduler Infra Refactor 测试场景

## 测试 seam

- Scheduler lifecycle：`background-runtime.ts` 独占 concrete Scheduler 的 `start` / `stop`。
- `SchedulerClient`：service 可使用 `registerHandler`、`schedule`、`get`、`inspect`、`reschedule`、
  `cancel`、`remove`，但看不到生命周期方法。
- host lifecycle：显式 Electron owner 的 ready / close / startup failure。
- database baseline：空 dataDir 上的 migration 结果与 schema constraint。

测试使用真实临时 SQLite、真实 migration 与真实 Croner。时间和随机值可以注入；不 mock
Scheduler 内部 query 或 timer adapter。

## 固定语义

- Scheduler 接收共享 `AppDb`，不创建、不 migration、不关闭 connection。
- 每个进程只创建一个共享 Scheduler；所有 service 注册 handler 后由 background runtime 统一启动。
- `services.ts` 组装业务 service；service 只能借用 `SchedulerClient`，不能控制共享 infra 生命周期。
- `schedule` 只在启动后接受已注册 handler；once 必须严格晚于当前时间。
- 触发先持久化，再调用 handler；handler 失败不回滚、不自动重试。
- `reschedule` 保留 ID、重置 `runCount`，并可从任何终态重新激活。
- `cancel` 是 logical cancel；unknown 与重复 cancel 均为 no-op。
- 重启不补跑 missed tick；过期 once 写 `expired`，recurring 只计算严格未来时间。
- quarantine 不挂载恢复 timer，但会在冷启动和读取时把 recurring 的 `nextRunAtMs`
  刷新为严格未来时间，保证列表不展示已错过的执行点。
- `inspect` 以数据库 row 为返回事实，只读比较 owner Map；DB-only、Map-only 与字段分叉写入一致性
  metric，读取过程不发布 job、不挂载 timer。
- stale timer 由内存 timer identity 隔离，不引入 revision/CAS。

## 场景矩阵

| ID  | 场景               | 期望                                                                                                      |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| S1  | handler lifecycle  | 空 key、重复注册、start 后注册、start 前 schedule、未知 handler 均失败且不写 row。                        |
| S2  | schedule commit    | 先准备 paused timer，再写 row；写库失败时停止候选 timer，不留下 callback。                                |
| S3  | trigger ordering   | handler 进入时 row 已提交新的 `runCount/state/nextRunAtMs`；写库失败时 handler 不执行。                   |
| S4  | once / maxRuns     | once 触发一次后 completed；cron 到达 maxRuns 后 completed 且不再触发。                                    |
| S5  | reschedule         | active/completed/expired/cancelled 均保留 ID、清零 runCount、只让新 timer 生效；写库失败保留旧 timer。    |
| S6  | logical cancel     | 已存在 row 变为 cancelled 且停止 timer；unknown/重复调用无副作用；写库失败保留 timer。                    |
| S7  | restart recovery   | 只恢复 active job；missed once expired；recurring 不补跑；terminal job 不建 timer。                       |
| S8  | restore isolation  | quarantine 不挂载 timer，但会在恢复和读取时刷新 recurring 的未来执行时间；坏 schedule 隔离为 skipped。    |
| S9  | callback isolation | throw/reject 只记录 failure metric；recurring 继续下一正常 tick；同 job 不重叠。                          |
| S10 | read consistency   | `inspect` 返回持久化 row；overdue recurring 只计算并返回未来下一点，且不写数据库、不改变 owner Map 或 timer。 |
| D1  | fresh baseline     | 创建 schema migration、Scheduler jobs、Cron definitions/runs；不存在 registrations 与旧 Scheduler table。 |
| D2  | schema ownership   | Cron Definition 的 schedulerId 是 unique opaque identity，不存在 Scheduler foreign key。                  |
| H1  | process gate       | 只有 `electron + electronHost` 执行 migration 并启动 Scheduler consumer。                                 |
| H2  | cleanup            | 正常 close 共享幂等 promise，按 background infra → services → DatabaseClient → v1 host；启动失败沿用相同 dependency-safe 顺序 best-effort cleanup。 |
| E1  | Cron service       | Definition list/get 通过 `inspect` 读取持久化 job；mutation 与 callback 通过 owner Map 完成。              |
| A1  | architecture       | `runtime.ts` 不依赖具体 service / Scheduler；background 只管理长驻 infra，`services.ts` 组装 Cron；Cron 只依赖 `SchedulerClient`。 |

## 当前门禁

layout gate 检查 `infra/db/schema/`。Cron persistence architecture test 禁止 Cron service 使用 raw
SQLite CRUD，固定 `AppDb -> BackgroundRuntime(shared Scheduler) -> RuntimeServices -> Cron(borrowed SchedulerClient)`
ownership，并检查运行时路径无 marker migration policy。

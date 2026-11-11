# AGENTS.md — local-runtime-v2 rules

本文件适用于 `packages/local-runtime-v2/**`，并与仓库根 `AGENTS.md` 叠加。

## Composition

- `src/runtime.ts` 只编排固定阶段：初始化 v1 compat、DB、background infra、business services、delivery。
  不得在这里定义或装配某个 service 专属的 ports、error code、recovery 或 lifecycle。
  它只能直接依赖 `infra/db/client.ts`、`infra/db/initialize.ts`、`http/app.ts` 与 `local/app.ts`，其他
  infra / delivery implementation 必须隐藏在更窄的 composition root 后；HTTP 与 process-local
  delivery 是平级边界。
- package facade 的 host factory 只有 `options` 一个参数；component override 只允许 direct-module test seam，
  不得从 `src/index.ts` 导出或让生产调用方注入 DB path、service ports、HTTP hooks。
- `src/background-runtime.ts` 只拥有长驻基础设施的实例与生命周期。当前实例是共享 `Scheduler` 与
  live-only `EventBus`；未来同类 infra 也在这里组装。它不得 import `service`、`compat` 或 `http`。
- `src/services.ts` 是业务 service / Application composition root。新增 Cron、Session 等 service 时修改
  这里和对应的 `src/service/<name>/`，不得给 `runtime.ts` 增加 service-specific wiring。它不得 import
  HTTP 或 process-local delivery，也只能 type-import infra capability 与 aggregate v1 compatibility，不能创建
  infra 或 compatibility value。Session Applications 只有在 TurnHost、Queue recovery/Dispatcher、
  archive-title/cleanup 等 required ports 全部显式提供后才能整体暴露；禁止 noop、v1 fallback 或
  test-only production branch。
- `src/service/<name>/` 必须封装业务规则、状态或生命周期。若删除它只会少一次参数或方法转发，应由现有
  composition root 直接接线；不得为目录对称或“未来可能复用”新增 pass-through service / facade。
- 业务 service 只能借用 `SchedulerClient` 等不含生命周期的 capability；禁止 import concrete
  `Scheduler`，也禁止调用共享 infra 的 `start()` / `stop()`。
- 固定启动顺序是：创建 services 并注册 handler → `BackgroundRuntime.start()` →
  `RuntimeServices.ready()` → HTTP → 后台启动恢复（`startStartupRecovery()`）。ready 只做装配与本地对账，
  执行上次遗留工作的步骤只能放进启动恢复，不得重新放回 ready。关闭顺序先停 background infra，再逆序
  drain services。
- `compat/v1/runtime.ts` 聚合跨代 reference slice，`compat/v1/cron.ts` 保存 Cron-specific adapter，
  `compat/v1/session.ts` 只保存 Session Scope-A capability。
  `runtime.ts` / `services.ts` 只能 import aggregate `compat/v1/runtime.ts`，不得绕过它直连某个
  service-specific compat leaf。业务 service 实现不得直接依赖 compat；v1 能力只能经 composition root 注入。
- service `ready()` 失败不得自行 close：runtime 必须先停止 background infra，再 drain services，避免新
  trigger 进入已关闭的 service。startup rollback 使用同一 dependency-safe 顺序，不按构造顺序机械倒放。
- Scheduler handler 只做同步 admission（持久化/入队）并立即返回；service 自己跟踪和 drain 已接纳工作。
  `Scheduler.stop()` 只停止新 timer，不等待任意 async callback。需要通用 drain 语义时另行扩展 infra，
  不得假设当前 `BackgroundRuntime.close()` 已等待 handler 完成。
- 不为未来 service 预建通用 registry、Dispatcher 或 lifecycle framework。`infra/event-bus` 只保留当前
  Global Events 所需的泛型同步 fan-out / subscribe / close，不得加入 event catalog、filter、replay、HTTP
  或 Session 语义；新的业务事件能力仍优先扩展上述三个显式 composition files。
- `src/application/` 只编排跨 capability workflow、stable application error、generated wire mapping 与
  committed-fact public event projection。它不得 import Hono、HTTP / process-local delivery、concrete
  EventBus、concrete compat store 或 `runtime.ts`，也不得创建单一 `SessionApplication` 聚合转发层。
- Session / Project controller 只把 generated context/request 委托给具名 Application；不得直接 import
  Session System、Project、Queue service 或复制 mapping/error/workflow。34 个方法只有在
  `RuntimeApplications` 完整存在时原子进入 allowlist；Turn-owned Session 方法保持 target baseline。
  `updateProject` 支持由 ProjectApplication 校验的名称与图标 metadata 更新，二者可单独或一次提交；
  归档等字段不在此入口开放。
- Application producer 只能从已经提交的 fact 投影 `GlobalEventInput`。publish 为 commit 后
  best-effort，失败不得回滚业务状态；required participant 必须在 commit 前完成，不能伪装成 event
  subscriber。
- 修改这些边界必须同步运行 package `check:architecture`、`test:architecture` 与根目录
  `scripts/test/local-runtime-layout-check.test.mjs`；禁止通过放宽门禁绕过 ownership。

## Service Layout

- 每个 `src/service/<name>/` 根目录必须包含只做 re-export 的 `index.ts`、纯契约
  `contracts.ts` 和装配入口 `initialize.ts`。Service 外部的生产代码只从 `index.ts` 导入。
- `contracts.ts` / `errors.ts` 保存无 I/O、无可变状态的契约和稳定错误；
  `*.service.ts` / `lifecycle.ts` / `executor.ts` 保存业务编排；
  `*.repository.ts` / `*.adapter.ts` / `*.client.ts` 保存外部绑定；
  `initialize.ts` 与按需存在的 `composition.ts` 负责装配。
- 同一职责的直属生产文件达到 3 个时收进命名明确的子目录；2 个以内保持平铺。单目录直属
  生产 TypeScript 上限为 10，`*.test.ts` 与 `index.ts` 不计入职责分组数量。
- 任意 `index.ts` 都只做 re-export。默认测试继续与被测源文件保持同名 sibling；Agent capability
  的 unit tests 使用 `test/unit/agent/<same-relative-path>.test.ts` 镜像模式，compat/infra 的包级
  unit tests 分别使用 `test/unit/compat/<same-relative-path>.test.ts` 与
  `test/unit/infra/<same-relative-path>.test.ts`。三类测试每个生产源只能有一个镜像测试，且必须
  直接 import 对应源文件（由 dependency-cruiser 语义门禁验证）；`src/service/agent/` 内禁止放置
  `*.test.ts`。
- 一次性迁移或 backfill 使用 `_migration-*`，Demo、PoC 和实验代码使用 `_demo-*` 或进入
  生产构建明确排除的 `__dev__/`。即将删除的兼容层添加 `@deprecated` 并写明删除条件。
- 完整规则和理由见 `.harness/docs/adr/local-runtime-v2-service-layout.md`。

## Persistence

- 修改 persistence 前先阅读 `.harness/docs/design/db/v2-db-architecture.md` 与
  `.harness/docs/adr/local-runtime-v2-migration-ownership.md`。
- Drizzle table schema 只定义在 `src/infra/db/schema/`。
- Service 可以使用注入的 `AppDb`、集中 schema 与 Drizzle query builder / expression fragment；禁止访问
  raw SQLite handle 或执行完整 raw SQL statement。
- 不得仅为隐藏 Drizzle 新增单实现的 pass-through Repository / Store；只有它承载业务不变量或存在真实的
  第二个 adapter 时才引入 seam。
- connection、backup、PRAGMA、migration runner 与 schema consistency 只属于 `infra/db`。
- Migration 使用 runner 提供的 connection 与 transaction，不依赖 service 或当前 schema。Migration 可以
  使用冻结的完整 raw SQL；来自数据的值必须使用 bind parameter，禁止字符串插值，DDL 与 identifier 明写在
  migration 中。所有 migration 显式注册到 `ALL_MIGRATIONS`，已发布 migration 不原地修改。
- DB 改动至少运行 package `lint`、`check:architecture`、`test:architecture` 与受影响的 integration tests。

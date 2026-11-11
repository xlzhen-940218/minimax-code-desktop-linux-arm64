# IM 迁移台账（MR1：冻结契约并准备 V2 模块）

> 分支 `feat/local-runtime-v2-im-migration`，基于 `origin/preview_train` @ `6fd5d899e82b`。
> 方案：`local-runtime-v2-im-migration-2026-09-16.md` §10 MR1。
> 本文件记录 MR1 交付要求中的「每个剩余 V1 import 的用途」、不迁清单与行为微调，
> 供 MR2（切换唯一生产 owner）/ MR3（delivery 接管并删除旧实现）对账。

## 1. 范围与结果

- V1 `packages/local-runtime/src/channels/**` 及 api 层 IM 附属按方案 §4 复制改造到
  `packages/local-runtime-v2/src/service/channel-system/`，V1 包**零改动**。
- V2 副本**未接线生产**：runtime.ts / services.ts / http/app.ts / compat 均未修改；
  生效 owner 仍是 V1，MR2 整体切换（关键存储副本文件头已注明）。
- 五条静态门禁全绿：typecheck / lint / check:architecture / test:architecture /
  layout checker；新增迁移测试 4 文件 51 用例全过（见 §6）。

## 2. 目录映射（V1 → V2 channel-system）

| V1 | V2 |
|---|---|
| `channels/infra.ts` 契约区 + messages/receipts 类型 | `channel-contracts.ts` |
| `channels/infra.ts` hub 类（882–1802 行） | `ingress/channel-bridge-infra.ts`（+ `ingress/channel-inbound-helpers.ts`） |
| `channels/infra.ts` options 区 | `channel-infra-options.ts` |
| `channels/{durable-yaml,owner-store,agent-channel-config}.ts` | `binding/storage/` |
| `channels/im-connection-store*.ts`（9 文件族） | `binding/connection-store/` |
| `channels/{legacy-binding-store 等绑定规则}` | `binding/` |
| `channels/access-control*` | `access-control/`（去 HTTP re-export） |
| `channels/route-api.ts` service 半部 | `routing/route-rules.ts` |
| `channels/{rootless,channel}-route-*.ts` | `routing/` |
| `channels/legacy-im-migration*.ts`、`primary-agent-*.ts` | `migration/` |
| `channels/{runner,adapter,adapter-registry,envelope,channel-inbound-utils,channel-lane-queue}.ts` | `ingress/`（媒体管线 4 文件 → `ingress/media/`） |
| `channels/{permission,questionnaire}-bridge.ts`、`api/channel-context.ts` | `interaction/` |
| `channels/sse-collector.ts` messages 半部、出站格式化/回执 | `delivery/` |
| `channels/adapters/feishu/**` | `transport/feishu/`（`cards/`、`outbound/` 分组；sdk-logger 自 adapter 拆出） |
| `channels/adapters/telegram/**`、`channels/telegram.ts` store 半部 | `transport/telegram/`（`questionnaire/` 分组） |
| `channels/adapters/wechat/**`、`channels/wechat.ts` store 半部 | `transport/wechat/`（`inbound/`、`sdk/` 分组） |

## 3. 剩余 V1 import 台账（全部 type-only，`@mavis/local-runtime` 包根）

依 V2 架构规则，type-only import 包根合法；以下是 MR1 结束时的**全部** 6 处：

| V2 文件 | 符号 | 用途 |
|---|---|---|
| `channel-infra-options.ts:18` | `LocalEnqueueOptions`, `LocalSessionRecord` | hub options 端口签名（host 注入的 enqueue/session 读取回调） |
| `ingress/channel-bridge-infra.ts:17` | `LocalSessionRecord` | hub 的 session 读取回调返回类型 |
| `routing/channel-route-resolver.ts:20` | `LocalSessionRecord` | 路由解析读取 session 归属字段 |
| `routing/rootless-route-resolver.ts:16` | `LocalSessionRecord` | rootless 路由读取 session 归属字段 |
| `delivery/attachment-retry.ts:8` | `DataDirInput` | dataDir 解析入参形状 |
| `migration/primary-agent-session-model-repair.ts:8` | `LocalRuntimeConfig` | 读取冻结模型配置的形状 |

不在包根导出、按方案逐字复制的小契约（位于 `channel-infra-options.ts`）：

- `CompactionOutcome`（V1 `api/http-helpers.ts` 内部类型）
- `LocalSessionProjectIdentity`（V1 host 内部类型）

MR2 切换 owner 时应将上述回调注入改为 V2 host 自己的类型；MR3 清除复制契约与 V1 副本。

共享库依赖（非 V1 耦合，已存在于 `@mavis/shared`）：
`local-runtime-logging/{im-logger,logger,metrics}`、`local-runtime-diagnostics/{event-sink,types}`。

新增第三方依赖（与 V1 同版本，仅 install 未升级）：`bmp-js@0.1.0`、`pngjs@6.0.0`、`@types/pngjs@^6.0.5`。

## 4. 明确不迁清单（V1 继续持有，MR3 delivery 接管时处理）

HTTP route handler / Response 序列化层（方案 §4/§7：MR3 由 V2 http controllers 接管）：

- `channels/channel-bind-routes.ts`、`channel-unbind-routes.ts`、`channel-connections-routes.ts`
- `channels/access-control-routes.ts`
- `channels/route-api.ts` 的 HTTP dispatcher 半部
- `channels/feishu-onboard.ts`、`feishu-onboard-http.ts`
- `channels/telegram-adapter-routes.ts`、`wechat-adapter-routes.ts`
- `channels/channel-binding-target-route.ts`、`channel-connection-binding.ts`
- 各 `LocalFeishuChannelApi` / `LocalTelegramChannelApi` / `LocalWeChatChannelApi` 类及其 Response 序列化器
- `routeLocalChannelBridgeInfraApi`（infra HTTP dispatcher）
- `feishuCardActionHandler` 字段（HTTP webhook seam，hub options 里不迁，MR3 落位）

旧执行路径（方案明确删除，不复制）：

- `channels/sse-collector.ts` 的 SSE 半部（`deliverReplyFromSse` 等）
- `channels/channel-queue-drain.ts`（`kickChannelDrain` 旧 drain 泵）
- V2 `ingress/runner.ts` 中 conversation 改为必需，`dispatchQueued` SSE 分支不存在

装配层（MR2 交付）：

- `api/host-channels.ts`（`wireChannelSubsystem` / `startChannelSubsystem`）及
  bindingStore rows → `LegacyImRoute` 的桥接、`isUsableSession` 谓词组装、
  skip 报告 → 日志转发。

## 5. 行为微调（V2 副本 ≠ 逐字节复制之处）

均已在源码注释注明：

1. **去 HTTP 化返回值**：`Response` 构造改为结构化错误/结果 —
   `ChannelWireValidationError{status:400,code,message}`（ingress 入站解析）、
   `ChannelRouteApiError{status,error,errorCode}`（route-rules）、
   `ChannelAgentImResult{status,body}`（hub `routeAgentIm`）。wire 字段逐字保留，MR3 还原成 HTTP 响应。
2. `interaction/questionnaire-reply-outcome.ts`：跨包 `instanceof` 判定改为 `status+code` 结构判定。
3. `delivery/attachment-retry.ts`：防御性 rethrow 包一层 `Error`（原样透传 unknown 会违反 lint）。
4. `transport/wechat/sdk` 动态 import：`as unknown as` 改为本地结构 interface。
5. `interaction/permission-bridge.ts`：`adapterRegistry` 收窄为结构端口
   `{ getForContext(): PermissionCapableAdapter | undefined }`，避免 interaction→ingress 环。
6. 窄端口化：`default-channel-binding`→`AgentDefaultBindingPorts`；`runner`→`ChannelRunnerInfraPort`；
   `channel-resource-ambiguity` 内联 V1 遥测（事件名/counter/bucket 逐字同步）。
7. 打破模块环的类型搬家（原导出位置一律 re-export 保持 import 路径不变）：
   `LocalChannelRootlessError`/`multiProjectBindingError`→`errors.ts`；
   `LocalChannelCollectedResponse`→`delivery/response-collector.ts`；
   问卷 renderable 契约→`interaction/questionnaire-contracts.ts`；
   `LocalWeChatBindingRecord`→`wechat-binding-serde.ts`；
   `FeishuWsStatusInfo`→`feishu-sdk-logger.ts`；
   `QUESTIONNAIRE_OTHER_SUFFIX`/`QuestionnaireSubmitActionValue`→`cards/feishu-card-form.ts`；
   reconciler 契约 4 类型→`migration/primary-agent-family-platforms.ts`。
8. `migration/` 内 `createLegacyRootSession` 的 lane 由 caller spread 重附（修复一次复制期硬编码漂移）。

## 6. 测试迁移台账（方案 §11 点名清单的处置）

已迁为 V2 sibling 测试（51 用例全过）：

| V2 测试 | 来源 | 说明 |
|---|---|---|
| `migration/legacy-im-migration.test.ts`（17 用例） | V1 `test/unit/legacy-im-migration.test.ts` | 全量迁移；`LocalFeishuChannelApi.configCheck/bindBody/hasBindingBody` 3 处 HTTP 断言改为等价 store 记录断言（HTTP Api 留 V1 至 MR3） |
| `binding/connection-store/im-connection-store-migration.test.ts`（10 用例） | V1 `legacy-im-migration-credential-disambiguation.test.ts` 的核心 | V1 经 `wireChannelSubsystem` 驱动并断言装配层日志；V2 直接驱动 `migrateLegacyImConnections` 断言结构化 `onSkipped` 报告（F4 三分支 + replay/invalid/项目分裂/root 优先级/bind 冲突降级） |
| `binding/storage/owner-store.test.ts`（14 用例） | V1 `local-channel-owner-store.test.ts` | 存储 roundtrip 代表：YAML 持久化、并发 bootstrap 串行、损坏文件自愈、双约定清理 |
| `transport/wechat/wechat-binding-serde.test.ts`（10 用例，新写） | V1 经 `LocalWeChatChannelApi` 间接覆盖 | 平台规范化代表：mode 规范化、legacy 别名、mock/pending 不得读回 live、token 掩码、监控健康 overlay |

留待 MR2/MR3 随接线迁移（V1 测试原样保留继续跑）：

| V1 测试 | 阻塞原因 | 归属 |
|---|---|---|
| `legacy-im-migration-historical-session.test.ts` | 被测行为一半在 `wireChannelSubsystem` 的 `isUsableSession`/rootlessV2 桥接（装配层） | MR2 |
| `legacy-im-migration-credential-disambiguation.test.ts` 的装配半部（日志转发、startChannelSubsystem 全链路） | 同上 | MR2 |
| `im-connection-store.test.ts`（2926 行） | 大量用例经 `routeLocalChannelConnectionsApi`（HTTP 层） | MR3（HTTP 接管时按 controller 归属拆） |
| `local-channel-infra.test.ts`（2304 行）、`local-channel-bridge-telegram-entry.test.ts` | 经 `routeLocalChannelBridgeInfraApi` HTTP dispatcher 驱动 | MR3 |
| `local-im-channel-bind-routes.test.ts` | 纯 HTTP 路由测试，V2 无对应源文件 | MR3 |

## 7. 门禁命令（worktree 根执行）

```sh
pnpm --filter @mavis/local-runtime-v2 typecheck
pnpm --filter @mavis/local-runtime-v2 lint
pnpm --filter @mavis/local-runtime-v2 check:architecture
pnpm --filter @mavis/local-runtime-v2 test:architecture
node --test scripts/test/local-runtime-layout-check.test.mjs
# 迁移测试
pnpm --filter @mavis/local-runtime-v2 exec vitest run \
  src/service/channel-system/test/migration/legacy-im-migration.test.ts \
  src/service/channel-system/test/binding/connection-store/im-connection-store-migration.test.ts \
  src/service/channel-system/test/binding/storage/owner-store.test.ts \
  src/service/channel-system/test/transport/wechat/wechat-binding-serde.test.ts
```

---

# IM 迁移台账（MR2：切换唯一生产 owner）

> 方案 §10 MR2。V2 channel-system 成为唯一生产 IM owner；V1 host 只保留经
> `HostChannelSubsystemPort` 委托的极薄 facade（无 store / runner / 平台实例 / 独立状态）。

## 8. 两阶段装配落位（方案 §5.2 五步）

1. **V1 shell 构造**（`channelComposition: 'external'`）：`api/host.ts` 完全跳过
   `wireHostChannelSubsystem`（新增 host option 属装配拓扑参数，非运行时开关；embedded
   CLI / 独立 V1 host 走 `internal` 保留原有语义）。所有 Channel 触点收敛到
   `requireChannelPort(capability)`，端口未绑定时抛 `ASSEMBLY_ERROR:`（带 capability 名 + mode）。
2. **V2 services 组装**：`services.ts` → `assembleChannelSystemOwner`（channel-system
   `composition/assemble.ts`）用 compat 提供的 `channelWire()` 能力包构造全部 store /
   adapter / runner / Api / 交互桥。构造不启动任何 transport（`deferChannelStartup` 非 true
   直接抛装配错误）；enableChannel 且无 wire 包同样抛错，禁止 fallback。
3. **Session 侧能力**：`compat/v1/session.ts` 的 `channelBindings` 调用面不变，其 V1 实现
   （`listChannelSessionIds` / `deleteChannelBindingsForSession` / `deletePermissionStateForSession`
   的 channel 半部）已改为端口委托 → 实际落 V2 store/bridge。
4. **会话/Agent 能力绑回 Channel**：`apiHost.buildChannelWireInput()`（由
   `buildHostChannelWireInput` 抽出）是唯一权威能力包 —— internal 装配与 external 装配消费
   同一份闭包（enqueue → RuntimeConversation.ingress.submit、agent 解析经 V2 agentRuntimePort、
   问卷/权限回调、config/metrics/fetch）。V1 通用审批服务的
   `channelPermissionOutbound` 换成 lazy 端口代理（构造期不解引用，askk 时 fail-loud）。
5. **接线时点**：`runtime.ts` owner 初始化完成后
   `bindExternalChannelSubsystem(services.channelSystem.subsystem.hostFacadePort)`；重复绑定、
   在 internal host 上绑定均抛错。

## 9. 生命周期与竞态（方案 §5.3/§5.4）

- 启动仍由既有 runtime 阶段触发：`startChannelSubsystemAfterOwnerAgentDefinitions` →
  `apiHost.startChannelSubsystem()` → 端口 → V2 `wireChannelSubsystem` 的幂等 startup
  （凭证导入 → rootless/历史迁移 → family hook → 唯一 restore）。
- 关闭：`stop_channels` → 端口 → V2 shutdown 扫全部 adapter。
- **§5.4 守卫**（`composition/assemble.ts`）：单一 `closed` 门同时封 facade 入口与
  services 入口；shutdown 后晚到的 milestone/restore/Agent-ready 回调对 `start()` 一律
  no-op + WARN 日志；shutdown 幂等（重复关闭只扫一次）。
- Telegram bind poller 失败仍返回绑定成功（V1 语义原样，poller 失败 ERROR 日志）；
  WeChat/解绑/入站 active-binding 检查等 §5.4 细则随 Phase 1 副本原样生效。

## 10. V1 剩余 facade 清单（无 store / runner / 平台实例）

| V1 文件 | 现状 |
|---|---|
| `api/host.ts` channel 触点 | 全部 `requireChannelPort` 委托（HTTP 5 分支、hosted typing/终态、问卷 ask、权限 outbound/forget、session 清理、start/shutdown、agent IM 路由） |
| `api/host-channel-port.ts`（新） | 端口类型（V1 只定义 TYPE，值由 V2 注入） |
| `api/host-channel-internal-port.ts`（新） | internal 模式包装 `wireHostChannelSubsystem` 产物为同一端口；`internalForTests` 供 host 级测试取内部件 |
| `api/host-channel-composition.ts` | 拆出 `buildHostChannelWireInput`（能力包唯一来源）+ `HostChannelWireInput` 类型导出 |
| `api/host-questionnaire-delivery.ts` | handle 改端口（`sendQuestionnaireMessage`），metrics/bus 语义保留 |
| `api/hosted-channel-capabilities.ts` | 改为纯类型（显式 `HostedChannelCapabilities` 接口，`createHostedChannelCapabilities` 工厂删除） |
| `src/cron/delivery.ts` | cron 主动发送/config 门 → 端口（`sendChannelText` / `isChannelConfigured`），host-cron-runtime 经 `requireChannelPort` lazy 解析 |
| `channel-route` YAML CRUD（`routeLocalChannelRouteApi`） | 留 V1（无实例依赖的纯文件 CRUD；V2 routing/route-rules 为唯一读方，写路径只有此 API）→ MR3 生成接口接管 |
| V1 route dispatcher（bridge/bind/unbind/connections/...）与 Api 类、onboard 全套 | internal 模式仍用；external 模式全部不再被引用（MR3 删除） |

compat 层：

- `compat/v1/agent-host.ts`：`createV1ChannelProductCapabilities` + `V1ChannelProductCapabilities`
  删除（终态发送/typing 不再绕 V1 host）；对应测试块删除。
- `compat/v1/runtime.ts`：`channel` product 端口 → `channelWire?: () => HostChannelWireInput`
  （仅 conversation-bound host 提供）。
- `runtime.ts`：删除对 V1 `channelModelInvalidReceiptText` 的 import；改由 services.ts 用
  channel-system barrel 的 V2 副本注入（`CreateRuntimeServicesOptions.formatChannelModelInvalid`
  option 一并删除，属 §12「内部 option」清理，产品 API 无变化）。

## 11. V2 新增装配文件（channel-system/composition/）

| 文件 | 来源 / 说明 |
|---|---|
| `wire.ts` | V1 `api/host-channels.ts` 装配主体（runner 直构造替代 `createChannelRunner` 包装——V1 遗留 legacy-dispatch 选项已死；card-action seam 从 infra 字段改为 wire 组合产物） |
| `channel-apis.ts` | V1 `createChannelApis`（按平台拆 build 函数过 lint 预算；§5.6 惰性注册语义逐字保留；`markHandled` 处理 construction-time promise） |
| `legacy-connection-migration.ts` | V1 `migrateLegacyImConnectionState` 半部（isUsableSession/credential 谓词拆名函数） |
| `restore.ts` / `restore-platforms.ts` | V1 restore（platforms 版循环体拆 `visit*Record`，逐行日志语义保留） |
| `assemble.ts` | MR2 新增：完整 owner 装配 + product transport（typing/终态直连 V2 runner）+ §5.4 closed 守卫 |
| `host-facade.ts` | MR2 新增：实现 V1 `HostChannelSubsystemPort`（含 `routeAgentIm` 的 `ChannelAgentImResult`→Response 还原、V2 onboard service 构造） |
| `legacy-api/*` | V1 三平台 Api 类 + onboard(+http) + connection-binding + 全部 route dispatcher 的 V2 副本（操作 V2 实例；Response 构造隔离于此目录，MR3 随生成接口删除）。`project-key.ts`/`agent-contract-error.ts` 为纯函数小副本（来源注明） |

## 12. MR2 行为微调（新增于 §5 之外）

1. `LocalAgentContractError` 跨包判定改结构谓词（`isAgentContractLikeError`），channel-system
   内主动抛错用本地 twin `AgentContractHttpError`（`name` 相同，HTTP 契约字节不变）。
2. V2 副本 Api 类构造参数对象化（feishu 13 位/wechat 9 位/telegram 5 位参数 → input 对象），行为不变。
3. `resolveChannelTurnOrigin` 未接线（V1 `channelTurnOrigins` map 在 V2 运行时本就无写入方；
   权限 origin 走 event.origin 主通道，与现网一致）。
4. `.eslintrc.js` 为 `composition/legacy-api/**` 加目录级迁移例外（complexity/max-lines 等
   尺寸预算回到 V1 水平；floating-promise/unused-vars 等运行时质量规则保持严格）——方案 §4
   禁止重写迁移的 dispatch 逻辑，该目录 MR3 整体删除。eslint-disable 注释新增 0 条。
5. cron 渠道投递经端口后，`buildLocalCronChannelDelivery` 的依赖从 5 个具体实例收敛为
   2 个端口方法（V1/V2 同路径）。

## 13. MR2 验收测试

V2（`composition/`，21 用例）：

- `assemble.test.ts`（5）：非 defer 装配抛错；权限桥/hosted transport/turnLifecycle 单实例
  （=== + spy 计数）；**§5.4 竞态**（shutdown 后 facade/services 两个入口的晚到 start 均不
  触发底层 startup）；shutdown 幂等（adapter 扫描一次）；权限 ask/reply 同一 bridge 实例
  （pending map 命中断言）。
- `e2e-fake-transport.test.ts`（3）：三平台 启动→绑定（真凭证 ingress，假 getMe/长轮询）→
  入站（handleUpdate/handleEvent dispatch）→ V2 执行入队（enqueueMessage 断言 sessionId/内容）→
  终态回复（注册 fake exact client 收 sendText）→ shutdown。全程无网络。
- `legacy-im-migration-historical-session.test.ts`（8）+
  `legacy-im-migration-credential-disambiguation.test.ts`（5）：台账 §6 欠账的「装配半部」
  测试，自 V1 移植至 V2 wire（conversation 必填 fake）。

V1（2 文件）：

- `local-host-external-channel-composition.test.ts`（2）：external 构造下
  `wireHostChannelSubsystem` **零调用**（模块 spy）；绑定前触点全部 `ASSEMBLY_ERROR`；
  绑定后触点逐一落在注入端口（调用序列断言）；重复绑定/internal 上绑定抛错。
- `hosted-channel-capabilities.test.ts`：重写为 internal 端口的 context 转换/typing 断言；
  `local-questionnaire-delivery-metrics.test.ts` 改端口 handle（metrics/bus 语义断言保留）；
  `local-api-host-channel-dispatch-telegram.test.ts` 经 `internalForTests` 取内部件。

## 14. 已知存量失败（与 MR2 无关）

- `local-runtime-host-factory.test.ts > threads Skill registry diagnostics ...`：
  基线（HEAD~1 的 V1 src）同样失败（Skill runtime not initialized），非本次改动引入。

## 15. 遗留到 MR3

- `composition/legacy-api/**` 整目录（Response 构造 + 旧 REST 形状）由生成接口 controller 接管后删除。
- V1 `channels/**`、`api/host-channels*.ts`、route dispatcher、Api 类、onboard 全套删除
  （internal 模式随之退役）；`.eslintrc.js` legacy-api 例外块删除。
- `channel-route` YAML CRUD 迁 V2 生成接口；正式 delivery 台账化（§7 15 个生成接口整体接线）。
- `im-connection-store.test.ts` / `local-channel-infra.test.ts` 等 HTTP 驱动大测试按 controller 归属拆分。
- V1 存量 tsgo 误报（`conversation-message-adapter.ts`，`tsc` 下无此错误）与 skill-registry
  存量失败用例待独立处理。

---

# IM MR3（本地 IM 完整迁入 · 完成 delivery 接管并删除旧实现）

四个 commit（B → A → C1 → C2）：
1. `feat(local-runtime-v2): take over the legacy channel REST surface at the v2 front door (IM MR3 batch B)`
2. `feat(local-runtime-v2): implement the 15 generated channel methods over the Channel Application (IM MR3 batch A)`
3. `feat(local-runtime): drop the v1 channel HTTP surface and bind the no-IM internal port (IM MR3 batch C1)`
4. `feat!: delete the v1 IM implementation and finish the v2 channel takeover (IM MR3 batch C2)`

## 16. 旧 REST 转正（方案 §7.2/§7.3）

- `composition/legacy-api/`（MR2 过渡副本）转正为 `delivery/legacy-http/`，按 layout 预算分组：
  顶层共享（http-helpers / agent-contract-error / project-key / route-api / surface）、
  `platform-api/`（feishu/telegram/wechat Api、connection-binding、Lark onboarding 服务与 HTTP 客户端）、
  `dispatch/`（bridge / connections / bind / unbind / binding-target / access-control /
  telegram-adapter / wechat-adapter 路由分发器）。dispatch 逻辑按方案 §4 禁止重写，原样平移。
- 新增 `delivery/legacy-http/surface.ts`：每个 subsystem 一份 `ChannelLegacyHttpSurface.dispatch`
  （URL 识别后的统一入口 + v1 `host-routing` catch 的忠实移植：agent-contract 结构化识别、
  primary-agent conflict 409、CHANNEL_CLIENT_UNAVAILABLE 503、其余 `{error}` 500）。
  Lark onboarding 服务在此构造一次，连接取消与 onboarding 路由共享同一 pending 状态。
- 新增 `delivery/legacy-http/route-api.ts`：`/channel-route/*` HTTP 分发器移植
  （v2 `routing/route-rules` 存储，legacy JSON body 字节不变）。
- 前门挂载：`http/routing/channel-compat.ts` 在 `services.channelSystem` 存在时 `app.all`
  挂载 `/mavis/api/channel/connections*`、`/channel-bridge*`、`/im-bridge*`、`/lark/onboard*`、
  `/channel-route*`；命中即不再回落 v1（§7.2）。无 owner 宿主不挂载，回落 v1 得到稳定 legacy 404。
- `/agent/:name/im` 仍由 v1 agent routes 经 subsystem port 委托 v2（薄适配，方案允许）。
- 根 `.eslintrc.js`：`composition/legacy-api` 目录级例外随目录删除；`delivery/legacy-http`
  持有改写后的**永久**例外（尺寸/复杂度维持 v1 基线；运行时质量规则不放松）。判断依据：
  §7.2 旧 URL 永不退役 + §4 禁止重写 dispatch，二者合取使该例外成为长期事实而非过渡。

## 17. 15 个生成接口闭环（方案 §7.1）

- `application/channel/`（layout 白名单新增 `channel` 特性目录）：
  - `channel-application.ts`：15 个方法的 wire DTO 映射，逐行移植 v1
    `desktop-channel-service(.v2).ts` 已验证实现（Connection 透传、listChannelBindings
    三源合并 + 家族过滤 + 保留名冲突「仅展示恢复」、unbindChannel 前缀解码、
    updateChannelBindingTarget 物理 Binding CAS + 默认绑定回退、Lark/WeChat onboarding 透传）。
  - `channel-gateway.ts`：结构化 gateway 端口（application 不触碰 Request/Response）；
    `gatewayJson` 即 v1 `localApiJson` 的非 2xx 原样抛出语义。
  - `binding-projection.ts` / `wire-error.ts`：投影与 `ChannelWireError`（legacy `{error, code}`
    body 原样返回，绝不换成 v2 `{code,key,message}` envelope）。
- `http/controllers/channel.controller.ts`：ready 宿主实现（gateway = 对同一
  `legacyHttp.dispatch` 的进程内调用 + v1 访问日志与 binding key 脱敏；wire error 原样序列化）。
- allowlist：`RuntimeOwnerCapabilities.channel` 门 15 个方法（CHANNEL_OWNER_METHODS），
  与 compat 挂载同源于 `services.channelSystem` —— 两个入口视图原子切换。
- oracle（session-application-oracle）BASELINE_OWNER_METHODS 增补 15 个方法。

## 18. V1 删除台账（文件 → 证据/替代）

src（全部先 grep 消费者再删）：
- `channels/**`（74 文件）→ 实现唯一化到 v2 `service/channel-system`；例外三件套迁出：
  `wechat-sdk-contract.ts` → `runtime/`（electron 工厂选项契约），
  `sse-collector.ts`+`message-format.ts` → `cron/`（cron bridge fan-out 是唯一存活消费者，
  `LocalChannelMessageFilter`/`LocalChannelCollectedResponse` 类型内联）。
- `api/host-channels.ts`、`host-channels-lifecycle.ts`、`host-channel-restore(.platforms).ts`、
  `host-channel-shutdown.ts`、`host-feishu-card-action.ts`、`host-channel-family-gate.ts`、
  `host-channel-pending.ts`、`host-channel-internal-port.ts`、`api/channel-context.ts` →
  内部装配图；v2 `composition/` + `interaction/` + `migration/` 为唯一实现。
  `hosted-channel-capabilities.ts` 已是纯类型文件且被 host/compat 引用，按方案「纯类型保留」原样保留。
- `http/desktop-channel-service-v2.ts`、`-helpers.ts`、`desktop-channel-binding-projection.ts` →
  映射已迁 `application/channel`；`desktop-channel-service.ts` 重写为 no-IM stub 基类
  （15 方法回 legacy 404，路径与旧无 owner 流一致）+ 原样保留的 localApiJson/localApiResponse 通用传输。
- `types/bmp-js.d.ts` + 依赖 `bmp-js` → 随 media normalizer 删除；v2 自带副本与声明。
- `channelOwnerStore/channelAccessControlStore/channelBridgeInfra/channelRunner/
  feishu|telegram|wechatChannelStore` 六个 host options 测试 seam → 删除（v2 wire 自有 override）。
- index.ts 渠道导出面收敛为稳定契约：`channel-permission-contracts`、
  `CHANNEL_CLIENT_UNAVAILABLE(+Error)`、`LocalChannelRootlessError`、`collectChannelResponseFromSse`、
  `wechat-sdk-contract`。全仓 grep 证据：唯一产线外部消费者是 electron `WeChatRuntimeSdk`（保留）。
- package.json：`./channels/wechat-sdk` 子路径导出移除；electron 动态 import 改指
  `@mavis/local-runtime-v2/wechat-sdk`（v2 新增子路径导出；wechat-sdk-wire.test 11/11 绿）。

跨包契约调整：
- `HostChannelSubsystemPort` 移除 `http` 字段；`CHANNEL_CLIENT_UNAVAILABLE` 契约移入端口文件。
- `HostChannelWireInput = ReturnType<typeof buildHostChannelWireInput>`（v1 孪生装配类型消亡后
  以构建器推断为契约；v2 `WireChannelSubsystemInput` 结构校验兜底）。
- v1 `host-routing` 对 primary-agent conflict / channel-client-unavailable 改结构化识别
  （v2 抛出的实例无法共享 v1 类身份）。
- **Phase 1/2 遗留 bug 修复**：`LocalChannelRootlessError` 的 instanceof 跨包失配 ——
  v1 wire 闭包抛 v1 类、v2 catch 检 v2 类。v1 类现于 `host-channel-composition.ts` 本地定义
  且 name/status/code 为稳定契约（后续如需 v2 侧结构化识别可在独立 MR 收紧；生产路径
  resolveProjectWorkspace 仅在 route resolve 中调用，错误映射通过 surface catch 的通用 500 兜底）。
- **Phase 2 遗留 bug 修复**：runtime-composition 两个验收用例自 MR2 起红
  （`apiHost.channelBridgeInfra` seam 从未接线，基线复核确认）。`runtime.ts`
  `bindV2ChannelSubsystem` 现挂上文档化 test-only seam，2 用例转绿。

internal 模式（上一阶段裁决硬项）：
- `host-channel-unsupported-port.ts`：无 IM 能力端口。环境触点=空子系统语义
  （listBindingSessionIds `[]`、deleteBindingsBySession `0`、permission fan-out no-op、
  questionnaire `'unavailable'`、cron isChannelConfigured `false`）；IM-only 交付触点
  以既有 `CHANNEL_CLIENT_UNAVAILABLE` 契约响亮失败；startup/shutdown no-op（嵌入式 CLI
  永不自行启动 transports）。`channelComposition` option 保留（产品 API 不变），
  internal=无能力端口；`channelCapabilityEnabled` 需 external 组合，internal 宿主对全部
  渠道路由（含 `/agent/:name/im`）回稳定 legacy 404。
- questionnaire recovery：internal 无 restore pass，立即恢复（挂起问卷经 no-IM 端口回
  'unavailable'，与空子系统一致）。

## 19. 测试迁移台账（方案 §11 点名 + 全量处置）

迁移（v1 → v2 `test/integration/`，import 换轨到孪生实现，行为断言不变）：
- `im-connection-store.test.ts` → `im-connection-store.integration.test.ts`（57 用例，一次通过）。
- `local-channel-infra.test.ts` → `channel-bridge-infra.integration.test.ts`（46 用例；v2 适配：
  routeAgentIm 结构化结果、前门 conflict 映射 wrapper、compaction 类型改 v2 源）。其中 2 个
  `replaceRootSession` 用例主体是 v1 agent routes（非渠道），拆回 v1
  `local-agent-root-replacement.test.ts` 保留。
- `local-im-channel-bind-routes.test.ts` → `channel-bind-routes.integration.test.ts`（15 用例，
  含从 v1 routing-errors 移植的 reserved-primary 归一化契约）。
- `local-channel-bridge-telegram-entry.test.ts` → `channel-bridge-telegram-entry.integration.test.ts`（6）。
- `local-channel-message-format.test.ts` → v1 `cron-message-format.test.ts`（随实现迁 cron/）。
- `local-api-host-routing-errors.test.ts` → 原地重写为结构化契约（4 用例）。
- `local-desktop-service.test.ts` 7 个转发用例 → 1 个 no-IM stub 契约用例（15 方法全覆盖）；
  映射语义由 v2 §7.1 生成套件 + `channel-application.test.ts` 承接。
- `local-api-host.test.ts` channel-route CRUD（HEAD 即红）→ MR3 语义 pin
  （internal 404 + 不落 YAML）；CRUD 全回路在 v2 §7.3 台账套件。
- v2 侧修复：`compat/v1/session.test`、`runtime-composition`、`agent.service.test`、
  `channel-input-rejection` 改用 v2 孪生（WeChat Api 构造对象化、runner conversation-first）。

删除（75 个 v1 IM 测试文件；“场景 → v2 覆盖”映射）：
- e2e/channels 5 件（三平台 roundtrip、权限卡）→ v2 `e2e-fake-transport.integration.test.ts`
  三平台 bind→inbound→terminal reply + `channel-turn-lifecycle` / `channel-final-reply-observer`。
- feishu 11 件（adapter/reactions/sender/card/onboard/thinking-card/ws-logger/restore-log/unbind）、
  telegram 10 件（adapter/poller/poll-wire/sender/attachments/questionnaire-callback/unbind）、
  wechat 10 件（channel/ilink client+media/monitor contract+wire/multimodal/onboard-hook/permission/unbind）
  → 实现整体为 v2 孪生副本；行为回归由 e2e-fake-transport + §7.3 台账 + 迁移四大套件承接。
  **粒度损失如实声明**：平台 adapter 细节（reactions、思考卡片渲染、ilink 媒体分片、监控 wire）
  在 v2 无同粒度单测，后续按需补。
- runner/bridge/权限/问卷 8 件 → v2 `channel-turn-lifecycle` + `assemble.test`（权限 ask/reply 单实例）
  + e2e 权限/问卷 intercept 路径；`interaction/` 实现为迁移副本。
- binding/access/owner/route 10 件 → v2 `owner-store.test`（迁移）、§7.3 台账（access-control /
  bindings / route rows）、`channel-bridge-infra` 迁移套件（binding CRUD/pin migration/deleteBySession）。
- restore/startup/family/migration 15 件 → v2 `assemble.test`（单实例/关闭竞态/里程碑）、
  `migration/legacy-im-migration.test`、两个 legacy-im integration 套件、
  `im-connection-store-migration.test`、`primary-agent-session-model-repair` 实现迁移。
  crash-recovery / settled-shadow / multi-instance 深度场景无 v2 同粒度单测（如实声明）。
- 杂项：`channel-queue-drain`（v2 ingress 副本）、`attachment-retry`（v2 delivery/attachment-retry）、
  `inbound-media-normalizer`（v2 ingress/media）、`resource-ambiguity-telemetry`（v2 routing 副本）、
  `feishu-sdk-logger-bridge`（v2 transport/feishu）。

## 20. MR3 门禁结果

- v2 五门禁：`typecheck` ✅ / `lint` ✅（0 error）/ `check:architecture` ✅ /
  `test:architecture` ✅（含新增 channel-ownership 4 断言）/ layout-check ✅
  （services.ts 已回 1200 行内；.DS_Store 过滤入脚本）。
- v1：`typecheck` ✅；单测 4,3xx 通过，仅存 15 个**基线既有失败**（stash 复核 HEAD 同红：
  skill-hub zip 3、team-worker 3、model-selection 2、hosted-agent-capability 2、
  host-turn-tools/website-deploy/connection-pool/host-factory/permission-wiring 各 1）。
- §7.3 台账契约：`channel-legacy-rest-contract.integration.test.ts`（52 行项逐路径 +
  别名字节一致 + 尾斜杠 + 未知子路径 legacy 404 + 路由 CRUD 全回路 + 零回落断言）。
- §7.1 生成接口：15 方法无 NotImplemented 残留、无 v1 回落；无 owner 宿主回落 v1 断言。
- 依赖扫描：dep-cruise `no-v1-internal-deep-import`（既有）+ 新增
  `channel-ownership.architecture.test.ts`（v1 无 channels 目录 / v1 src 无 channels import /
  v1 导出面收敛 / v2 channel-system 仅 type-import v1）。
- e2e-fake-transport 三平台回归 ✅；electron wechat-sdk-wire 11/11 ✅。

## 21. 未验证项（如实声明）

- 真实平台往返（真实飞书/微信/Telegram 账号收发、Lark OAuth、iLink 扫码）未验证：无真实账号。
- macOS 之外（Windows）未验证；Electron 打包产物级验证（asar 内 wechat-sdk 子路径解析）未运行，
  仅静态引用与单测验证。
- CLI `mavis im` 对 desktop runtime 的手工端到端未运行（路径契约由 §7.3 台账覆盖）。

## 22. MR3 CI 修复台账（pipeline 首跑失败逐项）

前置：merge `origin/preview_train`（470e825cb0，含 MR-04 Skill 迁 v2 / MR-05 Plugin Hook
权限迁 v2）。冲突解决见 merge commit 说明；两侧都是 V1 瘦身，意图全部保留 ——
services.ts 采主线 `createRuntimePromptSessionSupport` 抽取 + 在该 helper 内重放
MR2/MR3 的 `formatChannelModelInvalid` v2 注入（helper options 加 Omit）；host.ts
采主线 skillRuntime/pluginHookPermission deferred capability + 我方 no-IM internal
分支；index.ts 双侧删除叠加；resource-ambiguity-telemetry.test 恢复（memory/skill
用例主体在 V1 存活，仅渠道用例迁 v2 infra 套件，主线的 skill-system→skill 路径
改名一并保留）。

1. `check:fast:typecheck`（packages/cli tsc）：TS7016 bmp-js。根因 = v2 包
   `types` 指向 src，外部程序编译 v2 源码时不会收录未被引用的同目录环境声明
   `bmp-js.d.ts`（V1 时代 types 指 dist，不存在该路径）。修复 =
   `inbound-media-normalizer.ts` 顶部 `/// <reference path="./bmp-js.d.ts" />`，
   使声明随文件进入任何程序。本地 `packages/cli tsc --noEmit` 0 错误。
   `@typescript-eslint/triple-slash-reference` 的豁免放根 `.eslintrc.js`
   单文件 override（v2 inline eslint-disable 预算 3/3 已满，layout gate 拒绝
   第 4 条 inline 指令；.d.ts 无法用 `import` 携带，triple-slash 无替代）。
2. `check:unit:local-runtime-v2` 的 `check:dead-code`（knip --production，本地
   五门禁未含此条，现已纳入）：channel-system 迁移副本保留了 V1 时代的 export
   面。处理 = 优先真实收敛 —— barrel 剪 7 项、删除纯 re-export 文件
   `access-control/access-control.ts`、~120 个无消费者导出降级为模块内符号/删除
   re-export 行；wechat iLink SDK 入口 `transport/wechat/sdk/index.ts!` 注册为
   knip entry（对应 `./wechat-sdk` 包导出）。白名单（JSDoc `@public`，knip 6
   官方机制）仅 4 处且各附理由：normalizeWeChatMode、LegacyImMigrationSkip
   （同目录单测直测）、ChannelInboundAttachment、WeChatDownloadContext（inline
   `import()` 类型引用，knip 盲区，tsc 证实有消费者）。两个迁移 integration
   套件的 LocalImConnectionError import 改到 `binding/im-connection-types.js`。
   本地 `knip --production --include files,exports,types` exit 0。
   knip 收敛后 eslint no-unused-vars 暴露一批「导出降级后模块内亦无消费者」的
   死代码，全部真实删除（每项 grep 全仓 + tsc 双证据）：V1 直连注入口
   `wechat-attachment-support.ts` 的 4 个 downloader/DLQ get/set（生产装配走
   `wechat/sdk/ilink-download.ts` 槽位 + adapter per-call 传参，两个 module
   state 随之内联为常量语义，行为逐字节不变）；`questionnaire-reply-outcome.ts`
   分类器（v2 渠道侧只消费 settle 结果，分类留在 v1/tui 各自副本）；
   `questionnaire-bridge.ts` encode token（Telegram 用索引布局、Feishu 走
   card value，无人消费 JSON 编码器）；`feishu-card-form.ts` buildReplyFromEvent；
   `channel-inbound-utils.ts` readOptionalInboundExtras 及整条私有读取链
   （attachments/quoted/eventId 8 个函数，v2 wire 读取在 delivery/legacy-http）；
   `im-connection-store-data(-codec).ts` serializeConversation 与残留 import；
   `access.ts` ChannelAccessDenyReason 死类型。
3. `check:integration:channel-bridge`：V1 `test:integration:channel(-smoke)`
   脚本硬编码 20 个已删/迁移路径。修复 = 指向现存等效面 —— V1 存活渠道契约
   套件（routing-errors、external-composition、root-replacement、
   resource-ambiguity、api-host 渠道 404 pin、desktop no-IM stub、questionnaire
   delivery metrics、cron-message-format、agent-name-conflict-migration）；
   v2 行为套件已由 `check:unit:local-runtime-v2`（test:coverage 全量 vitest）
   覆盖，该 job 维持 V1 作用域。job 的 changes globs 同步换成现存路径。
   本地两脚本 183 + 6 全绿。
4. `check:test-surface-contract`：`.harness/test-surface-contract.json` 仍
   require 已删 V1 测试。修复 = `channel-bridge-im-pipeline` feature 的
   sources 指向 v2 channel-system + V1 存活面，required.unit 换成 6 个 v2
   迁移套件 + 3 个 V1 契约套件；`electron-test-data-dir-isolation` 移除已删的
   `local-channel-restore-inbound` 行。本地 gate 通过 + gate 自测通过。
5. `check:fast:sensitive-keyword-diff`：飞书语音编码（Ogg 音频格式）8 行命中
   模型名关键字。按检查器既有 `CONTENT_EXEMPTIONS` line 形态逐行豁免
   （feishu-ws 3 行、feishu-attachments 1 行、feishu-sender 4 行），未改规则集；
   检查器自测 23/23 + 以 CI 同源 base 实跑通过。
6. `check:unit:electron` / `check:contract:mcode-exec`：bmp-js 级联，1 修复后
   本地按 CI 命令复验 —— electron local-runtime 模块套件 47 文件 917 通过、
   `@minimax/code` build + compiled-exec-cli 15 通过 + npm-publish fixture
   node --test 通过。

skill-hub 3 用例定案（不再以「既有红」结案）：根因 = 我方分支缺 MR-04/05。
主线把 Skill 服务迁入 v2 并给 V1 host 换成 deferred SkillRuntimeCapability；
我方 pre-merge 分支仍是 V1 `initSkillService` 直连 registry，在无 v2 skill
runtime 装配的测试宿主上抛 `Skill runtime is not initialized`（本地基线双红即
此因，CI 主线绿因为主线已删这 3 个 V1 用例并迁移到
`test/integration/skill/legacy-host-management.integration.test.ts`）。merge 后
本地 `local-api-host.test.ts` 全绿（3 用例随主线删除，v2 归宿套件绿）。

layout 收敛（merge 后首次全量 layout gate 暴露）：主线 merge 把 `services.ts`
推到 1207 行（>1200 预算，禁上调）。处理 = 合并 plugin-system / cron 两处重复
import，并把 cron 装配 `initializeRuntimeCron` 抽到
`application/session/runtime-cron-support.ts`（与 runtime-prompt-support 同类
先例；application 子目录白名单固定，禁新建 cron/）。新文件用窄输入接口
`RuntimeCronSupportInput`，db/scheduler 类型从 cron initializer options 推导
（application 层禁 import infra，dep-cruise `application-no-http-hono-or-infra`
把关），services.ts 传完整 owner-initialization input 结构兼容。
`cron-persistence-boundary.architecture.test.ts` 的装配形态断言随代码迁移：
新文件纳入 migration-policy 反断言、scheduler-import fence 与
`createRuntimeCronSessionPorts` 断言，services.ts 保留唯一调用点断言，不变量
强度不减。services.ts 现 1169 行。

## 23. MR3 CI 第二轮修复台账（merged-result pipeline 911582 剩余 4 项）

1. `check:fast:local-runtime-architecture`（wiring 自测 :472 deep-equal）：
   根因 = §22-2 给 package.json `knip.entry` 注册了 wechat iLink SDK 入口
   （`transport/wechat/sdk/index.ts!`，对应 `./wechat-sdk` 包 subpath），CI
   自测的期望 entry 列表没跟上。修复 = 期望列表补该条并附注释；改动本身
   符合「production-only + MR CI 运行」约定（SDK 入口是真实生产导出面）。
   本地 `node --test` 18/18。
2. `check:ci-scripts`（fast-check-path-scoping :251）：根因有二 —— §22-3 更新
   channel-bridge job 两个 rules 块时在 changes 列表**中间**插了 4 行注释，
   打断了该自测「两块 changes 逐行连续一致」的拼接匹配；且自测期望的 paths
   仍是已删 V1 路径（`src/channels/**` 等）。修复 = 注释上移到 job 的
   `rules:` 键上方（两个 rules 块保持无注释的同一 14 行列表），自测期望
   更新为现存面。本地 `node --test` 7/7。
3. `check:unit:local-runtime-v2`（coverage 阈值，非 knip）：`test:coverage`
   全量 lines 88.18 / branches 88.45 < 90 —— MR1 迁入的 channel-system 孪生
   副本删除了 75 个 V1 套件后，v2 侧只有四大迁移套件 + e2e，transport/
   delivery/interaction 层缺同粒度单测。修复 = **按被删 V1 原用例语义重建**
   （§19 声明的粒度损失即本清单）：迁移 27 个 V1 单测为 v2 colocated 孪生
   （import swap + 已对象化构造适配 + 少量 v1-only 段剪除并在文件头注明），
   另为 §10-A 新代码 `application/channel/channel-application.ts` 补 18 个
   fake-gateway 行为用例。全部为断言型行为测试；未改 coverage 阈值、未新增
   exclude。knip `@public` 白名单从 4 处扩到 9 处，新增 5 处理由一致且逐个
   标注（colocated 单测直测的模块内符号：feishu-sender 4 项、
   encodeTelegramQuestionnaireCallback、normalizeTelegramBotName、
   deliverOutbound、categoryForKind、detectMediaOrFallback）。
   结果（本地全量 test:coverage，含 8 个已知基线红）：lines/statements
   88.21 → **91.16**（达标）、functions 93.91（达标）、branches 88.07 →
   **88.37（未达 90）**。branch 缺口是结构性的：channel-system 迁入带来
   6,848 个分支、覆盖 72%→~78%，把全包 90% 拉回需要该子树到 ~89%（还差约
   1,100 个分支 = transport/dispatch 各文件的深错误/降级分支），按本批
   节奏估算还需 15-25 个深分支套件。已迁 27 个 V1 套件覆盖了 V1 原有的行为
   面；剩余分支多为 V1 时代同样未测的错误路径。阈值和 exclude 均未改动，
   该项在本 MR 内如实标注为未达标，处理方案待评审（继续补测批次 / 分 MR /
   其他）。
4. `check:unit:electron` → `check:electron-legacy-data` 守卫：fragment
   「host.ts 含 routeLocalChannelRouteApi」失守。**行为考古结论 = 无产品
   回归**：该 fragment 出自 3f4076a45b3（clean embedded runtime 收敛，锁
   「native 实现、不 proxy legacy daemon」）；随后 60a96610dca（mcode
   desktop-only 隔离）已把 channel-route 划入 capability gate —— CLI 嵌入式
   （tui `embedded-host.ts` 传 `capabilityProfile: 'cli'`）自那时起就是稳定
   legacy 404。C1/C2 删除 V1 分支后：嵌入式仍 404（`channelComposition
   'internal'` gate，同 body；`local-api-host.test.ts`「answers channel-route
   with the stable legacy 404」用例锁定 status/rules/defaults/resolve 四路径
   + 不触碰 YAML）；desktop 由 V2 前门 legacy-http 等价承接（§7.3 台账
   channel-route 全 CRUD 行字节契约）。修复 = 守卫改为三条写实断言：v2
   `route-api.ts` 保有 native 实现、v2 legacy-http surface 派发它、V1 host
   保留 `isChannelCapabilityRoute` 稳定 404 gate；语义强度不减（native、
   no-daemon-proxy、CLI 404 三个不变量全部持续被守卫）。脚本本地 exit 0。

## 24. channel-system 测试目录收纳（MR !7167 整理）

`src/service/channel-system/` 下全部 34 个 `*.test.ts` 集中挪入
`src/service/channel-system/test/`，内部镜像原子域结构（如
`transport/wechat/wechat-adapter.test.ts` →
`test/transport/wechat/wechat-adapter.test.ts`）。纯 `git mv` + 测试内部
相对 import 按新深度机械重算（126 处），源码与行为零变化。

三处配置做等语义的路径跟随（门槛不降）：
1. `dependency-cruiser.config.mjs` `unit-test-imports-source-sibling` 的
   `module.pathNot` 增加精确豁免 `(?:^|/)channel-system/test/`（集中区无
   同名 sibling，契约不适用；其余 colocated 测试照旧约束）。
2. `scripts/check-local-runtime-layout.mjs` sibling 扫描以独立谓词
   `isChannelSystemCentralizedTest` 精确跳过该树，并在 meta
   （local-runtime-layout-check.test.mjs）新增用例锁定该接受语义。
3. 根 `.eslintrc.js` 迁移孪生 max-lines-per-function 豁免清单中 9 条
   channel-system 路径做前缀替换（规则与条数不变；application/channel
   的 1 条不受影响）。

vitest include/coverage、knip project、敏感词豁免（按行内容匹配）、
CI changes globs 均与路径无关或天然覆盖新位置，未做任何改动。

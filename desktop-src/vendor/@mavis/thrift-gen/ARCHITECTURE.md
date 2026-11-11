# @mavis/thrift-gen 架构

本包从 `weaver/idl` 生成 DesktopService
TypeScript 契约、client/server 和 runtime 路由绑定。IDL 是契约来源，生成物不承载业务逻辑；跨仓操作见
[IDL 工作流](../../.harness/skills/desktop-service-idl-first/SKILL.md)。

## 输入与生成

入口是 `matrix/desktop_service/desktop_service.thrift`；共享 DTO 位于
`matrix/api_common/`。生成命令按显式 `--idl-dir`、附近 sibling checkout、临时 clone 的顺序寻找 IDL：

```bash
pnpm gen:thrift
pnpm gen:thrift -- --idl-dir /path/to/weaver/idl
```

正常提交使用已 review、已合入的 IDL。review 期间可用未合入 worktree 验证；如果 consumer 必须先对已 review 的精确输入确定性生成，可显式使用
`pnpm gen:thrift:scope-frozen`，以仓库 fixture 冻结 consumer 契约。它不取代上游 IDL；上游合入且可稳定解析后恢复普通生成。

本次 SSH 分支合并使用独立的 `test/fixtures/scope-frozen/` 保存完整 DesktopService include 闭包，
与生成器的最小测试 fixture 分开，基于全新拉取的上游
`6e935b00956acd4611d6062345b926905d8fbddf`，保留当前 consumer 已有的远端文件、Goal dismiss
和 permission mode 契约。重新生成后的 TypeScript DTO 与合并前保持一致；路由 matcher 必须在
普通路由和 SSE 常量都定义后初始化。Goal 的 `objective_resources` 保留上游字段 16，
`dismissed_at` 在冻结输入中使用字段 17，避免编号冲突。

上游依赖 [weaver/idl !13607](https://gitlab.xaminim.com/weaver/idl/-/merge_requests/13607)
已通过合并提交 `a95328a944ad3a45328f2dec69dbfb70a3f24114` 进入 main，包含 Goal dismiss、
permission mode 和远端文件契约。随后生成输入更新到已合入的
`0056a77951a2390bfcaec47ae2d59d618a10bc4b`，同时包含 Local Hook 管理契约。
Hook 业务尚未在本分支接入，controller 工厂使用生成的 `HookControllerBase` 保持完整绑定；
这些方法继续受现有迁移 allowlist 限制，基类调用返回 `NOT_IMPLEMENTED`。
v1 `DesktopService` 同样显式补齐这六个方法并返回 HTTP 501 / `NOT_IMPLEMENTED`，
确保生成基类的抽象契约完整，且未接入业务的请求不会执行 Hook。
consumer CI 持续用上游 main 重新生成并检查差异；本地冻结输入与测试不能替代该检查。

Mini App Git 预览的 [weaver/idl !13752](https://gitlab.xaminim.com/weaver/idl/-/merge_requests/13752)
已通过合并提交 `e5fc371a805f144ac57bd9f26ee8ddd03259ee14` 进入 main，当前正式生成输入即为该提交。
它增加可选 Mini App 权限、版本与包根 README 正文，
以及请求中的可选 `readme_locale`，只影响 Renderer 与桌面 Runtime 的 Mini App 导入预览。
`zh-*` 按 `README.zh-CN.md`、`README.zh-Hans.md`、`README.zh.md`、`README.md` 顺序选择可显示正文；
英文、未知或缺失语言使用 `README.md`。响应仍返回单份 Markdown 与实际选中文件的相对路径。
preview/import 只处理输入对应的精确单包路径，不递归发现其他包。
生成使用已合入的 main，不再依赖待审分支或 scope-frozen 输入。

此前生成基线为已合入的 IDL main `1e924a8cd`，包含 Mini App Pad 和 SideChat 顾问草稿契约，
以及已打开文件监听
`WatchWorkspaceFiles`（weaver/idl !13749）、反馈诊断字段、分类和 `FeedbackStatus.SUBMITTED`，
以及 MCP OAuth 与顾问模型选择契约（weaver/idl !13764）。本次预览字段更新不新增 DesktopService 方法。
Mini App Pad 的七个方法继续由生成的 controller base 和 `DesktopMiniAppServiceBase` 返回
HTTP 501 / `NOT_IMPLEMENTED`，不进入 v2 allowlist，也不接入业务 service。
此前 `7f9681b79` 在 `4a35137e7` 的基础上新增 Canvas 变清晰
`EnhanceCanvasImage`（weaver/idl !13778）与问卷 `RecordPluginRecommendationDecline`，并已包含
`SearchSessionsReq.project_keys`、`SearchSessionsResp.session_projects`、回退 Project 工作区契约的
weaver/idl !13768，以及新增 `CreateProject` 与项目 `workspace_roots` 的 !13769。
`GetProject` 与四个 Project 工作区方法已随 !13768 从契约移除，占位实现和占位测试一并删除。
Desktop 项目通过 `CreateProject` / `UpdateProject` 维护 `workspace_roots`，由 v2 `ProjectController`
接入业务；v1 `DesktopService` 对 `CreateProject` 返回 HTTP 501。
`RecordPluginRecommendationDecline` 仍只同步契约，由 generated controller base 与 `DesktopUnavailableServiceBase`
返回 HTTP 501 / `NOT_IMPLEMENTED`。`RemoveCanvasImageBackground` 与 `EnhanceCanvasImage` 已由 v2 `CanvasController`
接入并进入 v2 canvas allowlist（只对本地会话开放，SSH 与 RC 没有画布入口）；v1 `DesktopUnavailableServiceBase`
对两者仍返回 `NOT_IMPLEMENTED`。
`pending-desktop-contracts.integration.test.ts` 通过 generated client 和实际 v2/v1 HTTP 路由验证
仍未接入接口的 wire 参数、不支持错误及 Canvas 无业务调用。后续业务 MR 接入时应同步更新对应占位测试。
`WatchWorkspaceFiles` 已由 v2 `WorkspaceFileController` / `WorkspaceFileService` 接入文件监听业务。
v1 兼容入口仍返回符合 SSE error body 的 HTTP 501 / `NOT_IMPLEMENTED`，要求使用 Runtime V2；
`workspace-file-watch.integration.test.ts` 覆盖实际路由的监听、变更通知、参数校验与关闭行为。

当前输入也包含 MCP OAuth 七个接口与 Feedback `MESSAGE_DISLIKE` 枚举。MCP OAuth 已由 v2
`McpController` 接入所属 MCP 授权服务，HTTP MCP 配置保留并校验 `oauth` 字段；未装配授权服务的
v2 宿主返回 HTTP 503 / `MCP_AUTH_UNAVAILABLE`，v1 兼容入口仍返回 HTTP 501 / `NOT_IMPLEMENTED`。
`mcp-oauth-flow.integration.test.ts` 覆盖授权与配置读写，pending integration 测试覆盖缺少授权服务时的
错误语义和无副作用行为。

此次同步也保留主干 Advisor 契约，并同步 Mini App Launchpad 七个接口及 `CreateSideChat.advisor` 字段。
Launchpad 业务尚未接入；controller 工厂注册生成基类，迁移 allowlist 不开放这些方法，
v1 兼容入口返回 HTTP 501 / `NOT_IMPLEMENTED`。pending integration 测试通过 generated client
验证两种入口均不执行创建、停止、删除或维护操作。本次没有新增 Mini App Pad 产品能力。
SideChat 尚未支持独立 Advisor；显式携带 `advisor` 的普通/createOnly 请求在创建及附件处理前返回 501，
省略该字段的既有流程保持不变，避免新字段被静默丢弃。

当前输入包含 Git 导入预览的可选 `readme_locale` 请求字段和 `mini_app` 展示元数据，包含声明权限、
MCode 版本要求与 README。生成契约及冻结输入同步上游；未返回这些字段的旧 Runtime 仍兼容，
这些生成字段只用于预览展示，不授予权限。`plugin-import-preview-wire.test.ts` 覆盖可选字段的
请求/响应映射及旧响应兼容。

## Showcase 通用参考附件

[IDL !13748](https://gitlab.xaminim.com/weaver/idl/-/merge_requests/13748) 已合入。
`PluginShowcaseReferenceFile` 与 `PluginShowcase.reference_files` 使用字段 6，旧参考图字段 5
保持兼容。`scope-frozen` include 闭包同步当前正式输入，冻结输入只中性化厂商说明注释并清理行尾空白，不改变契约。
正式输入与冻结输入生成结果一致；同一正式输入重复生成无额外变化。

## 生成器内部

```text
native/thrift-ast/（thriftgo → JSON IR）
  → src/generator/load-thrift-ir.ts
  → symbol-table.ts / resolve-types.ts
  → http-service-model.ts
  → emit-http-service.ts / emit-desktop-service.ts / emit-local-runtime-routes.ts
  → index.ts 写入输出
```

- 输入包含 namespace、service/method、类型与 `api.<verb>`
  annotation；遇到不支持的绑定直接失败，不输出半可用契约。
- 同一 include 文件按相对包含者解析后的 IDL-root 路径建立唯一身份，避免不同相对写法重复生成声明。
- 覆盖已有输出前检查 generated marker。v2 输出还检查路径、安全写入和孤立 controller
  base；不覆盖手写 controller。
- 跨平台安全：v2 写入前用 `lstat` 逐级检查输出路径组件是否含 symlink
  （`assertOutputPathComponentsAreSafe`）。`path.relative` 在 Windows 上以
  `\` 分隔，必须按 `path.sep` 拆分量，绝不能写死 `'/'`；否则单 component
  会让 Node 直接透过 symlink 节点看到目标文件 stat，绕过节点级 guard。所有 hard
  guard（路径逃出 root、根是 symlink、中间组件是 symlink、不带 generated marker
  的现有文件、v2 孤立 controller base）保留不变。

## 当前输出与职责

以 `src/generator/index.ts` 和实际生成 diff 为准：

| 输出                                                                                | 职责                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------- |
| `packages/thrift-gen/src/generated/desktop-service/{types,routes,client,server}.ts` | DTO、路由元数据、client 和 server       |
| `packages/thrift-gen-client/src/generated/desktop-service/{types,routes,client}.ts` | 浏览器可用的 client 契约，不包含 server |
| `packages/local-runtime-v2/src/http/desktop/routes.ts`                              | DesktopService 接入绑定，调用手写适配器 |
| `packages/local-runtime-v2/src/http/routing/{contracts,bindings}.gen.ts`            | v2 契约与路由绑定                       |
| `packages/local-runtime-v2/src/http/generated/*-controller-base.gen.ts`             | v2 controller base                      |

名称由 IDL 的 service/method 推导，不手造 local-specific
service 名。生成器和 IDL 是审查重点，生成 diff 仍需检查是否包含无关变更。

## 手写实现

- v2 controller 位于 `packages/local-runtime-v2/src/http/controllers/`，业务由所属 service /
  application 处理。具体分层见
  [v2 HTTP 框架](../../.harness/docs/design/local-runtime-v2-http-framework.md)。
- `packages/local-runtime-v2/src/http/desktop/server.ts` 承接 DesktopService 适配，不新增 router
  singleton、route matcher 或业务规则。
- gateway 职责见
  [DesktopService 边界](../../.harness/docs/adr/desktop-service-ownership.md)。新 runtime 复用同一 IDL 模型，不另写一套 wire
  contract。

## 验证

相同 IDL 重复生成应无额外变化。契约测试通过 generated
client 调用实际 route/controller，覆盖字段转换和错误语义；按影响运行相关文件、typecheck 和包边界检查，命令遵循根
`AGENTS.md`。

只改业务且契约不变时无需重新生成。MR 记录 IDL 来源、生成范围、实际检查和风险；不要求另写 changelog。

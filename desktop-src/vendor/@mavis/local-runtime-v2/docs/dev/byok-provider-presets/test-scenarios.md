# BYOK Provider Preset 与 TUI Codex OAuth 测试场景契约

状态：用户已于 2026-08-30 确认；proposal document 按用户“开始实现”指令跳过。

## 产品契约

- **共享后端能力**：Electron 与 TUI 共同消费 Local Runtime V2 Model System 拥有的 Provider Preset
  Catalog，但保留各自的 delivery adapter 与 UI 流程。
- **Provider identity**：使用 models.dev 的原始 `providerId`，按 opaque string 处理；不以 Provider
  name 定位，不增加 alias 或迁移映射。共享 catalog 不排除任何 Provider
  ID：`minimax`、`minimax-cn`、`minimax-coding-plan`、`minimax-cn-coding-plan`
  与其他厂商一样作为 BYOK preset 提供，与官方 managed MiniMax 渠道、第一方 `minimax_api`
  key 入口并存。
- **Provider Preset**：只读 BYOK 创建候选，仅包含 `providerId`、`name`、`baseUrl`、
  `apiFormat`、`models` 与可选的最终 `iconUrl`；不包含 credential、configured
  status、`defaultModelId`、中文名、Apollo metadata、pin 标记或持久化 provenance。
- **Effective Product Region**：Electron 由包 locale 得到 `cn` /
  `en`；TUI 使用当前 account/runtime 的
  `MAVIS_REGION`，未设置时沿用现有 CN 默认。两端不新增 region 参数或 IDL 字段。
- **Electron Save**：选择 preset 并填写 API key 后，复用现有
  `SaveUserModelProviderCandidate`，发送 preset 全部模型、无 `modelId`、
  `skipConnectionTest=true`、`saveAndUse=false`。保存时不请求 Provider、不切换当前模型；首次真实请求才暴露 key 或 endpoint 错误。
- **TUI 第三方 Provider**：继续显式选择模型、连接测试、保存并切换；只是 catalog 与排序改为共享实现。
- **TUI Codex OAuth**：保留独立「连接 Codex」流程，仅通过 process-local application 暴露 status 与
  `startLogin`；不新增 IDL，不增加 cancel、disconnect 或 reconnect 状态机。internal
  build 开启，非 internal build fail closed。
- **Electron Codex OAuth**：现有 HTTP status / login 流程不改。

## 后端设计约束

- `ModelSystemOwner` 直接拥有一个 concrete Provider Preset Catalog，并仅对 delivery adapter 暴露
  `listProviderPresets()`；不新增单实现 interface、factory 或通用 Provider facade。
- Catalog 复用当前 TUI 的 models.dev bundled snapshot、dataDir
  cache、ETag、single-flight 与原子写入逻辑，canonical gzip asset 移到
  `packages/local-runtime-v2/assets/`。TUI runtime asset copy 从该位置复制，Electron dependency 使用
  `@mavis/local-runtime-v2` package 自带的同一路径；packaging guard 同时校验 shared copy 与 package
  surface。models.dev refresh 为 detached best-effort
  async，不阻塞 runtime 初始化或首次本地 catalog 读取。
- CN refresh 先从 biz-gateway 匿名接口 `GET /mavis/api/v1/models-dev/catalog` 获取同一不可变
  release 的 `catalog_url` 与 `icon_base_url`，再下载 catalog；Global 保持直接请求
  `https://models.dev/api.json`。两者继续写入同一个 canonical snapshot/cache 结构。CN descriptor、catalog
  请求失败或超时时继续使用最新有效 local/bundled snapshot，不等待 gateway 后台刷新。
- CN descriptor 的两个地址只接受 `https://filecdn.minimax.chat` 默认端口、无 userinfo/query/hash，路径必须
  分别精确匹配 `/public/models-dev/catalog/<64 lowercase hex>/api.json` 与同一 SHA 的 `/logos/`；其他地址均按
  refresh 失败隔离，避免 gateway response 把 runtime 变成任意 URL fetcher。
- CN gateway descriptor 与镜像 catalog 请求均禁止自动跟随 HTTP redirect；任一 `3xx` 继续使用 snapshot
  fallback。Global 直连 `models.dev` 保持现有 redirect 行为。
- 每次 `listProviderPresets()` 都读取一次
  `common_config`，最多等待 600ms；当次 missing、失败、超时或无效时仅为当次请求回退本地 region 顺序，后续 list 可重新获得已恢复或更新后的 Apollo 配置。有效
  `[]` 同样是已解析结果；不持久化 Apollo last-known-good pins。
- 支持的 models.dev transport 为 `@ai-sdk/openai`、`@ai-sdk/openai-compatible`、
  `@ai-sdk/anthropic`、`@openrouter/ai-sdk-provider` 与 `@ai-sdk/google`，分别映射到现有
  `openai-responses`、`openai-completions`、`anthropic-messages`、`openai-completions`、
  `google-generative-ai`，其中 OpenRouter 专属 SDK 包按 OpenAI chat-completions 协议映射。
  `@ai-sdk/google-vertex` 使用 project/location 与 Google Cloud 凭据，不支持。只有原始 Provider
  ID 恰为 `openai`、`anthropic`、`openrouter` 或 `google` 且 `api` 缺失时，才使用官方 fallback
  base（Gemini 为 `https://generativelanguage.googleapis.com/v1beta`）；同 npm transport 的其他
  opaque Provider ID 必须提供合法 `api`。复用 `normalizeProviderBaseUrl`，禁止生成重复 `/v1` path。
- 只保留 `tool_call=true`
  的模型；无可用模型、未知 transport、非法 URL 或结构非法的 Provider 不进入 preset 列表。Provider
  ID 原样保留，模型按 display name 排序。parser 入口不维护 Provider denylist，四个 MiniMax
  Provider ID 与包含 MiniMax 模型的第三方聚合 Provider、managed MiniMax
  或用户手工 Provider 一样按通用规则解析。
- Apollo 复用现有 `common_config`，key 为 `agent_byok_pinned_provider_ids`；origin 从当前
  `@mavis/config` runtime preset 的 MiniMax API base URL 取 `URL.origin`，不新增 biz_gateway
  endpoint；models.dev 镜像 endpoint 与 Apollo 配置无关，也不复用 managed `models_config`。请求带 `client=desktop`、精确 `filter` 与
  `Accept`；配置存在时透传 trim 后的 preview secret 和现有三种 lane header。HTTP 成功但
  `statusInfo.code` 或 `base_resp.status_code` 非零仍视为失败。
- Apollo value 在 Apollo 中配置为 JSON array；runtime 接受 `common_config`
  返回的原生 array，也兼容内容为 array 的 JSON
  string。空 array 合法，代表不置顶。非 array、混入非 string 或空 string 时整项无效并回退本地 region 默认。有效 remote
  array 完全替换本地默认；重复 ID 保留第一次，未知 ID 忽略。
- 最终顺序为有效 pinned ID 顺序在前，其余 Provider 按 name 排序。Apollo missing、request
  failure、timeout 或 value 无效时使用对应 region 的本地列表：
  - CN：`zhipuai`、`deepseek`、`moonshotai-cn`、`openai`、`'anthropic'`
  - Global：`zai`、`deepseek`、`moonshotai`、`openai`、`'anthropic'`
- runtime 根据本次 catalog 的 `icon_base_url` 与 opaque `providerId` 生成最终 `iconUrl` 并通过可选 IDL
  字段返回。Electron 只消费这个 URL，不再按 region 自行拼接；字段缺失或图片加载失败时沿用
  `ConnectorLogo` fallback。TUI 复用同一个 runtime catalog，不新增第二套 icon catalog。

## IDL 增量

只新增 Electron 的 preset query；configured Provider 的 CRUD、candidate save 与 Codex OAuth HTTP
contract 均不变。

```thrift
struct ByokProviderPreset {
  1: required string provider_id
  2: required string name
  3: required string base_url
  4: required string api_format
  5: required list<UserModelInput> models
  6: optional string icon_url
}

struct ListByokProviderPresetsReq {
  255: optional base_rpc.BaseReq base_req
}

struct ListByokProviderPresetsResp {
  1: required list<ByokProviderPreset> presets
  255: optional base_rpc.BaseResp base_resp
}
```

`DesktopService.ListByokProviderPresets` 使用
`GET /minimax-desktop/api/v1/model-providers/presets`，由 generated client / server
entry 贯通；DesktopService implementation 只做 typed DTO mapping。

## Build vs buy

不新增 dependency。实现使用 Node.js 内置
`fetch`、`AbortSignal.timeout`、`URL`、`fs/promises`、`zlib`，并复用仓库已有 `@mavis/config`
与 filesystem retry helper。

## 自动化场景

| ID    | Scenario                                  | Given / When / Then                                                                                                                                                                                                                                                                               | Type             | Priority | Status  | Evidence target                                                                                |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- | ------- | ---------------------------------------------------------------------------------------------- |
| TS-1  | 离线启动可列出 preset                     | Given models.dev 无网络、bundled snapshot 有效且 Apollo 未决 / When owner 初始化并进行 list / Then 初始化与本地 catalog 不等待 models.dev network/runtime readiness；每次 list 最多等待 Apollo 600ms，当次失败按本地 region 顺序返回                                                              | unit             | P0       | covered | `provider-presets.service.test.ts`：本地首读、Apollo timeout/error fallback 断言；27/27 passed |
| TS-2  | 优先使用最新有效本地 snapshot             | Given bundled 与 dataDir cache 均存在 / When 读取 catalog / Then 选择 `updatedAt` 最新且可解析者；较新文件损坏时回退另一个有效 snapshot                                                                                                                                                           | unit             | P0       | covered | `provider-presets.service.test.ts` + `.repository.test.ts`：28/28 passed                       |
| TS-3  | 支持的 transport 正确映射                 | Given models.dev 中的 OpenAI、OpenAI-compatible、`@ai-sdk/anthropic` 与 `@openrouter/ai-sdk-provider` transport / When 解析 preset / Then API format 正确（OpenRouter 映射 `openai-completions`）；仅 canonical ID 可用官方 fallback，其他同 transport ID 必须提供合法 API；base URL 经 normalization 不出现重复 request path | unit             | P0       | covered | `provider-presets.service.test.ts`：transport/default/proxy assertions passed                  |
| TS-4  | 过滤不可用 Provider 与模型                | Given unsupported npm、非法或缺失的必需 URL、无 models、无 `tool_call=true` 模型以及 opaque provider ID / When 解析 / Then 不可用项被跳过，其他合法 opaque ID（含四个 MiniMax ID）、模型 capability 与 metadata 原样保留，preset DTO 不合成 persistence provenance              | unit/integration | P0       | covered | service parser assertions；delivery integration 保留 canonical Provider 与四个 MiniMax ID  |
| TS-5  | models.dev async refresh 成功             | Given 本地 snapshot 可用且远端返回 200 + valid catalog + ETag / When owner 初始化 / Then list 先返回本地结果，后台刷新后原子写入 cache，后续 list 使用新 snapshot；旧 snapshot 有 ETag 但没有 `iconBaseUrl` 时不发送该 ETag，强制一次 200 回填 icon metadata                                                | unit             | P1       | covered | `provider-presets.service.test.ts` + `.repository.test.ts`：refresh/atomic-write passed        |
| TS-6  | models.dev 304 与失败不破坏启动           | Given 远端分别返回 304、HTTP error、timeout、invalid JSON 或空 supported set / When detached refresh / Then 304 保留当前 snapshot；其他失败被隔离，cache 不被覆盖，runtime 仍可用                                                                                                                 | unit             | P0       | covered | `provider-presets.service.test.ts`：refresh success/failure boundary passed                    |
| TS-7  | CN 本地置顶顺序                           | Given Effective Product Region 为 CN 且 Apollo unavailable / When list 完成有界 pin resolution / Then 已确认 ID 按本地顺序置顶，MiniMax 不在本地置顶列表内、按 name 排序落入其余 Provider                                                                                                                    | unit             | P0       | covered | `provider-presets.service.test.ts`：CN ordering passed                                         |
| TS-8  | Global 本地置顶顺序                       | Given Effective Product Region 为 Global 且 Apollo unavailable / When list 完成有界 pin resolution / Then 已确认 ID 按本地顺序置顶，MiniMax 与 Tencent 不置顶，其他 Provider 按 name 排序                                                                                                     | unit             | P0       | covered | `provider-presets.service.test.ts`：Global ordering passed                                     |
| TS-9  | Apollo 有效列表完全替换默认               | Given 首次 Apollo 请求延迟返回有效 non-empty native array 或 JSON string array，含重复与未知 ID / When 仅调用一次 list / Then 首个 resolved result 不混入 region 默认，按第一次出现去重，忽略未知 ID，再追加 name-sorted remainder                                                                | unit             | P0       | covered | `provider-presets.service.test.ts`：两种返回形态的 delayed valid fetch 断言 passed             |
| TS-10 | Apollo 空列表表示无置顶                   | Given 首次 Apollo 请求延迟返回 native `[]` 或 string `"[]"` / When 仅调用一次 list / Then 首个 resolved result 中所有 Provider 仅按 name 排序，不回退本地 pin                                                                                                                                     | unit             | P0       | covered | `provider-presets.service.test.ts`：两种返回形态的 delayed empty fetch 断言 passed             |
| TS-11 | Apollo 无效或不可用时回退                 | Given key missing、request error、timeout、business status nonzero、非 array、mixed type 或 empty string / When list / Then 当次使用 Effective Product Region 本地默认且 catalog 可用；下一次 list 重新读取 Apollo 并可恢复配置顺序；请求使用 Desktop 参数和配置中的 preview/lane routing headers | unit             | P0       | covered | `provider-presets.client.test.ts`：9/9；service timeout/error fallback 与次次恢复 passed       |
| TS-12 | Electron generated preset query 贯通      | Given generated Desktop Service client / When 调用 `ListByokProviderPresets` / Then request 经过 v2 front door、allowlist 与 thin controller，返回 catalog 顺序、创建字段与可选最终 `icon_url`，不暴露 key、configured status、pin metadata 或 persistence provenance                                               | integration      | P0       | covered | IDL generation checks；controller 6/6 + mapper 3/3；app 51/51 + allowlist 21/21 passed         |
| TS-13 | Electron preset Save 不测试也不切换       | Given Electron 用 preset 全部模型与 API key 组装现有 candidate / When `modelId` absent、`skipConnectionTest=true`、`saveAndUse=false` 保存 / Then Provider 成功持久化，零网络请求，active/default model 不变，response 标记 skipped test                                                          | integration      | P0       | covered | `management/service.test.ts`：78/78 passed                                                     |
| TS-14 | Electron 现有 Codex OAuth 不回归          | Given 现有 Electron OAuth status/login route / When catalog query 加入 / Then route、feature gate、状态与 login 结果保持现状                                                                                                                                                                      | integration      | P1       | covered | `provider-auth.test.ts`：2/2；`codex-oauth.test.ts`：17/17 passed                              |
| TS-15 | TUI 与 Electron 使用同一 catalog          | Given 一个真实 shared owner/catalog result / When 分别经过 process-local TUI-facing adapter 与 Electron controller mapping / Then 可观察的 Provider/model/order/capability 输出一致，没有第二套 TUI parser                                                                                        | integration      | P0       | covered | `model-provider-preset-delivery.integration.test.ts`：1/1 behavioral parity passed             |
| TS-16 | TUI 第三方 Provider 流程不回归            | Given TUI 选择一个 preset 与一个 model / When 执行现有 save flow / Then 仍先测试连接、保存指定模型并切换；不继承 Electron 的 skip-test/no-switch 语义                                                                                                                                             | integration      | P0       | covered | TUI `feature-flow.test.ts`：24/24；`tui-provider-onboarding.test.ts`：8/8 passed               |
| TS-17 | TUI internal Codex OAuth 复用现有 manager | Given internal build / When process-local client 查询 status 并 start login / Then 调用与 Electron 相同的 `CodexOAuthManager`，已有 credential reconcile、in-progress 与错误语义保持一致                                                                                                          | unit/integration | P0       | covered | process-local 2/2 + CliService 13/13 + OAuth manager 17/17 passed                              |
| TS-18 | TUI 非 internal 包不开放 Codex OAuth      | Given standard/global 或 standard/CN build / When TUI 查询或启动 Codex OAuth / Then build identity 投影为 disabled 并 fail closed；没有独立 env override 或新 OAuth 状态机                                                                                                                        | unit             | P0       | covered | TUI `embedded-host.test.ts`：8/8 passed                                                        |
| TS-19 | runtime asset 只有一个 source of truth    | Given canonical gzip 位于 local-runtime-v2 且旧 TUI source 不存在 / When shared runtime asset copy 与 local-runtime-v2 npm package surface 被检查 / Then copied output 与 source 字节一致，runtime package 包含 `assets/models-dev-catalog.json.gz`，旧 TUI source 保持不存在                     | unit/build       | P1       | covered | repository 2/2（含 source-path）；asset 7/7，含 `npm pack --dry-run --json` guard              |
| TS-20 | CN mirror descriptor 信任边界             | Given descriptor 包含非法 scheme/host/userinfo/port/query/hash/path/SHA，或 gateway/catalog 返回 `3xx` / When CN runtime refresh / Then 不跟随 redirect，拒绝 catalog 请求并继续使用最新有效 local/bundled snapshot；Global direct models.dev 不受影响                                                   | unit             | P0       | covered | `provider-presets.client.test.ts` strict descriptor/redirect assertions + service fallback    |

## 手动验收边界

后端与 Electron preset 接入已实现，产品链路手测时分别确认：

- **Electron**：region 对应 preset 置顶；选择 preset + API key 可直接保存；四个 MiniMax
  preset 出现在列表中并可保存使用；保存不测试、不切换；已有 BYOK 编辑流程可继续修改。
- **TUI**：第三方 Provider 仍显式选模型并测试后切换；internal
  build 显示独立「连接 Codex」，非 internal build 不显示；共享 preset 列表同样包含四个 MiniMax
  ID。
- **Icon**：CN 后端 DTO 返回 gateway descriptor 对应 release 的最终 URL，Global 后端 DTO 返回
  models.dev URL；Electron 不做 region 拼接，URL 缺失或加载失败时显示 fallback。

本仓库不新增 E2E gate；最终证据使用 focused unit/integration、IDL generation 与外部产品链路手测。

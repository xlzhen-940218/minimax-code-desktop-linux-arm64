# Codex OAuth Local Runtime Test Scenarios

## Scope

支持当前 `local-runtime-v2 -> Pi` 链路中的 Pi 原生 `openai-codex/*` 模型。无需迁移旧 `openai/gpt-5.5`
配置，也不复活 OpenCode 插件链路。

## Design Note

改动 seam 放在 `LocalModelResolver`：它已经是 `IAgentConfig.model` 转成 Pi `LLMModelConfig`
的集中模块。UI 与配置使用 `custom_provider:openai-codex` 作为选择标识，resolver 调用 Pi 时恢复为
`openai-codex`。给 resolver 注入一个最小的 provider auth getter；默认 host adapter 用 Pi
`AuthStorage` 从 `<dataDir>/codex-auth.json` 读取/刷新 `openai-codex` OAuth token。普通 API key
provider 和 MiniMax managed auth 保持现状。

所有桌面构建环境和发布包在配置缺省时默认开启入口，可用 `beta.codexOAuth: false` 显式关闭。Local
Runtime V2 的 Model System 持有浏览器 OAuth 过程，授权完成后把模型目录写入标准的
`custom_provider.openai-codex`；UI 只接收授权地址和连接状态。已有 provider 继续沿用原模型表，凭据始终留在
`codex-auth.json`。

Dependency decision: no new dependency. Reuse existing workspace dependency
`@earendil-works/pi-coding-agent` and its `AuthStorage`.

## 当前 v2 维护入口

- OAuth manager：`packages/local-runtime-v2/src/service/model-system/codex-oauth.ts`。
- 模型解析：`packages/local-runtime-v2/src/service/model-system/resolution/local-model-resolver.ts`。
- Provider store 集成：`packages/local-runtime-v2/test/integration/migrated-codex-auth-provider-store.e2e.integration.test.ts`（fixture token 与历史 host adapter，不证明浏览器授权或真实模型调用）。

相关验证入口（从仓库根目录执行；本轮文档迁移未运行）：

```bash
node scripts/test/focused-vitest.mjs --package @mavis/local-runtime-v2 src/service/model-system/codex-oauth.test.ts src/service/model-system/resolution/local-model-resolver.test.ts test/integration/migrated-codex-auth-provider-store.e2e.integration.test.ts
```

## 历史 Scenarios

下表 `covered` 与旧测试名保留原验收记录。本轮只迁移文档并校对入口，没有重跑 OAuth、UI、
配置或模型测试。旧目录中的 `local-model-resolver.test.ts` 和
`codex-auth-provider-store.e2e.test.ts` 已退役，当前维护入口见上文。

| ID    | Scenario                                     | Given / When / Then                                                                                                                                                                                                                                                                                                                            | Type     | Priority | Status  | Evidence                                                                                                                                                                                                   |
| ----- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-1  | Resolves Codex OAuth token                   | Given `agentConfig.model.provider` is `custom_provider:openai-codex` and `<dataDir>/codex-auth.json` contains valid OAuth credentials / When `LocalModelResolver.resolveModel()` runs / Then it returns a Pi model using provider `openai-codex`, API `openai-codex-responses`, Codex backend base URL, and the OAuth access token as `apiKey` | unit/e2e | P0       | covered | `local-model-resolver.test.ts`: resolves Codex OAuth token from provider auth getter; `codex-auth-provider-store.e2e.test.ts`: resolves through real `LocalRuntimeApiHost` and `<dataDir>/codex-auth.json` |
| TS-2  | Refreshes expired Codex token                | Given `openai-codex` OAuth credentials are expired and refresh succeeds through Pi `AuthStorage` / When resolving the model / Then the returned `apiKey` is the refreshed access token and updated credentials are persisted by Pi storage                                                                                                     | unit     | P0       | covered | `local-model-resolver.test.ts`: refreshes expired Codex OAuth token through Pi `AuthStorage`                                                                                                               |
| TS-3  | Fails closed without Codex login             | Given provider is `custom_provider:openai-codex` but no stored OAuth credentials exist / When resolving the model / Then the resolver throws a clear login-required error for `openai-codex`, not a generic `openai` API key error                                                                                                             | unit     | P0       | covered | `local-model-resolver.test.ts`: fails closed with a Codex login-required error when OAuth auth is missing                                                                                                  |
| TS-4  | Rejects hardcoded Codex API keys             | Given `custom_provider.openai-codex` contains `apiKey` alongside OAuth metadata / When Pi OAuth auth lookup returns empty / Then the resolver ignores that key and throws the login-required error                                                                                                                                             | unit     | P0       | covered | `local-model-resolver.test.ts`: rejects configured Codex API keys when OAuth auth is missing                                                                                                               |
| TS-5  | Preserves existing API key providers         | Given a non-Codex provider has configured `options.apiKey` and `options.baseURL` / When resolving the model / Then existing API key/base URL behavior is unchanged                                                                                                                                                                             | unit     | P0       | covered | `local-model-resolver.test.ts`: preserves configured API key providers without calling Codex auth getter                                                                                                   |
| TS-6  | Preserves MiniMax managed auth               | Given MiniMax managed provider config uses `managed-login` / When resolving the model / Then Electron access token headers and managed base URL normalization remain unchanged                                                                                                                                                                 | unit     | P0       | covered | `local-model-resolver.test.ts`: injects the synced Electron access token for managed provider URLs                                                                                                         |
| TS-7  | Does not migrate legacy OpenCode model IDs   | Given model provider is old `openai` with `gpt-5.5` and no `apiKey` / When resolving the model / Then resolver does not silently map it to `openai-codex`; it fails using the existing provider config rules                                                                                                                                   | unit     | P1       | covered | `local-model-resolver.test.ts`: does not migrate legacy OpenAI `gpt-5.5` model IDs to Codex OAuth                                                                                                          |
| TS-8  | Hides the experimental connection entry      | Given any desktop package explicitly sets `beta.codexOAuth: false` / When UI hydrates runtime flags and `POST /provider-auth/openai-codex` is called / Then UI hides the button and Runtime returns `FEATURE_DISABLED`                                                                        | unit     | P0       | covered | `runtime-flags.test.ts`: strict UI hydration; `packages/local-runtime-v2/src/service/model-system/codex-oauth.test.ts`: hidden status and 404 route response                                                                                                  |
| TS-9  | Starts browser OAuth                         | Given the feature is enabled and the provider has no stored credentials / When the connection route starts login / Then it returns the browser URL with `pending`, writes no token into the response, and becomes `connected` after the callback                                                                                               | unit     | P0       | covered | `packages/local-runtime-v2/src/service/model-system/codex-oauth.test.ts`: pending browser URL and connected transition; `UsageSettings.model-reorder.test.tsx`: system-browser launch                                                                         |
| TS-10 | Creates the OAuth provider                   | Given OAuth completes or reusable credentials already exist / When the manager ensures provider configuration / Then `custom_provider.openai-codex` uses `kind: oauth` and `authMode: oauth` and prefills catalog model identity, context, output, modalities, and thinking efforts                                                            | unit     | P0       | covered | `packages/local-runtime-v2/src/service/model-system/codex-oauth.test.ts`: credential reuse and catalog prefill; `list-local-runtime-models-byok.test.ts`: OAuth provider classification; both Local Runtime resolvers record the `oauth` route                |
| TS-11 | Preserves an existing model table            | Given `custom_provider.openai-codex.models` already has user configuration / When OAuth attaches to that provider / Then the manager keeps the existing model table and merges OAuth metadata into the provider                                                                                                                                | unit     | P1       | covered | `packages/local-runtime-v2/src/service/model-system/codex-oauth.test.ts`: existing model table preservation                                                                                                                                                   |
| TS-12 | Keeps configured models usable after opt-out | Given `custom_provider.openai-codex` is configured and `beta.codexOAuth` is explicitly false / When Runtime lists models / Then the provider remains available while the settings entry stays hidden                                                                                | unit     | P1       | covered | `list-local-runtime-models-byok.test.ts`: lists the OAuth provider without a beta gate; `runtime-flags.test.ts`: hides the entry                                                                           |

所有桌面包的默认开启和显式开关由 `packages/config/test/config.test.ts` 覆盖，包括配置解析与 Electron 的 `config.yaml` 读取路径。

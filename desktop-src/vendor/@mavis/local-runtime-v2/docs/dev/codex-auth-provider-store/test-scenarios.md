# Codex Auth Provider Store Test Scenarios

## 当前 v2 维护入口

Provider OAuth 状态与授权流程由
`packages/local-runtime-v2/src/service/model-system/codex-oauth.ts` 负责，模型解析由
`packages/local-runtime-v2/src/service/model-system/resolution/local-model-resolver.ts` 负责。
凭据仍保存到当前 profile 的 `<dataDir>/codex-auth.json`，配置与凭据分离的约定不变。

相关验证入口（从仓库根目录执行；本轮文档迁移未运行）：

```bash
node scripts/test/focused-vitest.mjs --package @mavis/local-runtime-v2 src/service/model-system/codex-oauth.test.ts src/service/model-system/resolution/local-model-resolver.test.ts test/integration/migrated-codex-auth-provider-store.e2e.integration.test.ts
```

其中 `migrated-codex-auth-provider-store.e2e.integration.test.ts` 是保留历史 host adapter 的
本地集成用例，使用 fixture token；文件名中的 `e2e` 不代表真实浏览器授权或远端模型验证。

## 历史场景与证据

下表保留原 `covered` 状态和测试名。旧 `codex-auth-provider-store.e2e.test.ts`、
`local-api-host.test.ts` 与旧目录下的 `local-model-resolver.test.ts` 已退役；
当前入口见上文，不把历史结果转记为本轮 v2 通过，也不将旧 `LocalRuntimeApiHost` 当作产品启动入口。

| ID   | Scenario                                | Given / When / Then                                                                                                                                                                                                                                                     | Type     | Priority | Status  | Evidence                                                                                                                                                                                                         |
| ---- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-1 | Reads Codex OAuth from provider store   | Given `<dataDir>/codex-auth.json` contains `openai-codex` OAuth credentials / When `LocalRuntimeApiHost` resolves `custom_provider:openai-codex/gpt-5.5` / Then the resolved Pi model uses provider `openai-codex`, that token, and the Codex backend base URL            | e2e      | P0       | covered | `codex-auth-provider-store.e2e.test.ts`: resolves the configured Codex model through real `LocalRuntimeApiHost` and Pi `AuthStorage`                                                                             |
| TS-2 | Stops reading agent-scoped auth         | Given only `<dataDir>/agents/mavis/auth.json` contains `openai-codex` OAuth credentials and `<dataDir>/codex-auth.json` is missing / When resolving `custom_provider:openai-codex/gpt-5.5` / Then resolution fails with the login-required error                      | unit     | P0       | covered | `local-api-host.test.ts`: does not read Codex auth from the agent scoped auth store                                                                                                                              |
| TS-3 | Refreshes through provider store        | Given `<dataDir>/codex-auth.json` contains expired `openai-codex` OAuth credentials that Pi `AuthStorage` can refresh / When resolving `custom_provider:openai-codex/gpt-5.5` / Then the refreshed access token is returned and persisted back to `codex-auth.json`     | unit     | P0       | covered | `local-api-host.test.ts` covers the host `codex-auth.json` store path; `local-model-resolver.test.ts` covers refresh and persistence through Pi `AuthStorage`                                                    |
| TS-4 | Fails closed without Codex login        | Given no usable `openai-codex` credentials exist in `<dataDir>/codex-auth.json` / When resolving `custom_provider:openai-codex/gpt-5.5` / Then resolver throws `openai-codex login required`                                                                            | unit     | P0       | covered | `local-model-resolver.test.ts`: fails closed with a Codex login-required error when OAuth auth is missing                                                                                                        |
| TS-5 | Leaves non-Codex providers unchanged    | Given a non-`openai-codex` provider uses API-key credentials from model/provider config / When resolving that model / Then provider auth storage is not used and the existing credential path still works                                                               | unit     | P1       | covered | `local-model-resolver.test.ts`: preserves configured API key providers without calling Codex auth getter                                                                                                         |
| TS-6 | Keeps provider config out of auth store | Given `config.yaml` contains `custom_provider.openai-codex` and `defaultModel: custom_provider:openai-codex/gpt-5.5` / When local-runtime starts / Then model/provider config is read from config and OAuth secrets are read only from `codex-auth.json`                | e2e/unit | P1       | covered | `codex-auth-provider-store.e2e.test.ts` covers provider/model config without token plus OAuth secrets from `codex-auth.json`; `packages/local-runtime-v2/src/service/model-system/codex-oauth.test.ts` confirms provider updates contain no access or refresh token |
| TS-7 | Reuses stored login from the UI entry   | Given `codex-auth.json` already contains `openai-codex` and the experimental entry is enabled / When the user clicks Connect Codex OAuth / Then Runtime creates or repairs `custom_provider.openai-codex` without launching a second login                              | unit     | P1       | covered | `packages/local-runtime-v2/src/service/model-system/codex-oauth.test.ts`: stored credential path skips `AuthStorage.login` and writes the provider catalog                                                                                                          |

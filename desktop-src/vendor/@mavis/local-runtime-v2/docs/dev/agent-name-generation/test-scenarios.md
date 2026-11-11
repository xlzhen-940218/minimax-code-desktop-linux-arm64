# Test Scenarios — agent name generation & validation fix

## 当前 v2 维护入口

命名与创建校验由 `packages/local-runtime-v2/src/service/agent/domain/names.ts` 的
`resolveCreatedAgentName` / `validateLookupName` 负责；历史兼容错误契约位于
`packages/local-runtime-v2/src/infra/legacy-db/agent-contract.ts`，不能将旧
`readCreateAgentName` 路径直接套到该文件。

相关验证入口（从仓库根目录执行；本轮文档迁移未运行）：

```bash
node scripts/test/focused-vitest.mjs --package @mavis/local-runtime-v2 test/unit/agent/domain/names.test.ts test/unit/agent/application/agent-application.test.ts
```

## 历史场景与证据

以下分支、旧符号、错误码、测试名与 `covered` 状态保留原修复记录，不代表本轮 v2 验收。
旧 `test/unit/local-agent-contract.test.ts` 已退役；当前对应命名测试见上文，不能视为
TS-1–TS-9 的逐项重新通过。TS-7 原记录已注明 permission-port 断言仍待扩展。

Branch: `hotfix/agent-name-generation` (base: preview_train)
Spec: auto-generated agent names must satisfy the system-wide strict pattern
`^[a-z][a-z0-9_-]*$` (enforced by permissions/rules.ts, api/host-helpers.ts,
skills/api.ts, skills/hub-api.ts). Root cause: `readCreateAgentName()` in
`packages/local-runtime/src/agent/contract.ts` generated `${timestampMs}${hex4}`
names that start with a digit, bricking every tool call / cron / skill for such
agents. Create-path validation must also reject explicit non-conforming names
(parity with main's zod `AgentNameParam`). Lookup paths (get/update/delete/
agentExists) must stay lenient so existing dirty agents remain deletable.

| ID | Scenario | Given / When / Then | Type | Priority | Status | Evidence |
|---|---|---|---|---|---|---|
| TS-1 | Auto-generated name is conformant | Given a CreateAgentReq without `name` / When `readCreateAgentName` runs / Then result matches `^agent-[0-9a-f]{12}$` | unit | P0 | covered | `test/unit/local-agent-contract.test.ts` — "TS-1: auto-generated name matches agent-<12 hex chars>" |
| TS-2 | Auto-generated name passes system-wide strict pattern | Given an auto-generated name / When tested against `^[a-z][a-z0-9_-]*$` (the pattern used by permissions/rules.ts, host-helpers.ts, skills/api.ts, skills/hub-api.ts) / Then it passes | unit | P0 | covered | `test/unit/local-agent-contract.test.ts` — "TS-2: auto-generated name passes system-wide strict pattern" |
| TS-3 | Explicit valid name accepted | Given `name: "backend-worker"` / When createAgent validation runs / Then name is accepted unchanged | unit | P0 | covered | `test/unit/local-agent-contract.test.ts` — "TS-3: explicit valid name accepted unchanged" |
| TS-4 | Digit-leading explicit name rejected | Given `name: "1783396372673a56b"` / When createAgent validation runs / Then LocalAgentContractError 400 VALIDATION_ERROR | unit | P0 | covered | `test/unit/local-agent-contract.test.ts` — "TS-4: digit-leading explicit name rejected with 400 VALIDATION_ERROR" |
| TS-5 | Uppercase / CJK / space names rejected on create | Given `name: "后端牛马"`, `"MyAgent"`, `"a b"` / When createAgent validation runs / Then LocalAgentContractError 400 for each | unit | P0 | covered | `test/unit/local-agent-contract.test.ts` — "TS-5: uppercase, CJK, and space names rejected on create" |
| TS-6 | Over-length name rejected (regression guard) | Given a 65-char name of otherwise-valid chars / When createAgent validation runs / Then 400 (existing MAX_AGENT_NAME_LENGTH behavior preserved) | unit | P1 | covered | `test/unit/local-agent-contract.test.ts` — "TS-6: over-length name (65 chars) rejected on create" |
| TS-7 | E2E: new agent's tool permission check works | Given an agent created through `AgentApplication.create` with only a CJK displayName / When `LocalPermissionRuleStore.listRules({ agentName })` runs with the created name / Then no `Invalid agent name` error is thrown | integration | P0 | covered | `packages/local-runtime-v2/test/unit/agent/application/agent-application.test.ts` — AgentApplication create/update contract; add the permission-port assertion when this scenario is next expanded |
| TS-8 | Dirty legacy agent still deletable (lookup stays lenient) | Given a store row with agent name `1783396372673a56b` / When `deleteAgent({ name })` runs / Then it succeeds without a 400 | unit | P0 | covered | `test/unit/local-agent-contract.test.ts` — "TS-8: dirty legacy agent name passes validateAgentName (used by delete/get/update)" |
| TS-9 | displayName preserved with auto-generated name | Given a create request with only CJK displayName / When createAgent runs / Then name is auto-generated and displayName stored verbatim | unit | P1 | covered | `test/unit/local-agent-contract.test.ts` — "TS-9: displayName preserved verbatim when name is auto-generated" |

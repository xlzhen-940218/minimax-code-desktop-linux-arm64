# Hide MCP Skills Legacy Config Test Scenarios

## Scope

当前实现以 local-runtime-v2 为准，兼容旧 daemon 留下的 MCP 配置文件；这不恢复 daemon 执行链。
执行 MCP server 由 MCP service 负责；隐藏 generated MCP proxy skill 只用于 runtime skill 注入和 prompt catalog。
`mcp-<server-id>` 是 MCP sync 生成 proxy skill 的保留命名；只有命中已配置 MCP server name 的
`mcp-*` slot 会从 runtime 注入面隐藏，未命中的 `mcp-*` skill 仍按普通 skill 显示。

## 当前 v2 Dependency Shape

- MCP 配置读取：`packages/local-runtime-v2/src/service/mcp/runtime/config-file.ts`。
- Skill 过滤：`packages/local-runtime-v2/src/service/skill/registry/registry.ts`。
- Skill registry 消费装配层注入的 `readMcpServerNames` capability，不直接 import MCP 内部 helper。
  UI 和 `DesktopService` 不做 `mcp-*` 兜底过滤。

相关验证入口（从仓库根目录执行；本轮文档迁移未运行）：

```bash
node scripts/test/focused-vitest.mjs --package @mavis/local-runtime-v2 test/integration/skill/local-skill-registry-provider.integration.test.ts
```

## 历史场景与证据

下表 `PASS`、`covered`、命令和原依赖路径保留原修复记录。旧 `@mavis/local-runtime` 的
unit / typecheck / E2E 命令已退役，当前验证应使用上面的 v2 integration 入口；
历史 TS-6 的直接 helper import 关系已由 capability 注入替代。这里的历史 E2E 不构成当前门禁，
本轮没有重新验证 DesktopService 或真实端到端链路。

| ID | Scenario | Given / When / Then | Type | Priority | Status | Evidence |
|---|---|---|---|---|---|---|
| TS-1 | Legacy-only MCP config hides generated proxy skills | Given `<dataDir>/mcp/mcp.json` contains `mcpServers.playwright` and `<dataDir>/skills` contains `mcp-playwright` / When `listRuntimeSkills` and `renderCatalog` run / Then `mcp-playwright` is absent from runtime injection and catalog | unit | P0 | covered | PASS: `mise exec -- pnpm --filter @mavis/local-runtime exec vitest run --config vitest.config.ts test/unit/local-skill-registry-provider.test.ts` |
| TS-2 | Skill management still exposes hidden proxy skill | Given the same legacy-only setup as TS-1 / When `listSkills`, `getSkillDetail`, `listSkillFiles`, `readSkillFile`, or `readSkillByName` runs / Then `mcp-playwright` remains readable for management and debugging | unit | P0 | covered | PASS: `mise exec -- pnpm --filter @mavis/local-runtime exec vitest run --config vitest.config.ts test/unit/local-skill-registry-provider.test.ts` |
| TS-3 | Current primary MCP config path keeps existing behavior | Given `<dataDir>/mcp.json` contains `mcpServers.playwright` and there is no legacy file / When runtime skill list and catalog are rendered / Then `mcp-playwright` is hidden exactly as before | unit | P0 | covered | PASS: `mise exec -- pnpm --filter @mavis/local-runtime exec vitest run --config vitest.config.ts test/unit/local-skill-registry-provider.test.ts` |
| TS-4 | Primary and legacy server names are combined for hiding | Given `<dataDir>/mcp.json` contains `github`, `<dataDir>/mcp/mcp.json` contains `playwright`, and skills include `mcp-github`, `mcp-playwright`, and `mcp-cli` / When runtime skill list and catalog are rendered / Then `mcp-github` and `mcp-playwright` are hidden, while unmatched `mcp-cli` remains visible | unit | P1 | covered | PASS: `mise exec -- pnpm --filter @mavis/local-runtime exec vitest run --config vitest.config.ts test/unit/local-skill-registry-provider.test.ts` |
| TS-5 | Invalid or missing MCP config fails open | Given MCP config is missing, malformed, or contains non-object server entries / When runtime skill list and catalog are rendered / Then the provider does not throw and does not hide `mcp-*` skills for invalid entries | unit | P1 | covered | PASS: `mise exec -- pnpm --filter @mavis/local-runtime exec vitest run --config vitest.config.ts test/unit/local-skill-registry-provider.test.ts` |
| TS-6 | MCP config path knowledge is not duplicated in skill filtering | Given skill registry needs MCP server names / When implementation is inspected and typechecked / Then path resolution lives in the MCP config helper, `skills/registry.ts` imports that helper, and no UI or `DesktopService` filter is added | static/typecheck | P1 | covered | PASS: `mise exec -- pnpm --filter @mavis/local-runtime typecheck`; code review: `skills/registry.ts -> mcp/config-file.ts -> mcp/config.ts` |
| TS-7 | DesktopService runtime roster hides legacy MCP proxy skills only | Given `<dataDir>/mcp/mcp.json` contains `playwright` and `github`, and the configured skill root contains `mcp-playwright`, `mcp-github`, `mcp-cli`, and `regular-skill` / When `ListRuntimeSkills` is called through `LocalRuntimeApiHost` and the DesktopService client / Then `mcp-playwright` and `mcp-github` are absent, while `mcp-cli` and `regular-skill` remain; `ListSkills` still exposes the hidden proxy skills | e2e | P0 | covered | PASS: `mise exec -- pnpm --filter @mavis/local-runtime exec vitest run --config vitest.config.ts test/e2e/mcp-runtime-skill-filter.e2e.test.ts` |

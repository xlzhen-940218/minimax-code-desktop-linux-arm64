# Root Cause Patterns（local-runtime-v2）

先收集证据，再用本页收敛结论。每个结论都必须保留不确定性。

## Patterns

### 1. “Session 不存在、状态不对或看似卡住”

- Evidence：native `mavis({ command: "session get", args: { session_id: "<session_id>" } })`
  的状态、更新时间、所属 Agent；bakery 的 `metadata.json` 和 `ledger.tail.jsonl`。
- Likely cause：Session 仍在执行、已失败、已完成但 UI 未刷新，或持久化 history/ledger 尚未更新。
- Next check：用时间窗关联同一 Session 的 `runtime.log`；不要先查 legacy DB 或转换 `ses_`。

### 2. “回答、工具调用或工具结果与预期不一致”

- Evidence：`messages.tail.jsonl` 与 `display.tail.jsonl` 的事件顺序，及相同 Session
  ID 的 runtime 日志。
- Likely cause：history 已记录的上下文/工具结果、当前 plugin/MCP 配置，或 runtime 处理流程导致。
- Next check：先确认实际 history，再用 runtime log 排查 plugin/MCP；不把旧 local-proxy
  payload 当成 v2 的唯一事实。

### 3. “Permission denied / command blocked / sandbox issue”

- Evidence：history 中的 tool call 与 `runtime.log` 的 `permission|approval|deny|abort|tool`
  时间窗。
- Likely cause：permission gate 或 approval
  owner 拒绝/不可用；v2 设计在缺少批准能力时会 fail-closed。
- Next check：关联 trace-id 或 Session ID，确认是 policy/gate 还是工具本身失败。

### 4. “Runtime 无法启动、owner 冲突或所有 Session 都异常”

- Evidence：`mavis doctor --json` 的 owner、mode、warnings、dataDir，和 `runtime-*.log`
  的启动时间窗。
- Likely cause：runtime owner、配置/认证、迁移/恢复、端口/路由或底层资源问题。
- Next check：从 runtime doctor 返回的真实路径与 trace-id 出发；不要读取其他 profile 的默认目录。

### 5. “Plugin、MCP 或 Skill 看起来没有生效”

- Evidence：当前 Session history、runtime 日志中的 `plugin|mcp|skill`
  线索，以及当前 Agent/plugin 配置。
- Likely cause：能力未暴露、插件/MCP 初始化失败、配置不匹配，或模型未选择调用已暴露的工具。
- Next check：先区分“工具没有出现在当前能力面”与“出现了但模型没有调用”；两者需要不同修复。

### 6. “Provider 请求失败、慢或成本异常”

- Evidence：runtime logs/events；仅在存在且 schema 已确认的情况下，再使用 local-proxy compatibility
  trace。
- Likely cause：认证、provider、限流、网络或请求级异常，也可能是本地 runtime 重试/队列。
- Next check：按状态、时间窗、trace-id 与 Session history 关联；不要从 history 长度推断 token 用量。

### 7. “这是迁移前的历史 Session”

- Evidence：v2 Session/manifest 缺失，但 migration records 或用户提供的 legacy `ses_` /
  daemon-era 文件存在。
- Likely cause：该数据属于 legacy import source，而不是当前 v2 canonical Session。
- Next check：明确标记 `Scope: legacy`；不要用 legacy 观察结果断言当前 v2 行为。

## Reporting discipline

使用以下结构：

- `Evidence`: 路径、时间、Session 状态、trace-id 或精确日志行。
- `Inference`: 证据支持的最窄解释。
- `Uncertainty`: 未找到的 runtime/event/history 证据，或仅有兼容 trace 的部分。
- `Conclusion`: 不超过证据范围的根因判断。
- `Next action`: 一个确认命令或一个具体修复步骤。

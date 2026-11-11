# Global Triage（local-runtime-v2）

没有明确 Session
ID，或问题影响 runtime 启动、多个 Session、权限、插件/MCP、渠道或 observability 时使用本手册。

## Start with runtime truth

先运行：

```bash
mavis doctor --json
```

JSON 顶层包含 `requestSurface` 与 `runtime`；记录并使用
`.runtime.runtimeOwner`、`.runtime.runtimeMode`、`.runtime.paths.dataDir`、`.runtime.observability.runtimeLogDir`、`.runtime.observability.runtimeEventsDir`、provider/auth 状态和 warnings。不要从
`$HOME/.minimax` 猜测 profile，也不要展示配置中的密钥。

## Triage order

1. 明确范围：启动 / HTTP 路由 / Session / permission / plugin-MCP / channel / provider / storage。
2. 确认 runtime owner 与实际 `dataDir`。
3. 先查 v2 runtime 日志和 event，再转到一个具体 Session 的 history / ledger。
4. 将 HTTP `trace-id` 与日志中的 `ctx.traceId` 关联；不要仅按关键词跨所有 profile 搜索。

## Primary v2 surfaces

### Runtime engineering logs

```bash
LOG_DIR="{{DATA_DIR}}/v2/observability/logs"
ls -t "$LOG_DIR"/runtime-*.log "$LOG_DIR"/im-runtime-*.log 2>/dev/null | head
rg -n 'ERROR|WARN|startup|recovery|permission|approval|plugin|mcp|owner|lease' \
  "$LOG_DIR"/runtime-*.log "$LOG_DIR"/im-runtime-*.log
```

用于：runtime owner、启动/关闭、队列/恢复、权限 gate、插件/MCP、IM/channel 事件。

### Structured runtime events

```bash
EVENT_DIR="{{DATA_DIR}}/v2/observability/events"
find "$EVENT_DIR" -type f -name '*.jsonl' -print | tail -20
rg -n 'ERROR|WARN|<session_id>|<trace_id>' "$EVENT_DIR"
```

用于：结构化事件的时间线与 trace 关联。目录为空不代表 runtime 没有运行；先回看 `runtime doctor`
的路径和日志配置。

### Session persistence

```bash
mavis-session-log --data-dir {{DATA_DIR}} <session_id>
```

用于：确认当前 Session 的持久化 history、ledger 和 display 事件。具体流程见 `session-playbook.md`。

### Optional compatibility trace

`{{DATA_DIR}}/logs/local-proxy-*.jsonl`
仅当文件实际存在时才可检查。它不是 v2 运行所必需的日志，也不能替代 runtime logs、events 或 Session
artifacts。详见 `local-proxy-recipes.md`。

## Global questions and first evidence

| 问题                                      | 首选证据                                                          |
| ----------------------------------------- | ----------------------------------------------------------------- |
| runtime 未启动、owner 冲突、路由/端口不对 | `mavis doctor --json` + `runtime-*.log`                           |
| 启动迁移或数据恢复失败                    | runtime 日志 + `v2/sqlite/runtime-state.sqlite` 的完整性/迁移证据 |
| 多个 Session 同时异常                     | runtime 日志 / events 的共同时间窗与 trace-id                     |
| permission / approval / tool gate 异常    | runtime 日志，随后定位具体 Session history                        |
| plugin、MCP、工具清单异常                 | runtime 日志，随后 Session history 和当前插件/MCP 配置            |
| provider、模型或请求级延迟                | runtime 日志；兼容 trace 存在时再补充 local-proxy                 |
| IM/channel 收发异常                       | `im-runtime-*.log` + runtime 日志                                 |

## Escalate to a session

发现具体 Session ID 时，切换到 `session-playbook.md`：先调用 native
`mavis({ command: "session get", args: { session_id: "<session_id>" } })`，再按需生成 bakery。不要继续用全局日志推测单个对话实际看到了什么。

# Log Surfaces（local-runtime-v2）

当不确定证据应该在哪里查时使用。本表以当前 v2 数据目录合同为准。

| Surface                                                                          | Contains                                                                        | Missing / limits                       | Best for                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------- |
| native `mavis({ command: "session get", args: { session_id: "<session_id>" } })` | 当前 Session 元数据与状态                                                       | 完整 history、底层日志                 | 首次确认目标 Session 与状态      |
| `mavis-session-log` bakery                                                       | v2 Session 的安全元数据投影、history/ledger/display 尾部、关联 runtime/event 行 | 完整大文件、没有 Session ID 的全局问题 | 单 Session 的第一轮诊断          |
| `v2/sessions/.../manifest.json`                                                  | Session identity 与持久化路径                                                   | 业务事件细节                           | 定位正确 history / ledger        |
| `messages.jsonl` / `display.jsonl`                                               | canonical history 与展示事件                                                    | runtime owner、provider 细节           | 对话、工具调用、用户可见行为     |
| `ledger.jsonl`                                                                   | 持久化事件顺序与提交事实                                                        | 详细工程日志                           | turn、恢复、状态演进             |
| `v2/observability/logs/runtime-*.log`                                            | runtime 生命周期、plugin/MCP、队列与恢复；权限检查只留警告和报错                | 完整对话内容                           | 为什么 runtime 做出某个动作      |
| `v2/observability/logs/sessions/<session_id>/runtime-MM-DD.log`                  | 该 Session 的权限检查日志：逐层判断、裁决、权限设置、执行门结果，按天分文件     | 没有 Session ID 的记录；保留 7 天，总量超 512MB 先删最旧的 | 某次工具调用为什么放行/询问/拒绝 |
| `v2/observability/logs/im-runtime-*.log`                                         | IM/channel 适配器事件                                                           | 普通 runtime 全景                      | 收发、渠道、bridge 故障          |
| `v2/observability/events/**/*.jsonl`                                             | 结构化 runtime event 与 trace 关联                                              | 未落盘或被保留策略清理的事件           | 时间线、跨 surface 关联          |
| `logs/local-proxy-*.jsonl`（若存在）                                             | 兼容 provider trace                                                             | 非 v2 必需，字段/留存不保证            | 已验证存在时补 provider 请求信息 |

## Decision rules

- 先确认 Session 是否存在、当前状态和所属 Agent：native
  `mavis({ command: "session get", args: { session_id: "<session_id>" } })`。
- 需要知道当前对话、工具结果、turn 顺序：Session artifacts；先 bakery，再窄读源文件。
- 需要知道启动、恢复、MCP 或插件为什么发生：`runtime-*.log`，必要时用 trace-id 关联 events。
- 需要知道某次工具调用的权限为什么这样判：`logs/sessions/<session_id>/`（bakery 的 `session-runtime.log`）。
- 需要排查 IM/channel：`im-runtime-*.log` 与同一时间窗的 runtime log。
- 需要 provider HTTP 细节：只有 local-proxy trace 确认存在时才使用它。
- `mavis doctor --json` 返回的 observability 路径优先于任何硬编码目录。

## Common mistake patterns

- 用 legacy `sqlite.db`、`framework_session_id` 或 `ses_` 映射查询 v2 Session。
- 因为没有 local-proxy 文件就断言没有模型请求或 runtime 事件。
- 把 `messages.jsonl` 的历史内容当作 provider token 或真实 HTTP payload。
- 只读 runtime log，却不确认具体 Session 的持久化状态与 history。
- 直接读取完整 history、ledger、event 或日志文件，将不必要的用户内容带入上下文。

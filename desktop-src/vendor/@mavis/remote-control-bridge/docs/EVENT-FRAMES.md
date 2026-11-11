# RC Global Event frame catalog

Global Events 由 Electron adapter 从 generated DesktopService endpoint
`GET /minimax-desktop/api/v1/events` 读取，经 `@mavis/shared/global-events` 准入后，以结构化 event
source 注入 Bridge。公开事件集合及前后端 payload 类型只定义在 shared contract；Bridge
package 不依赖 shared/thrift，本文件只记录 RC WebSocket 的映射规则。

| Global Event                                                    | RC frame                  | payload 处理                                                          |
| --------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `permission.ask`                                    | `evt.permission.ask`      | 专用 permission payload；携带 `turn_id`；RC turn 内可带 `in_reply_to` |
| `permission.resolved`                               | `evt.permission.resolved` | 专用 permission payload；RC turn 内可带 `in_reply_to`                 |
| `session.created/start/title_updated/model_updated/queue.updated` | 同名 `evt.*`              | `event-frame-mapper.ts` 转为 snake_case                               |
| `session.compaction.started/completed/failed`       | 同名 `evt.*`              | `event-frame-mapper.ts` 转为 snake_case                               |
| `rotation.completed`、`message.rewind`              | 同名 `evt.*`              | `event-frame-mapper.ts` 转为 snake_case                               |
| `thread_goal.updated/cleared`                       | 同名 `evt.*`              | `event-frame-mapper.ts` 转为 snake_case                               |
| `questionnaire.ask/dismiss/superseded`              | 同名 `evt.*`              | `ask` 从 `requester.runId` 携带 `turn_id`；request 使用 JSON carrier  |
| `agent.created/updated`                             | 同名 `evt.*`              | `event-frame-mapper.ts` 转为 snake_case                               |
| 其他 catalog 内事件                                 | 同名 `evt.*`              | `makeBusEventFrame` 做浅层 snake_case，并加入 `ts_ms`                 |

catalog 外事件在 Electron adapter 的 `decodeGlobalEventFrame` 被丢弃，不存在 generic internal-event
fallback。

所有非 permission frame 都是 broadcast，不携带
`in_reply_to`。大多数事件在 WebSocket 断连时直接丢弃；`permission.ask`、`questionnaire.ask`、`session.finish`
例外，会进入有界、按请求或 turn 去重的内存缓存并在重连后发送。断连期间若收到匹配的
`permission.resolved`、 `questionnaire.dismiss` 或
`questionnaire.superseded`，Bridge 会先撤销已缓存的 ask，避免重连后恢复已经失效的交互。`stop()`
会清空缓存，防止解绑、切换账号或进程退出后跨生命周期重放。手机端仍应忽略尚未识别的公开 event
type，并在收到状态变化事件后读取权威 query。

`stream-pump.ts` 生成的 `evt.session.message`、`evt.session.message_chunk` 和 `evt.session.turn_end`
属于 session turn stream，不属于 Global Events catalog。
同一 producer WebSocket 可承载多个 consumer 对同一 session 的 `send` / `resume` 请求；每条请求以
`cmd.id` 独立维护流，响应帧用 `in_reply_to` 返回该 ID。`cmd.session.stop` 会结束该 session 的所有活动请求流，
WebSocket 断开会结束该连接上的所有流。

## Composer intent

`evt.session.composer_mode_changed` 是 Desktop renderer 主动发送的临时 UI 同步事件，payload 为
`{ session_id, mode }`，其中 `mode` 取 `default | goal | plan`。它不属于 Global Events
catalog，断连时不缓存，也不得修改 `Session.interactionMode`。

手机端通过 `cmd.session.update` 的 `interaction_mode`
数值字段反向同步同一临时意图；Bridge 只把它投递给 Desktop renderer，不转发到 Desktop Session
PATCH。选择 Plan 后，只有下一条消息携带 `clientIntent=plan-entry` 并在 admission
transaction 中接纳成功，Plan 才成为持久运行状态。

### RC 问卷 v2

`questionnaire.ask` 保留 `delivery_reason` 与完整 `request_json`：客户端只对 `created` 的新问卷自动展开，缺少来源的旧事件按恢复处理。`questionnaire.state` 属于公共事件目录，经通用 `evt.*` 转发；嵌套 `state` 保留 Runtime 原始字段，客户端规整后合并。

RC 前端复用问卷 presentation 状态机：异步问卷收起及来源回合结束后仍可从对话入口回答，终态事件关闭入口；同步问卷遵循 `syncWaiting`。恢复通过 RC `pending?include_unanswered=true` 获取全部未答问卷，提交与不确定结果核对也必须走 RC 路由。旧桌面没有 `responseMode` 的问卷保持原行为；Web 云会话不启用本地/RC presentation。

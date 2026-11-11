# RC Global Events 上行

状态：当前设计

Remote Control Bridge 只转发前后端共享的 Global Events，不再订阅或透传后端内部事件。

```text
local-runtime
  -> GET /minimax-desktop/api/v1/events
  -> Electron adapter
       -> generated DesktopService client
       -> @mavis/shared/global-events decoder + catalog admission
  -> injected AsyncIterable<RcGlobalEvent>
  -> Remote Control Bridge mapping / lifecycle
  -> evt.<global event type> WebSocket frame
  -> gateway / mobile
```

## 边界

- `@mavis/shared/global-events` 的 `GlobalEventPayloadMap`
  是公开事件唯一来源，目前共 25 类；在 RC 链路中只由 Electron host adapter 引用，不成为
  `@mavis/remote-control-bridge` 的依赖。
- Electron adapter 用 generated client 负责 SSE 请求、分帧、wire field 转换和关闭连接，并用 shared
  decoder 忽略 heartbeat、非法 frame 和 catalog 外事件。因此 `memory.*`、`mcp.*`、`cron.*`
  等后端内部事件无法进入 Bridge。
- Bridge 只依赖 `AbortSignal -> AsyncIterable<RcGlobalEvent>`
  这一结构化 port，继续拥有 retry、WS 生命周期、permission routing 和 frame
  mapping；它不维护第二套 SSE parser 或跨端 schema。
- `stream-pump.ts` 的 parser 仍服务 session message stream，与 Global Events 无关，继续保留。

## 上行语义

- frame type 为 `evt.<global event type>`；gateway 在广播出口去掉 `evt.`。
- permission 事件在 RC command turn 内可携带 `in_reply_to`；其他 Global Events 始终作为广播发送。
- Bridge 不做通用 replay 或持久化 ring
  buffer。普通状态事件在 WebSocket 断开时仍直接丢弃，重连后由客户端读取权威状态。
- 仅 `permission.ask`、`questionnaire.ask`、`session.finish`
  三类通知触发事件使用进程内临时缓冲：按 request/turn 去重，最多保留 100 条，WS 握手成功后补发。
- 主动断开、解绑、账号切换、泳道切换和进程停止会调用 `stop()`
  清空临时缓冲，不会把旧绑定或旧账号的事件发到新连接。
- 日志只记录 event type、session/turn/request id 和投递结果，不记录 payload 内容。

## 生命周期

- `start()` 幂等开启注入的 event source；Electron adapter 首次迭代时才创建 generated client 请求。
- runtime stream 结束或失败后按固定间隔重连。
- `stop()` abort source；adapter 关闭 generated stream，Bridge 停止重连。

验证命令：

```bash
pnpm --filter @mavis/remote-control-bridge test
pnpm --filter @mavis/remote-control-bridge typecheck
```

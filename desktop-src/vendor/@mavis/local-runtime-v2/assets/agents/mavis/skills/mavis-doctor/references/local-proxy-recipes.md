# Local-proxy Compatibility Trace

`local-proxy-*.jsonl` **不是 local-runtime-v2 的默认诊断前提**。只有在实际 `dataDir` 下存在该文件，且你确认它来自待排查 runtime/profile 时，才使用本页补充 provider trace。

不要将以下 legacy 假设带入 v2：`ses_` ID 映射、`sqlite.db.sessions.framework_session_id`、所有请求都具有相同 `reqBody` / `respBody` schema，或没有 local-proxy 文件就表示 runtime 没有执行请求。

## Preflight

```bash
LOG_DIR="{{DATA_DIR}}/logs"
find "$LOG_DIR" -maxdepth 1 -type f -name 'local-proxy-*.jsonl' -print | head
```

若没有文件，停止此路线，转用 v2 runtime logs、events 与 Session artifacts。若存在，先窄读一条以确认 schema：

```bash
FIRST_LOG=$(find "$LOG_DIR" -maxdepth 1 -type f -name 'local-proxy-*.jsonl' -print | head -1)
sed -n '1p' "$FIRST_LOG" | jq 'keys'
```

## Session filtering

v2 会将当前 Session ID 原样随请求传播；不进行 `mvs_ → ses_` 映射。仅在确认 trace 中有该 header 时使用：

```bash
jq -c --arg sid '<session_id>' \
  'select((.headers?["x-mavis-session-id"] // "") == $sid)' \
  "$LOG_DIR"/local-proxy-*.jsonl
```

先检查输出数量、时间戳和 URL，再根据**已验证**的字段写专用 jq。不要直接复用旧版对 `.reqBody.messages`、`.respBody` 或 `sseChunks` 的固定解析。

## Safe use

- 先用 v2 history / ledger 确认 Session，再用 trace 补 provider 时间线、HTTP 状态或请求上下文。
- 只在所需时间窗和 Session ID 上过滤；完整 proxy trace 往往包含其他对话和敏感提示词。
- streamed response 是否、如何落盘取决于当前 trace 格式；缺少文本不能直接判定“回答丢失”。
- 将 trace 结论标为兼容证据；runtime logs、events 和持久化 Session artifacts 才是 v2 默认事实面。
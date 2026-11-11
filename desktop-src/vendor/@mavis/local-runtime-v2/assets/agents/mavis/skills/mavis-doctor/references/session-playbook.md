# Session Playbook（local-runtime-v2）

用于排查一个已知的当前 MiniMax Code Session。当前主标识通常是 `mvs_...`，但应把用户提供的 Session
ID 视作不透明值；不要把它转换为 `ses_`，也不要查询 legacy `framework_session_id`。

## Standard flow

1. 先调用 native `mavis({ command: "session get", args: { session_id: "<session_id>" } })`
   查询当前 Session：确认它存在、所属 Agent、状态、父子关系、更新时间和 workspace。
2. 若需要持久化证据，确认实际 `dataDir`（优先 `mavis doctor --json` 的
   `.runtime.paths.dataDir`）。加载技能时返回的是
   `Location: files:///.../mavis-doctor/SKILL.md` URI；先解码 URI，再取父目录并运行：

```bash
SKILL_LOCATION='<exact Location value returned by the skill tool>'
SKILL_DIR="$(node -e '
  const { dirname, sep } = require("node:path");
  const { fileURLToPath } = require("node:url");
  const location = process.argv[1];
  const skillPath = /^files?:/u.test(location)
    ? fileURLToPath(location.replace(/^files:/u, "file:"))
    : location;
  const skillDir = dirname(skillPath);
  process.stdout.write(process.platform === "win32" ? skillDir.split(sep).join("/") : skillDir);
' "$SKILL_LOCATION")"
command -v mavis-session-log >/dev/null \
  || bash "$SKILL_DIR/install.sh"

mavis-session-log --data-dir {{DATA_DIR}} <session_id>
```

3. 先读 bakery 的 `README.md`、`metadata.json`、`source-paths.txt`，再按问题读取限量摘录。

## v2 evidence map

| 问题                             | 首选证据                                                                         | 观察什么                                             |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Session 是否存在、当前状态、归属 | native `mavis({ command: "session get", args: { session_id: "<session_id>" } })` | status、agent、workspace、更新时间、父子关系         |
| 持久化 Session 记录              | `metadata.json`                                                                  | v2 `local_runtime_sessions` 的安全投影               |
| 对话/工具调用/工具结果           | `messages.tail.jsonl`、`display.tail.jsonl`                                      | 最后 200 条历史或展示事件                            |
| 提交顺序、turn/恢复事实          | `ledger.tail.jsonl`                                                              | 末尾 ledger 事件及时间顺序                           |
| 运行时失败、队列、插件/MCP       | `runtime.log`                                                                    | 与 Session ID 匹配的 `runtime-*`/`im-runtime-*` 日志 |
| 权限放行、询问、拒绝             | `session-runtime.log`                                                            | 该 Session 自己的权限检查日志（逐层判断、裁决）      |
| 结构化 runtime 事件              | `events.jsonl`                                                                   | 与 Session ID 匹配的 v2 event JSONL                  |
| 原始完整 history                 | `source-paths.txt` 中的 `messages.jsonl`                                         | 仅在摘要不足且用户允许时窄读                         |

## Symptom drills

### 卡住、没有完成、重复或恢复异常

- 先查 native Session 状态；区分仍在执行、已失败、已完成和已归档。
- 对照 `ledger.tail.jsonl` 的最后事件与 `runtime.log` 中相邻时间窗。
- 若只有历史工件、没有 runtime 日志，结论只能是“持久化到了哪里”，不能推定 provider、权限或队列根因。

### 回答不对、工具未调用或工具结果污染

- 对照 `messages.tail.jsonl` 与 `display.tail.jsonl`：确认实际 user / assistant / tool 事件顺序。
- 用 native Session 查询和对应 Agent 配置确认当时的 Agent；再查看 `runtime.log` 中相同 Session
  ID 的 plugin/MCP 线索。
- 不要使用旧 `local-proxy` 的 system/tools
  JSON 推断 v2 暴露面；只有兼容 trace 实际存在时才能补充它。

### 权限拒绝、命令被阻断、sandbox 异常

- 在 history 中定位触发的 tool call 和时间。
- 用 `runtime.log` 按 Session ID 和时间窗检索 `permission|approval|deny|abort|tool`。
- 当前 v2 permission gate 采取 fail-closed；没有匹配的运行时证据时，不要把它归因成模型能力问题。

### 慢、昂贵或上下文异常

- 先用 native Session 查询确认近期状态，再检查 ledger / history 的末尾事件和最新 runtime 日志。
- 如需 provider 请求时序或 token 明细，只有在兼容 `local-proxy-*.jsonl` 存在且字段经确认后才进入
  `local-proxy-recipes.md`。
- 不要将 history 文件大小或上下文长度直接等同于 provider token 用量。

## Safe inspection

```bash
DIR="${TMPDIR:-/tmp}/mavis-session-log/<session_id>"

cat "$DIR/README.md"
cat "$DIR/metadata.json"
cat "$DIR/source-paths.txt"
sed -n '1,120p' "$DIR/messages.tail.jsonl"
tail -n 80 "$DIR/ledger.tail.jsonl"
tail -n 120 "$DIR/runtime.log"
```

避免直接读取完整 `messages.jsonl`、`ledger.jsonl`、`display.jsonl`、`snapshot.json`
或整天的 runtime 日志。先用 `tail`、`sed`、`jq` 和精确时间窗缩小范围。

## Hand back to user

默认只回传结论与摘录路径。完整 history / ledger / runtime
log 可能含敏感内容；仅在用户明确需要原始证据时才以文件交付，并说明包含的范围。

---
name: mavis-doctor
description: >-
  Diagnose current MiniMax Code local-runtime-v2 sessions, runtime startup, permissions, plugins,
  and observability. Load when a user supplies a session id, asks for logs/root cause, or reports a
  stuck run, retry, permission, recovery, plugin, or runtime failure. Keywords: 排查, 调试, 卡住,
  为什么, 日志, log, debug, inspect, retry, recovery.
descriptions:
  zh-Hans:
    '排查 MiniMax Code v2
    session、runtime、权限、插件和可观测性问题，基于当前持久化与运行时证据定位根因。'
---

# Mavis Doctor

以证据诊断，不用 daemon / OpenCode 时代的假设猜测当前行为。默认目标是 **MiniMax Code
local-runtime-v2**；只有明确在排查迁移前的历史数据时，才将 legacy 数据作为兼容来源。

## 当前 v2 事实

- 当前 Session 的主标识来自 `local_runtime_sessions.session_id`。原生创建通常生成
  `mvs_...`，但诊断时将 ID 视为不透明值；不要假定存在 `ses_` 对应关系。
- v2 主数据库是 `{{DATA_DIR}}/v2/sqlite/runtime-state.sqlite`，Session 表是
  `local_runtime_sessions`。旧的 `{{DATA_DIR}}/sqlite.db` 和 `sessions.framework_session_id`
  仅属于 legacy 数据。
- 单个 Session 的持久化证据位于
  `{{DATA_DIR}}/v2/sessions/.../`：`manifest.json`、`messages.jsonl`、`ledger.jsonl`、`display.jsonl`、`snapshot.json`。
- 工程日志位于 `{{DATA_DIR}}/v2/observability/logs/`（`runtime-*`、`im-runtime-*`）；带 Session ID 的权限检查日志
  按 Session、按天写在 `logs/sessions/<session_id>/runtime-MM-DD.log`；事件位于
  `{{DATA_DIR}}/v2/observability/events/`。
- `local-proxy-*.jsonl`
  不是 v2 的默认诊断前提。若运行时恰好保留它，只能作为兼容 trace，先确认文件和字段真实存在。

先用当前 runtime 的 `dataDir`，而不是猜测默认目录：可运行 `mavis doctor --json` 并读取
`.runtime.paths.dataDir`，或采用 `<agent-context>` 中的
`dataDir`。诊断输出不得展示 token、cookie、API key 或完整私有配置。

## Route

- 一个明确的 Session ID / “查本轮”：先调用 native
  `mavis({ command: "session get", args: { session_id: "<session_id>" } })` 获取状态和元数据，再读
  `references/session-playbook.md`。
- 启动、认证、运行时归属、dataDir 或全局故障：先运行 `mavis doctor --json`，再读
  `references/global-triage.md`。
- 需要定位对话、工具结果、历史文件或回放差异：读 `references/session-playbook.md`。
- 已有日志/工件，需要把症状收敛成根因：读 `references/root-cause-patterns.md`。
- 不确定证据应落在哪个面：读 `references/log-surfaces.md`。
- 仅当 `local-proxy-*.jsonl` 实际存在时，读 `references/local-proxy-recipes.md`；它不是默认入口。

## Session bakery bootstrap

`mavis-session-log` 会基于 v2 SQLite 和 v2 Session
artifacts 生成一个**只读、有限摘录**的诊断目录。它不再解析 legacy `ses_` ID，也不依赖
`LOCAL_PROXY=1`。

加载本技能时，native `skill` 工具会在正文前返回
`Location: files:///.../mavis-doctor/SKILL.md`。这是 URI，不是可以直接传给 shell
的路径；用 Node 标准库完成 URI 解码并取父目录。不要直接对 URI 调用 `dirname`，也不要猜测
dataDir 中的技能副本路径。

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

若 `{{DATA_DIR}}/bin` 不在 PATH，直接调用：

```bash
# 复用上面从 Location URI 解码得到的 SKILL_DIR。
"$SKILL_DIR/bin/mavis-session-log" \
  --data-dir {{DATA_DIR}} <session_id>
```

先读生成目录中的 `README.md`、`metadata.json` 和 `source-paths.txt`，再按问题打开
`messages.tail.jsonl`、`ledger.tail.jsonl`、`display.tail.jsonl`、`runtime.log` 或
`events.jsonl`。不要把完整 history、ledger 或日志直接 `cat` 到上下文中。

## Hard rules

- 有 Session ID 时，先调用 native
  `mavis({ command: "session get", args: { session_id: "<session_id>" } })`；需要文件证据时再运行 bakery。不要从 SQLite 猜测 Session 状态。
- `ses_`、`framework_session_id`、`daemon-*.log`、`plugin-*.log`、`opencode-*.log`
  仅可作为用户明确指定的 legacy 调查线索，不能当作 v2 默认路径。
- 历史文件和运行时日志可能包含用户内容；先摘要、限行和脱敏，只有用户明确需要时才交付原始文件。
- `mavis diagnostics bundle`
  会创建诊断包，可能包含敏感日志；仅在用户明确同意创建或上传诊断包后使用。
- 缺少某个日志文件不等于没有发生过该行为：先检查 `mavis doctor --json` 返回的
  `.runtime.paths.dataDir`、`.runtime.runtimeOwner` 和 `.runtime.observability`。
- 结论必须区分已验证事实、推断和未验证部分；不要把兼容 trace 的缺失当作 v2 行为不存在的证据。

## Output contract

- `Scope`: session / runtime / permission / plugin-mcp / observability / legacy / uncertain
- `Evidence`: 原生 session 状态、工件路径、时间戳、结构化日志或 API 返回
- `Conclusion`: 证据支持的最窄根因
- `Uncertainty`: 仍未证明的假设或缺失证据
- `Next action`: 一个最小确认或修复步骤

若使用 bakery，返回其生成的目录及相关**摘录**文件；除非用户明确索取，不要自动发送完整历史或原始日志。

## Platform compatibility

bakery 为 Bash 脚本，要求 `jq`、`sqlite3`
和 Bash：macOS/Linux/WSL 可直接运行；Windows 原生 PowerShell 请通过 Git
Bash 或 WSL 执行。缺少工具时，先说明缺失项和安装方式；不要改用旧
`sqlite.db`、旧日志目录或不相关的 profile 兜底。

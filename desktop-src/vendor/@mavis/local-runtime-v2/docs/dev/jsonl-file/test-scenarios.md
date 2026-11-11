# Canonical History JSONL 场景契约

本文固定 `@mavis/local-runtime-v2/canonical-history`
的文件能力边界与回归场景。该子路径只提供 path-based 数据源和 canonical history
codec；它不解析 profile/dataDir、不打开 SQLite，也不拥有 Session writer lane 或 migration marker。

## 数据契约

- 每行是一个严格的 history
  envelope：`message_id`、`turn_id`、`message`，以及仅允许出现在每个 turn 第一条 user
  message 上的可选 `turn_config`。
- `message.timestamp` 必须是有限数；写入前递归拒绝
  `undefined`、非有限数、稀疏数组、循环引用、accessor、symbol、非 plain
  object 以及数组额外属性，禁止静默丢字段。
- `turn_config.model` 先统一大小写及 snake/camel/hyphen 分隔，再递归移除单数/复数 credential-bearing
  key（含 OAuth 裸 `access` / `refresh` 与任意 `headers` 容器）；已知 provider usage/config
  metadata（含 token details/limits）保留，未知 token-bearing key 默认拒绝；tool
  schema 是用户声明的数据结构，不按 credential 名称误删。
- revision 是递归 key-sort 后 canonical JSON 的 `sha256:<hex>`。
- 完整 history 校验 message/tool-call identity、相邻完整 tool call/result pairing、compaction
  boundary 与 turn-config anchor。增量 append 允许 tool call 与结果分两次提交，但只继承合法的 EOF
  pending call。
- active revision/replace 允许唯一的 EOF pending tool round；strict revision/replace 仍要求全部 tool
  result 已闭合。

## Source 选择

首次迁移只选择一个权威源，不拼接：

1. 已存在的 target（空文件也具有权威性）；
2. authoritative ledger snapshot（空 snapshot 也具有权威性）；
3. SQLite row projection；
4. SQLite blob；
5. empty。

被选中的源读取失败直接失败，不降级到低优先级源。source 读取和数据转换由未来的 Session
owner 注入；本模块不自行定位旧文件或数据库。

## 文件语义

| 场景           | 契约                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| active read    | 逐行容错；空行、坏 JSON/codec 失败均上报并跳过，不因一条坏行拒绝整个 active history                               |
| strict read    | 任一坏行携带 path、1-based line number 与原因并 fail closed                                                       |
| first publish  | 同目录 `0600` staging 完整 write/fsync/close/validate 后以 no-replace hard link 发布；竞态胜出的 target 始终权威  |
| append         | caller 必须持有 per-session 串行 lane；短写可确认时回滚，无法确认落盘结果时抛出 `JsonlAppendCommitUncertainError` |
| replace        | 同目录临时文件写入并校验后原子 rename；Windows transient rename 仅按固定窗口重试                                  |
| active replace | 仅供 Session owner 恢复 active projection；允许合法 EOF pending tool round，仍原子校验/rename                     |
| snapshot       | no-replace 发布；相同 revision 重试幂等，不覆盖已存在 snapshot                                                    |
| compaction     | 先发布旧 active snapshot，再严格验证并原子替换 active；容错读取中幸存的 envelope 原样进入 snapshot                |

目录 fsync 在平台不支持时 best-effort；文件内容与文件 handle 的 fsync 失败不被吞掉。任何失败路径都不得删除竞态创建的 authoritative
target。

Session owner 在两种读取模式之间保持明确边界：

- durable mutation 的 post-commit `readActive` 保留合法 pending/partial tool round，使 assistant
  tool-call 与 tool result 的分段提交可以继续完成；
- Agent execution 的 `read` 必须返回 settled history。未配对尾部、invalid tool-call identity、orphan
  result、缺少必要字段或 tool name 不匹配的 call/result pair，以及 interrupted tool
  round 只在处置唯一时恢复；恢复前发布 hash-addressed
  snapshot，随后原子 replace 并记录不含正文/参数的诊断；
- tolerant read 跳过的空行、坏 JSON/codec 行按 path + line 去重上报；Session
  owner 必须把幸存 envelope
  snapshot-first 原子重写回 active 文件，后续进程重启不能再次遇到同一坏行；
- duplicate identity、compaction/turn-config 冲突和不确定写入继续 fail closed。

## 自动化覆盖

- `src/infra/file/jsonl.test.ts`：严格/容错读取、无损 JSON、权限、first-publish 竞态、短写恢复、commit-uncertain、临时文件校验、原子替换、rename
  retry 与清理。
- `src/infra/file/canonical-history-jsonl.test.ts`：envelope/turn config、credential
  scope、revision、sequence、single-source selection、active tolerant semantics、incremental
  append、active replace、snapshot/compaction。
- `src/service/session-system/messages/history/canonical-history-recovery.test.ts`：pending/partial
  tool round、malformed call、结构不完整或 name 不匹配的 result、orphan/duplicate
  result、interrupted round 与 ambiguous identity。
- `test/integration/canonical-history-tool-round.integration.test.ts`：真实 JSONL
  provider 与 AgentHost durable store 的 split commit、`record 3` 原失败形态、restart
  recovery、snapshot 与原地重写闭环。
- `test/architecture/dependency-gate.architecture.test.ts`：独立 package subpath 的精确 value/type
  export、Knip production entry，以及 Electron 根 facade 不扩张。

修改这些能力时至少运行上述三个测试文件、`check:dead-code`、`check:architecture`、typecheck、lint、build 与 diff
coverage。

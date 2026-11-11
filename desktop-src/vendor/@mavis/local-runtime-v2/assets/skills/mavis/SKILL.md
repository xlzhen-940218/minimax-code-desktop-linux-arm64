---
name: mavis
description: >-
  Manage MiniMax Code agents, sessions, memory, MCP settings, IM routing, and
  skills. Use for inspecting or changing runtime configuration, reading session
  history, rotating sessions, choosing memory scope, or maintaining built-in
  skills. Read only the reference matching the operation.
descriptions:
  zh-Hans: 管理 MiniMax Code 的智能体、会话、记忆、MCP、IM 路由和技能；按操作读取对应参考文档。
---

# MiniMax Code runtime management

本技能负责 MiniMax Code 的智能体、会话、记忆、MCP 配置、IM 路由和技能管理。按当前操作读取对应参考文档。

Most operations go through the native `mavis` tool (a model tool, not a shell command):

```text
mavis({ command: "<group> <action>", args: { ... } })
```

Groups: `agent`, `session`, `mcp`. `agent_name: "me"` resolves to the current agent. Call
`mavis({ command: "<group> help" })` for the full arg reference. The `mcp` group manages current-
profile MCP server settings; read `references/mcp.md` before configuring or changing a server.
Memory goes through the native `memory` tool; skills load through the native `skill` tool. Do not shell out to a `mavis` CLI for any of these surfaces
— agents must not invoke it. Sole temporary exception: IM routing (`references/im.md`) still
operates through the `mavis im` CLI until a native IM surface ships; follow that reference as
written.

Custom Hooks are configured through a local Plugin. Load `plugin-creator` for that task;
standalone user or Agent hook files are no longer supported.

## Capability Map

| Area                        | What it covers                                                                                                   | Read when you need                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `user-guide`                | User-facing MiniMax Code usage / configuration questions, config entry points, delegation map                           | answer “怎么配置 MiniMax Code / MiniMax Code 支持什么 / xxx 怎么用”             |
| `agent`                     | Agent inventory, config, identity, visible skills                                                                | inspect or update an agent; discover what an agent can use        |
| `session-and-communication` | Session lifecycle, message history, status semantics, rotation, delegation / result reporting                    | inspect sessions; understand rotation; track delegated work       |
| `memory`                    | User / agent / project memory, topic files, cleanup model, what belongs where                                    | write memory correctly; read or structure long-term memory        |
| `mcp`                       | Current-profile MCP server settings and their read/write safety boundary                                         | inspect, create, update, enable, disable, or delete an MCP server |
| `im`                        | Feishu / Telegram bridge status, route rules, defaults, session strategy selection                               | control how inbound chats map to agents and sessions              |
| `skill-management`          | Skill inventory, visibility, installation, file-level create/update/delete/copy, source/runtime locations        | list, inspect, install, or manage skill files                     |
| `windows-tool-bootstrap`    | Git Bash requirement, tool detection + auto-install (python, jq, poppler, etc.), bash invocation from PowerShell | any skill script fails on Windows due to missing tools            |

## Read Map

- Need user-facing “怎么用 / 怎么配置 MiniMax Code” questions, runtime basics, or delegation to a more
  specialized skill -> `references/user-guide.md`
- Need agent inspection, identity, or skill discovery -> `references/agent.md`
- Need session lifecycle, history, rotation, or delegation / result reporting ->
  `references/session-and-communication.md`
- Need to decide whether something belongs in agent / user / project memory ->
  `references/memory.md`
- Need to inspect, add, update, enable, disable, or delete current-profile MCP server settings ->
  `references/mcp.md`
- Need to route Feishu or Telegram inbound traffic to the right agent/session strategy ->
  `references/im.md`
- Need to list, inspect, install, create/update/delete/copy skill files ->
  `references/skill-management.md`
- Need to install missing tools on Windows (Git Bash, Python, jq, poppler, etc.) or invoke bash
  scripts from PowerShell -> `references/windows-tool-bootstrap.md`

## Minimal Examples

Native tool calls are platform-independent — the same call shape works on macOS, Linux, and Windows.

- Inspect an agent: `mavis({ command: "agent get", args: { agent_name: "me" } })`
- List recent sessions: `mavis({ command: "session list", args: { agent_name: "me" } })`
- Read session history:
  `mavis({ command: "session messages", args: { session_id: "<sessionId>", limit: 20 } })`
- Continue a delegated task asynchronously by its `task_id` (see
  `references/session-and-communication.md`): `task_append({ task_id: "<taskId>", content: "..." })`
- Deliver a message to an existing local session without waiting:
  `mavis({ command: "session send", args: { session_id: "<sessionId>", content: "Continue with the follow-up requirement." } })`
- Ask and wait in one call — decide up front, because a second send is a new message, not a wait:
  `mavis({ command: "session send", args: { session_id: "<sessionId>", content: "What did you conclude?", sync: true } })`
- List current-profile MCP servers: `mavis({ command: "mcp list", args: {} })`
- Inspect an MCP server: `mavis({ command: "mcp get", args: { name: "docs" } })`
- Create an MCP server after the user explicitly requests or approves it:
  `mavis({ command: "mcp create", args: { name: "docs", transport: "streamable-http", url: "https://example.com/mcp", enabled: true } })`
- Append agent memory:
  `memory(target=main, operation=append, content="### <topic> (<date>)\nType: feedback\n<lesson>")`
  (see `references/memory.md`)

## Rule

涉及本技能列出的智能体、会话、记忆、MCP 配置、IM 路由或技能管理时，读取对应参考文档。
维护这些能力的使用说明时更新现有参考文档，保持同一操作只有一个说明来源。

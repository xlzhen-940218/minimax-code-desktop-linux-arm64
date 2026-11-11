# User Guide

本指南用于智能体、会话、记忆、MCP 配置、IM 路由和技能管理相关的使用与配置问题。根据问题读取对应引用文件。

## What Mavis is

Mavis is a self-hosted multi-agent runtime. It manages local-runtime lifecycle, agents, sessions,
memory, MCP server settings, IM routing, and skills. The default data directory is `{{DATA_DIR}}/`. Agents
operate it through native tools (`mavis`, `memory`, `skill`) and file edits — there is no CLI to
shell out to.

## Delegation Map

| User question                                 | What to do                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 添加新模型 / provider / API key               | Edit `{{DATA_DIR}}/config.yaml` provider section directly (see Config + Runtime Quick Guide below)                                                                                                                                                                                                                                                             |
| 接入新的 MCP server                           | Configure directly in `{{DATA_DIR}}/mcp.json` and validate via MiniMax Code's built-in MCP tooling; no dedicated builtin skill is shipped for onboarding.                                                                                                                                                                                                          |
| 已有 MCP 的 list / tools / call / auth / sync | Use MiniMax Code's built-in MCP tooling (or edit `{{DATA_DIR}}/mcp.json` directly) to list / call / sync MCP servers and tools; no dedicated builtin skill is shipped.                                                                                                                                                                                          |
| 飞书 / Lark 业务操作                          | Delegate to `lark-tools`                                                                                                                                                                                                                                                                                                                                   |
| 创建 / 改进一个 skill                         | Delegate to `skill-creator`                                                                                                                                                                                                                                                                                                                                |
| worktree / 运行位置 / 分支开发流程            | Guide the user to start a new chat and pick the desired run location / worktree in the UI. The current chat's run location cannot be changed. If the user explicitly asks the agent to create or switch a worktree from the command line, follow the current repo's docs or the user's command; do not load a built-in worktree workflow skill by default. |
| MR / CI / review gate                         | Delegate to `gitlab-mr-review`                                                                                                                                                                                                                                                                                                                             |
| 手动测试 / 验收测试                           | Delegate to `manual-test`                                                                                                                                                                                                                                                                                                                                  |
| agent / session / memory / IM 路由     | Read the matching `mavis` reference below                                                                                                                                                                                                                                                                                                                  |

## Read the Matching Mavis Reference

- agent / identity / visible skills -> `references/agent.md`
- session lifecycle / rotation / delegation -> `references/session-and-communication.md`
- memory scope / topic files / cleanup -> `references/memory.md`
- IM route rules / defaults / bridge status -> `references/im.md`
- skill management -> `references/skill-management.md`

## Config + Runtime Quick Guide

Configuration is file-based:

- config file is usually `{{DATA_DIR}}/config.yaml` (providers, API keys, model whitelist)
- MCP servers live in `{{DATA_DIR}}/mcp.json`
- profile-specific data lives under `{{DATA_DIR}}-<profile>/`
- changing config affects new sessions; old sessions keep their existing runtime context until they
  rotate

The runtime lifecycle is owned by the MiniMax Code app (or the embedded CLI runtime), not by
daemon commands. If the runtime seems down or a config change needs a full reload, restart the
MiniMax Code app instead of hunting for a daemon command.

For detailed semantics, read the matching reference instead of duplicating it here:

- agent details -> `references/agent.md`
- session / rotation -> `references/session-and-communication.md`
- memory -> `references/memory.md`

## User-Facing Execution Flow

When the user says “帮我配置 / 帮我修改 / 帮我加上 …”:

1. Match the capability to the right skill or `mavis` reference.
2. Explain what will be changed.
3. Ask for confirmation before destructive or write operations.
4. Execute via the native tools (`mavis` / `memory` / `skill`) or direct file edits.
5. Verify with the matching read call (`agent get`, `session list`, file read) and tell
   the user when it takes effect.

## Scope Boundary

- 智能体、会话、记忆、MCP 配置、IM 路由和技能管理问题 -> 读取对应的 `mavis` 引用文件
- Questions about developing the Mavis codebase itself -> use repo docs / engineering skills instead

## Troubleshooting

| Symptom                                    | Cause / Fix                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Local runtime not responding               | Restart the MiniMax Code app; check you are on the right profile (profile data lives under `{{DATA_DIR}}-<profile>/`)     |
| Config / model change not taking effect    | Old sessions keep old config; open a new session, or rotate the session from the app UI                            |
| New model not in picker                    | Missing from `provider.<x>.whitelist` in config.yaml                                                               |
| Feishu message hitting wrong agent         | Read `references/im.md`; adjust route rule `priority` or bind the chat id                                           |
| Long session is slow                       | Compress or rotate the session from the app UI (see `references/session-and-communication.md`)                      |
| Deeper issues (SQLite lock, runtime error) | Read local-runtime logs under `{{DATA_DIR}}/logs/` (or `{{DATA_DIR}}-<profile>/logs/`)                                       |

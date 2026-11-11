# Local MiniMax Plugin Subagent Reference

Use this reference only for MiniMax-format local Plugins under
`{{DATA_DIR}}/plugins/<plugin-directory>/`. MiniMax Code also imports Agents from compatible
third-party Plugin formats, but the local Creator authors `.minimax-plugin/plugin.json` and the
MiniMax Agent contract below.

## When to use a subagent

Add a subagent when the work benefits from its own context window, a specialized role with its own
system prompt, a narrower tool set, or parallel delegation. Typical examples are a reviewer, a
researcher that reads many files, or a verifier that must not see the main conversation.

Prefer a Skill when the main Agent should reuse a procedure inside the current conversation. A
subagent does not see the parent conversation and returns only its final answer, so do not use one
for a step that needs the user's live context.

## Manifest and file layout

Declare each subagent in the optional manifest `agents` array:

```json
{
  "agents": ["agents/reviewer.md"]
}
```

Every entry must match `^agents/[a-z][a-z0-9_-]*\.md$`: one flat Markdown file directly under
`agents/`. Nested directories are not read for MiniMax-format Plugins. The file name without `.md`
is the Agent identity. A Plugin may contain only subagents; an Agent-only Plugin is valid.

A declared file that is missing, escapes the package, exceeds 1 MiB, has invalid frontmatter, or
uses an invalid field type rejects the whole package, the same way an invalid Skill reference does.

## Frontmatter contract

The file uses exactly the same frontmatter contract as a Custom Agent `agent.md` in MiniMax Code:

```markdown
---
name: reviewer
description: Reviews a diff for correctness and risky changes. Use after code is written.
tools: [read, grep, glob, bash]
mcpServers: [example-server]
skills: [example-skill]
x-mavis:
  displayName: Code Reviewer
---

You are a careful code reviewer. Read the changed files under the workspace, list concrete
defects with file paths, and finish with a short verdict.
```

| Field | Rule |
| --- | --- |
| `name` | Required. Must equal the file name stem. A different value only produces `agent_name_mismatch`; the file name still wins. |
| `description` | Required, non-empty. The main Agent decides when to delegate from this text, so state the role and when to use it. |
| `tools` | Optional array of native MiniMax tool names such as `read`, `write`, `edit`, `bash`, `grep`, `glob`, `web_fetch`. Omit it to inherit every tool available to the child session; `[]` disables all native tools. It does not limit MCP tools (names starting with `mcp__`, selected by `mcpServers`) or Plugin tools; use `disallowedTools` to remove one of those. Comma-separated strings are rejected. |
| `disallowedTools` | Optional array of tool names removed from the inherited set. Use native names; a full MCP tool name such as `mcp__example-server__search` removes that one MCP tool. |
| `mcpServers` | Optional allowlist of MCP server names. Omit it to inherit every ready MCP server; `[]` disables MCP. |
| `skills` | Optional list of Skills preloaded in full when the subagent starts. A name matching a Skill in the same Plugin preloads that Plugin Skill. It does not limit Skills: unlisted Skills stay loadable with the `skill` tool, and `[]` just preloads nothing. A listed Skill that cannot be found is skipped. |
| `model` | Optional `provider/model`. Omit it so the subagent inherits the parent session model. |
| `effort` | Optional. Applied only together with `model`; without `model` the parent selection is inherited unchanged. |
| `x-mavis.displayName` | Optional UI label. It does not change the delegation name. |
| `x-mavis.contextWindow`, `x-mavis.maxOutputTokens` | Optional positive integers, applied the same way as for a Custom Agent. |
| `x-mavis.extensionSkills` | Legacy. Still parsed and kept, but it no longer selects Skills; do not write it. |

Do not write `hooks`, `permissionMode`, `x-mavis.avatar`, or `x-mavis.defaultWorkspaceDir`. Unknown
or unsupported fields are ignored with a diagnostic and never take effect. A subagent uses the
Plugin logo and the parent session workspace.

Write only native tool names. Do not use compatible aliases such as `Read`, `Bash`, `Agent`, or
`Task`, and do not list `task`: a Plugin subagent cannot delegate to further subagents.

Only set `model` when the role truly needs a specific model. If that model is unavailable when the
subagent is started, the task fails with `MODEL_SELECTION_INVALID` and the error is returned to the
main Agent; it does not fall back to the parent model.

## Prompt body

Everything after the frontmatter is the subagent system prompt. These placeholders are replaced
when the subagent starts:

- `${PLUGIN_ROOT}` and `${MINIMAX_PLUGIN_ROOT}`: the installed Plugin directory.
- `${PLUGIN_DATA}`: the writable Plugin data directory shared with Hooks.

Other `${...}` tokens stay literal. `${user_config.*}` is not supported and produces a diagnostic.
Treat the package as read-only and keep persistent state under `${PLUGIN_DATA}`.

## Scoped name and delegation

The delegation name is `<plugin>:<agent>`, for example `example-plugin:reviewer`. It must be at most
64 characters and is matched case-insensitively. Duplicate names inside one Plugin keep the first
file by path and report a diagnostic. A Plugin named `agent` cannot provide subagents, because
`agent:<name>` already addresses Custom Agents.

When the Plugin is enabled, the main Agent sees every enabled Plugin subagent with its description
in the Plugin context and delegates through the `task` tool with `agent_name` set to the scoped
name. A bare `reviewer` resolves to a Plugin subagent only when no built-in or Custom Agent uses that
name and exactly one enabled Plugin subagent has it, so prefer the scoped name in examples and
instructions.

The child session inherits the parent permission mode; tool approvals still apply. Its definition,
model, and capabilities are frozen when it starts and are capped by what is available at that
moment. Editing, disabling, or deleting the Plugin affects only subagents started afterwards.

`SubagentStart` and `SubagentStop` Hooks receive the scoped name as `agent_type`, so an exact
matcher such as `example-plugin:reviewer` targets one Plugin subagent.

## Compatibility

The manifest `agents` field and Plugin subagents require a MiniMax Code version that includes
Plugin subagent support. Clients that predate tolerant manifest parsing reject the unknown field
with `MANIFEST_SCHEMA_INVALID` and the whole package fails to load; clients with tolerant parsing
but without subagent support load the other capabilities and ignore `agents`. Tell the user about
this when the Plugin may be shared with older clients.

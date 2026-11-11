# Agent

Use this doc for agent inventory, configuration, identity, and skill visibility. All operations go
through the native `mavis` tool.

## Operations

### List agents

```text
mavis({ command: "agent list", args: { search: "<query>", limit: 20, offset: 0 } })
```

Args (all optional): `search` matches name or content; `limit` / `offset` paginate;
`include_primary` includes the primary agent.

### Show details

```text
mavis({ command: "agent get", args: { agent_name: "<nameOrId>" } })
```

`agent_name: "me"` resolves to the current agent. Returns name, display name, persona, system
prompt, description, avatar, root session ID.

### Create / update / delete

```text
mavis({ command: "agent create", args: { display_name: "<name>", system_prompt: "<text>", persona: "<text>", default_workspace_dir: "<path>" } })
mavis({ command: "agent update", args: { agent_name: "<nameOrId>", persona: "<text>", system_prompt: "<text>", new_name: "<name>" } })
mavis({ command: "agent delete", args: { agent_name: "<nameOrId>" } })
```

Update accepts any subset of: `new_name`, `system_prompt`, `persona`, `description`, `avatar`.
Call `mavis({ command: "agent help" })` for the full arg reference.

## Identity

Identity fields (`display_name` via `new_name`, `avatar`) are plain agent fields — set them with
`agent update`:

```text
mavis({ command: "agent update", args: { agent_name: "<name>", avatar: "<path>" } })
```

## Logs and Status

There is no native logs/status command. Local-runtime logs are plain files — read them under
`{{DATA_DIR}}/logs/` (or `{{DATA_DIR}}-<profile>/logs/`), e.g. `runtime-events/`. For session-level
activity, use `session list` / `session messages` instead (see
`references/session-and-communication.md`).

## Skill Discovery

The skills visible to the current agent are listed in the `<available_skills>` context block — read
it directly instead of running a command. Load one with the native `skill` tool:
`skill({ name: "<skillName>" })`.

Scope semantics:

- `global`: shared skill directory (`{{DATA_DIR}}/skills/`), visible to all agents
- `agent`: agent-private directory (`{{DATA_DIR}}/agents/<name>/skills/`)

For file-level skill management, see `references/skill-management.md`.

## Use This Doc When

- you need to inspect or edit agent configuration
- you need to know what an agent is allowed to use
- you need runtime logs rather than session/message history

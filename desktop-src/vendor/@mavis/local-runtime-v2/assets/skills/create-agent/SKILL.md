---
name: create-agent
description: "Create one agent on disk. Load only after the user explicitly asks for or approves creating an agent. Output path: `{{DATA_DIR}}/agents/<name>/` (cross-project helper agent, default dataDir `{{DATA_DIR}}/`). Do NOT load merely to suggest agent creation or to create a skill (use `skill-creator`)."
descriptions:
  zh-Hans: "在磁盘上创建一个 Agent，可用于补充团队角色或按用户要求新增 Agent。"
displayNames:
  zh-Hans: "创建 Agent"
---

# Create Agent

Only proceed after the user explicitly asks for or approves creating an agent.

Your job is to write the files so the requested agent boots correctly. If the request does not state the agent's responsibilities, what it may and may not do, and when it must stop or escalate, call `ask_user` for them before writing `agent.md`; do not invent them. Do not ask about its name, tone, or anything the request already states.

Agents live in `{{DATA_DIR}}/agents/<name>/` and are managed through the native `mavis` tool's `agent` commands, which are cross-platform. No shell-specific scaffolding is needed.

## Five steps

### 1. Pick the name

- **kebab-case**, maps 1:1 to the directory name.
- Name by **responsibility**, not seniority: `payments-expert` ✓ / `senior-dev` ✗.
- Check it's free: `mavis({ command: "agent get", args: { agent_name: "<name>" } })` returning details = name taken, pick another.

### 2. Scaffold

```
mavis({ command: "agent create", args: { name: "<name>", description: "<one line — what role this agent plays>", display_name: "<friendly name>" } })
```

The tool writes a generic `agent.md` you'll replace in step 3.

### 3. Write `agent.md` (this IS the system prompt)

The body must answer four questions in order. Skipping any leaves the agent vague.

```markdown
---
name: <name>                   # MUST match the folder name
description: <one concrete sentence — shown to the orchestrator when picking who to delegate to>
---

# <Display Name>

You are the <role> for <project / scope>.

## Scope
- Own: <paths / systems / responsibilities>
- Don't own: <what you hand off, to whom>

## How you work
- <key convention>
- <link to project docs instead of inlining rules>

## Stop when
- <concrete checklist — "build passes, tests pass, MR opened">
```

**Bad body** (it gets ignored):
> "You are a senior developer who writes high-quality, maintainable code."

**Good body** (drives behavior):
> "You own `packages/api`. You hand off UI work to `ui-expert` and infra changes to `daemon-expert`. You're done when the change builds, the affected package's tests pass, and you've posted a one-line summary to the orchestrator."

### 4. Add the optional pieces — only what you need

| File | Add when | How |
|---|---|---|
| `config.yaml` | The default model is wrong for this role | `model: <provider>/<model>` (and `thinking:` block for reasoning models — check `{{DATA_DIR}}/config.yaml` for the exact shape per model) |
| `PERSONA.md` | Tone / voice / brevity matters (frontend chat agent vs backend grunt) | Body shapes voice, NOT operational rules — those go in `agent.md` |
| `skills/<name>/` | Agent needs a private skill | Use the `skill-creator` skill, don't hand-roll |
| `crons/<name>.md` | Recurring task this agent owns | Discover `cron_create` through `tool_search`, then call it (on a PTC Turn inside run_code as `await tools.cron_create(args)`; otherwise through `mcp_invoke`) |

Skip what you don't need. Empty folders just create noise.

### 5. Verify it boots

```
mavis({ command: "agent get", args: { agent_name: "<name>" } })   # prints prompt + config — proves the file parsed
mavis({ command: "agent list" })                                  # the agent shows up here
```

List `{{DATA_DIR}}/agents/<name>/skills/` to see which private skills the agent carries.

If the agent is missing from the list:

| Symptom | Fix |
|---|---|
| `agent get` works but `agent list` doesn't show it | YAML frontmatter probably broken — check `name:` matches folder, frontmatter closed with second `---` |
| Frontmatter parse error in logs | No tab indent. `name:` and `description:` are plain strings on their own lines |

## After creation: report up

Confirm the agent was created, give the path, then ask what to do with it next.

## Pitfalls that bite later

| Pitfall | Why it bites | Avoid by |
|---|---|---|
| `description:` is one of "helpful assistant" / "general-purpose agent" / vague | Orchestrator can't pick this agent for delegation — every task looks equally relevant | One concrete sentence about the role's actual scope |
| Two agents with overlapping ownership | Routing becomes random; you can't predict who picks up the task | Tighten both `agent.md` bodies — make scope unambiguous before adding the second |
| Stop condition is "task is complete" | Agent reports done without verifying anything | Replace with measurable: "build passes, tests pass, MR opened, summary posted" |
| Inline whole project conventions in `agent.md` body | Body bloats; updates require editing each agent | Link to a single project doc instead |
| Listing teammates inside the orchestrator's `agent.md` | The runtime already injects the team roster — manual lists drift | Don't list. Each agent's `description:` field is what the orchestrator reads |

## What this skill is NOT for

- Suggesting or deciding **whether** to add an agent before the user asks for or approves it
- Creating a new skill → use `skill-creator`
- Editing an existing agent's prompt → just open `{{DATA_DIR}}/agents/<name>/agent.md` and edit it, or use the `mavis` tool's `agent update` command
- Deleting an agent → `mavis({ command: "agent delete", args: { agent_name: "<name>" } })`

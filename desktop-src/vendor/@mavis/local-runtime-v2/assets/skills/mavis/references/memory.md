# Memory

Mavis memory has three durable layers plus task-local artifacts. The core decision is
not "should I save this" but "which scope does this belong to".

Memory is operated through the native `memory` tool (a model tool, not a CLI).
The legacy CLI memory command group has been removed — do not shell out
for memory operations.

## Decision Rule

Pick the narrowest durable scope that still helps future work. Same three-question test
the `<memory-skill-reminder>` system block injects, **narrowest first**:

1. **Only true in this repo/project?** → **Project memory**
   `AGENTS.md` (every agent, every task) or referenced topic files (on demand).
2. **Still true on a different project?** → **Agent memory**
   Reusable lessons private to this agent: patterns, gotchas, future-task leverage.
3. **Would the conclusion change for a different user?** → **User memory**
   Identity, preferences, communication style, persistent cross-project facts about the user.

If none fits → **task-local** (workspace / scratchpad / plan board / final report).
Pick exactly one durable layer; do not duplicate across layers. Your `agentName` and
`sessionId` are available in `<agent-context>`.

### User append requires `reason`

`memory(target=user, operation=append)` rejects any append without a
`reason` — one sentence of cross-project justification. This catches the most common
failure mode: writing project methodology into user memory because it is the most
convenient target. If you can't justify the entry across every project this user works
on, it belongs in layer 1 or 2 — not user memory.

The reason is persisted as `<!-- mem-append-reason: ... -->` directly above the
appended content for future audit. The runtime enforces this as the authoritative gate.

## What NOT to Put in Durable Memory

Apply this filter **before** writing. Skip the write or keep it task-local if any apply:

- code structure recoverable from the repo: paths, signatures, architecture notes
- git facts: diffs, blame, commit history, who changed what
- debugging recipes or repair steps that belong in code, MR context, or docs
- standing policy already captured in `AGENTS.md`
- transient task state: current branch, handoff scraps, in-flight progress
- raw activity logs, PR lists, work journals — extract the non-obvious lesson instead
- project-level architectural constraints that apply to all agents/developers
  → write to **project memory**, not agent memory (agent memory is private)

When a user asks to save a list, extract the durable bit: the rule, surprise,
constraint, or pointer.

## Layer Operations

### Project memory (no tool)

Edit `AGENTS.md` (every agent reads it
on every task) or a referenced topic file directly with Edit/Write, update
`changelogs/`, commit alongside related code.

Placement:
- Mandatory for every task (e.g. "never merge to main directly") → `AGENTS.md`
- Domain-specific (e.g. "daemon seal pattern") → topic file, referenced from `AGENTS.md`

### Agent memory

Reusable lessons **private to this agent** across sessions. Patterns, gotchas, future-task leverage.

```text
memory(target=main, operation=append, content="### <topic> (<date>)
Type: <type>
<content>
WHY: <why this matters later>")
```

`target=main` operates on the current agent's `MEMORY.md`. Use `target=topic` with
`topicName` for on-demand topic files.

### User memory

User identity, preferences, communication style, persistent cross-project facts about the user.
`reason` is required (see above).

```text
memory(target=user, operation=append,
       reason="<one sentence: why does this hold across all projects?>",
       content="### <topic> (<date>)
Type: <type>
<content>")
```

To **modify, correct, or remove** an existing entry — `append` doesn't dedupe and
would produce duplicates — pick the path the tool actually supports:

- **Agent main memory**: `memory(target=main, operation=edit, oldString=..., newString=...)`
  (`newString` must be non-empty; for a true deletion or larger restructure, use
  `operation=write` to rewrite the full content, or edit the file directly with Edit/Write)
- **Topics**: `operation=edit` for in-place fixes, `operation=delete` to drop a whole topic
- **User memory**: the tool has no `user:edit` / `user:delete` — edit the file directly
  with Edit/Write

Files on disk: user `{{DATA_DIR}}/memory/user.md`, agent
`{{DATA_DIR}}/agents/<agent-name>/memory/MEMORY.md` (topics under `memory/topics/`),
project the file in the repo.

## Type Tag

User/agent entries need a `Type:` line as the first content line under the
`### <topic> (<date>)` header. The cleanup curator relies on it.

```text
### MR notification flow (2026-05-08)
Type: feedback
CI + CR must pass before asking the user to merge...
```

Three Types:

- **user** — how this user thinks and works: role, goals, preferences, knowledge level
- **feedback** — how Mavis should behave next time. Save both corrections *and* validated
  judgments; if you only remember mistakes you become weirdly timid.
  Shape: rule → **Why:** → **Apply when:**
- **reference** — where to look outside the repo: docs, dashboards, tickets, runbooks

If unsure: "how the agent should act" → **feedback**; otherwise re-apply the
decision rule above.

## Topic Files

Agent memory has two forms:

- `MEMORY.md` (`target=main`): injected when memory is enabled; hot rules, current
  state, frequently triggered discipline
- `memory/topics/<topic>.md` (`target=topic`): on-demand topics with a `description`;
  read when the description matches the current task

```text
memory(target=topic, operation=create, topicName="<kebab-name>",
       description="When to read this", content="...")
memory(target=topic, operation=read,   topicName="<name>")
memory(target=topic, operation=append, topicName="<name>", content="...")
memory(target=topic, operation=edit,   topicName="<name>", oldString="...", newString="...")
memory(target=topic, operation=delete, topicName="<name>")
```

`memory(target=main, operation=read)` lists the main file; topic listings surface
through the injected memory block and `operation=read`.

Constraints (cleanup rebalancing owns sizing; don't count size manually):

- keep topic files few and focused; each topic small (tens of KB at most)
- `MEMORY.md` soft target ≤ 15KB
- do not maintain a manual topic index in `MEMORY.md`

## Cleanup

Cleanup/curation runs inside the runtime when the main file crosses its threshold.
Don't manually curate; to correct a specific stale entry use `operation=edit`
(main/topic) or direct file editing (user memory), and `operation=delete` for a
whole stale topic.

When memory injection is disabled in config, don't look for injected memory blocks;
existing files remain readable via `operation=read` / `operation=search`.

## Treat Recalled Memory as a Hint

Memory helps you orient; it does **not** prove what is true right now. Before leaning
on a memory record:

- if it names a file / path / function / command / flag / endpoint, verify it still exists
- if the user asks about "current" / "latest" / "recent", prefer code, git, runtime
  state, and current docs over recalled snapshots
- if the user may act on your recommendation, verify first
- if memory conflicts with what you see now, trust the current source of truth and
  update or delete the stale memory

`memory says X existed` ≠ `X exists now`.

## Quick Reference

```text
# Write
memory(target=user,  operation=append, reason="<cross-project rationale>", content="### <topic> (<date>)\nType: user\n<content>")
memory(target=main,  operation=append, content="### <topic> (<date>)\nType: feedback\n<content>")
memory(target=topic, operation=create, topicName="<name>", description="...", content="...")
# UPDATE: main/topic → operation=edit (newString non-empty) or main operation=write;
#         user → edit {{DATA_DIR}}/memory/user.md directly (no user:edit/user:delete).

# Read
memory(target=main,  operation=read)
memory(target=user,  operation=read)
memory(target=main,  operation=search, query="<keyword>")
memory(target=topic, operation=read, topicName="<name>")

# Maintain
memory(target=topic, operation=delete, topicName="<name>")
```

## The Habit

1. **Start of session:** when memory is enabled, memories are auto-injected.
   Topics show as descriptions only — read when the description matches your task.
2. **During work:** when you learn something, write immediately. Three-question test,
   narrowest first: project → agent → user. If none fits, keep it task-local.
3. **Before reporting completion:** pause. Did you learn anything reusable? Write it now.

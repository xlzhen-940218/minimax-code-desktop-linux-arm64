# Skill Management

Use this doc for skill inventory, installation, creation, and management.

## Skill Types

| Type          | Source of truth / Location                                                                                               | Visibility                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Built-in      | Source: `packages/local-runtime-v2/assets/skills/<name>/SKILL.md`; runtime copy: `{{DATA_DIR}}/.builtin-skills/<name>/SKILL.md` | All agents, ships with local-runtime |
| User (global) | `{{DATA_DIR}}/skills/<name>/SKILL.md`                                                                                        | All agents, user-installed           |
| Agent-private | `{{DATA_DIR}}/agents/<agent>/skills/<name>/SKILL.md`                                                                         | One agent only                       |

Built-in skill rule: edit the repo source first, then sync the runtime copy for immediate effect.
The runtime copy is re-seeded from the packaged assets on startup/release and is not the source of
truth. Built-in skills are **protected**: do not edit or delete the runtime copies — changes must
land in the repo source.

## Operations

There is no skill CLI. Use the native tools plus file operations:

- **List skills visible to the current agent**: read the `<available_skills>` context block —
  it lists every skill (name + description) already; no command needed.
- **Load / inspect a skill**: `skill({ name: "<skillName>" })` returns the SKILL.md body and a
  `Location:` header with the on-disk path.
- **Inspect files beyond SKILL.md** (references, scripts): Read files under the skill directory
  from the `Location:` path.
- **Create a skill**: write `SKILL.md` (plus any references) into
  `{{DATA_DIR}}/skills/<name>/` (global) or `{{DATA_DIR}}/agents/<agent>/skills/<name>/`
  (agent-private) with Write.
- **Update a skill**: Edit the files in place.
- **Delete a skill**: remove the skill directory.
- **Install from a Git URL**: `git clone <git-url>` into the target skills directory (the repo
  root must contain `SKILL.md`).
- **Copy global → agent-private**: copy the skill directory into
  `{{DATA_DIR}}/agents/<agent>/skills/`.

## Notes

- Skills take effect in the **next session** — no local-runtime restart needed.
- Installing or updating a same-name skill replaces what agents resolve; verify with
  `skill({ name: "<name>" })` after changes.
- To **create or improve** a skill interactively, delegate to the `skill-creator` skill.
- To fix a built-in skill, edit the repo source (`packages/local-runtime-v2/assets/skills/...`)
  and land the change via MR — runtime copies are protected.

## Use This Doc When

- you need to list, inspect, install, or manage skills
- you need to know where skill files live on disk
- you need skill scope semantics (global vs agent-private)

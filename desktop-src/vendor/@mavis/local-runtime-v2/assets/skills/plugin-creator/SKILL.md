---
name: plugin-creator
description: |
  Create, update, validate, or visually enhance a local MiniMax Plugin V1 package inside the active
  MiniMax Code Desktop data directory. Use when the user asks to create a custom Plugin, combine Apps,
  MCP servers, Skills, subagents, and synchronous command Hooks into a Plugin, repair a locally
  imported MiniMax Plugin, or add a business-specific GenUI Visualizer to a new or existing local
  Plugin. The output lives under {{DATA_DIR}}/plugins/ and is not an official Marketplace or another
  coding assistant's Plugin. A Hook only for the user or one project belongs in the user or project
  hooks.json instead of a Plugin; see "Hook capability".
---

# Local MiniMax Plugin Creator

Create a valid local MiniMax Plugin package and place it at
`{{DATA_DIR}}/plugins/<plugin-directory>/`. Use the active data directory exactly as rendered in
this skill; do not assume `~/.minimax`, because profiles may resolve to another directory.

Local MiniMax Plugins support App, MCP, Skill, subagent, and synchronous command Hook capabilities.
An App capability declares a MiniMax Connector provider; its tools are usable once the user
connects that App, exactly as with an official Plugin.

## Establish the request

Collect only missing information:

1. Plugin name and optional display name.
2. Purpose, author, SemVer version, category, and one or more example queries.
3. Optional default and dark-mode icons explicitly supplied by the user. When the user supplies no
   default icon, use the bundled matching default/dark pair for the selected category; do not ask
   the user to provide or generate either variant. When the user supplies only a default icon, keep
   it and omit `darkIcon`; do not mix it with an unrelated bundled dark icon.
4. At least one effective capability:
   - one or more Apps; or
   - one or more MCP servers; or
   - one or more Skills; or
   - one or more subagents; or
   - one or more synchronous command Hooks.

If the user asks for Marketplace publication or regional CN/overseas distribution, explain that this
local creator does not implement that request.

Normalize machine-readable names to lowercase kebab case. Plugin and MCP names must match
`^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`; keep portable ASCII file and directory names. Do not invent
an MCP endpoint, executable, credential, or Connector provider.

## Inspect before writing

Resolve the target as `{{DATA_DIR}}/plugins/<plugin-directory>/`.

- If the target already exists, read its complete manifest and referenced capability files before
  changing anything. Preserve unrelated files and capabilities.
- Multiple recognized manifests may coexist. Determine the active format before editing: a valid
  Agent Plugins V1 root `plugin.json` wins, otherwise the priority is MiniMax, the compatible vendor
  format, then Codex. This Creator authors only MiniMax format. If another format currently wins,
  explain the effect and ask before changing the active format; never delete a lower-priority
  manifest merely because it coexists with MiniMax.
- Ask before replacing a different Plugin or deleting existing files.
- Bump the SemVer version when updating package content.
- Reject symlinked package directories or references that escape the Plugin root.
- Never write a repository-level Marketplace catalog. This directory is the installed local package
  itself.

## Build the package

Read [references/local-plugin-v1.md](references/local-plugin-v1.md) before creating files. Follow
its manifest and capability shapes exactly.

Create this structure without an extra wrapper directory:

```text
{{DATA_DIR}}/plugins/<plugin-directory>/
  .minimax-plugin/plugin.json
  <icon>.png|jpg|jpeg|webp
  <optional-dark-icon>.png|jpg|jpeg|webp
  <app-name>.app.json
  <servers>.mcp.json
  skills/<skill-name>/SKILL.md
  agents/<agent-name>.md
  hooks/<hook-name>.json
  scripts/<portable-hook-script>
  <files used by stdio MCP servers>
```

Apply these rules:

- Keep the Plugin name identical in the directory and manifest.
- Write UTF-8 text without BOM, use two-space JSON indentation, and end text files with a newline.
- Make at least one of `apps`, `mcpServers`, `skills`, `agents`, or `hooks` non-empty.
- List every effective App, MCP, Skill, subagent, and Hook file in `.minimax-plugin/plugin.json`.
- Keep empty arrays for unused capability types.
- Use only portable relative `/` paths in the manifest. Do not use absolute paths, `..`,
  backslashes, symlinks, native binaries, installers, or package-manager installation scripts such
  as `preinstall` and `postinstall`.
- Keep the default icon and optional dark-mode icon inside the package and ensure their bytes match
  their PNG/JPEG/WebP extensions.

### Icon selection

Unless the user explicitly supplied a default icon, read
[references/category-icons.md](references/category-icons.md), select the row matching the manifest
`category`, enumerate the PNG files directly inside its default/light directory, and randomly choose
one PNG. Locate the file with the exact same filename in that row's dark directory. Copy the default
file into the Plugin package as `icon.png`, copy its matching dark file as `icon-dark.png`, and set
both `"icon": "icon.png"` and `"darkIcon": "icon-dark.png"` in the manifest. Resolve both
directories relative to the directory containing this loaded `SKILL.md`; never reference built-in
Skill assets directly. The choice need not be cryptographically random, but do not always default to
the first candidate. If the matching dark file is missing, stop and report the broken bundled pair
instead of silently substituting another image.

When the user explicitly supplies a default icon, copy that file into the package. If the user also
supplies its dark-mode counterpart, copy and reference it through the optional manifest `darkIcon`
field. A default icon remains required. Never synthesize a dark image from the default icon, pair a
user-supplied default with a bundled dark icon, or substitute one bundled category's icon for
another. If the user supplies only a dark-mode icon, ask for the required default icon or permission
to use a complete bundled pair; do not combine it with a bundled default.

### App capability

Write one `<app-name>.app.json` per Connector provider:

```json
{
  "schemaVersion": 1,
  "provider": "notion"
}
```

- `provider` must match `^[a-z0-9_-]{1,64}$` and must be the exact provider id of a MiniMax
  Connector. Take it from the `provider` field that `mcode-tools connector tools` returns for a
  connected App, or from an id the user explicitly supplies. Never derive it from a display name or
  guess it from the user's wording.
- Declare each provider once. Add no other fields; credentials and OAuth stay with the Connector
  service and never enter the Plugin.
- The App does not need to be connected to create the Plugin. The Plugin detail shows the App's
  connection state, and its tools become available after the user connects it. Uninstalling a local
  Plugin does not disconnect the App.
- A provider outside the current MiniMax Connector catalog cannot be connected. When the provider
  cannot be confirmed, say so instead of claiming the App is usable.

### MCP capability

Use only `stdio`, `streamable-http`, or `sse`.

- For `stdio`, set `command` to a PATH-resolved executable or interpreter with no slash. Reference
  package scripts through explicit relative `args`, for example `node` plus `./server.js`.
- For remote transports, require a real HTTP(S) URL.
- Do not add `http` aliases, OAuth, `auth`, refresh configuration, or embedded credentials.
- Keep any bundled script portable across Windows, macOS, and Linux. Prefer Node.js or another
  interpreter known to exist in the user's environment.
- If network access permits, connect and run `tools/list`; otherwise report that runtime
  reachability is still unverified.

### Skill capability

Put each Skill at `skills/<skill-name>/SKILL.md`. Start with YAML frontmatter whose `name` equals
the directory name and whose `description` clearly states behavior and trigger conditions. Write the
reusable procedure after the frontmatter.

For a complex Skill, load `skill-creator` for authoring guidance, but override its output scope: the
file must remain inside this Plugin package rather than `{{DATA_DIR}}/skills/`.

### Subagent capability

Before creating or changing a subagent, read
[references/local-plugin-agents.md](references/local-plugin-agents.md) completely.

- Use a subagent when the work needs its own context window, a specialized role, a narrower tool
  set, or parallel delegation. Use a Skill when the main Agent should reuse a procedure inside the
  current conversation.
- Put each subagent at `agents/<agent-name>.md`, directly under `agents/`, and list it in the
  manifest `agents` array. `<agent-name>` must match `^[a-z][a-z0-9_-]*$`.
- Use the same frontmatter contract as a MiniMax Custom Agent `agent.md`: `name` equal to the file
  name, a non-empty `description` that says when to delegate, and the system prompt after the
  frontmatter.
- Write only native tool names in `tools` and `disallowedTools`. Never list `task`; Plugin
  subagents cannot delegate further.
- Usually omit `model` so the subagent inherits the parent session model. Write `provider/model`
  only when the role truly needs it, and tell the user that the task fails when that model is
  unavailable. `effort` applies only together with `model`.
- Treat `mcpServers` as an allowlist: omit it to inherit every server and use `[]` to disable MCP.
- `skills` lists Skills preloaded in full when the subagent starts; it does not limit which Skills
  the subagent can load with the `skill` tool. List only Skills the role always needs.
- Use only `displayName`, `contextWindow`, and `maxOutputTokens` under `x-mavis`.
  Do not write `hooks`, `permissionMode`, `x-mavis.avatar`, or `x-mavis.defaultWorkspaceDir`.
- The delegation name is `<plugin>:<agent-name>` and must stay within 64 characters. A Plugin named
  `agent` cannot provide subagents.

### Hook capability

Create a Plugin for a Hook only when the user wants to package, share, or distribute it, or ship it
with other Plugin capabilities. A Hook just for this user belongs in `{{DATA_DIR}}/hooks.json`, and
one for a single project belongs in `<project root>/.minimax/hooks.json`; do not create a Plugin for
those. When the `minimax-code-product` Skill is available, follow its `references/hooks.md`.
Otherwise use the Hook document format below and keep these rules: the user file needs top-level
`"enabled": true`; project Hooks run only after the user turns them on in Settings → Hooks →
Project; `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` do not apply, so use `${MINIMAX_HOOKS_DIR}` and
`${MINIMAX_HOOKS_DATA}`.

Before creating or changing Plugin Hooks, read
[references/local-plugin-hooks.md](references/local-plugin-hooks.md) completely. Keep the public
contract aligned with the runtime instead of inventing event names, handler fields, input fields, or
decision JSON.

- Support exactly `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`,
  `PermissionRequest`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `PreCompact`, and
  `PostCompact`.
- Create only synchronous `type: "command"` handlers. Do not create asynchronous commands,
  `asyncRewake`, prompt, agent, HTTP, `mcp_tool`, or other handler types.
- Reference every Hook document through the manifest's optional `hooks` array. A Hook-only Plugin is
  valid when at least one declared handler is executable.
- Prefer portable scripts invoked through `${PLUGIN_ROOT}`. Node.js is suitable only after its
  executable is resolved in the active runtime environment. Do not assume MiniMax Code ships a
  standalone `node` executable for Hook commands. Treat the package as read-only and write
  persistent Hook state only beneath `${PLUGIN_DATA}`.
- Add `commandWindows` whenever the default command is not portable to Windows. Do not assume Bash,
  executable bits, `/tmp`, POSIX paths, or a globally installed package-specific executable.
- Omit `matcher` to observe every occurrence. When filtering is requested, prefer exact names or
  `|`-separated exact alternatives and keep the matcher within the documented safe subset.
- Keep stdout reserved for the documented structured response. For a simple block, exit with code 2
  and write the reason to stderr; the reference lists what exit code 2 does on each event. Other Hook
  failures, invalid JSON, oversized output, and timeouts fail open, so a Plugin must not rely on an
  error being shown to the user.

## Work cross-platform

Prefer the Desktop Read, Write, and Edit tools for text files. Use the shell only when necessary for
directory creation, binary copying, or validation.

- On Windows, use PowerShell syntax and UTF-8-safe file operations. Do not use Bash commands,
  `/tmp`, Unix path separators in filesystem commands, or executable-bit assumptions.
- On macOS or Linux, use the active shell normally.
- In manifest references, always use portable `/` paths regardless of the host platform.

Do not print or copy secrets into chat, logs, manifests, MCP headers, or environment maps.

## Validate before reporting success

Review the whole package, not only the last file changed:

1. Parse every JSON file and reject duplicate keys, comments, trailing commas, BOMs, or non-object
   roots.
2. Verify every required manifest field, SemVer version, category, example query, default icon,
   optional dark-mode icon, and referenced file against
   [references/local-plugin-v1.md](references/local-plugin-v1.md). When the bundled category pool
   was used, verify the default and dark icons came from both directories in the matching row of
   [references/category-icons.md](references/category-icons.md), used the same source filename, and
   were copied as `icon.png` and `icon-dark.png` with both manifest fields present.
3. Verify every Skill frontmatter name matches its directory and has a non-empty description.
4. Verify every subagent against
   [references/local-plugin-agents.md](references/local-plugin-agents.md): the manifest lists it,
   its file name matches `^[a-z][a-z0-9_-]*$`, frontmatter `name` equals the file name,
   `description` is non-empty, list fields are arrays of native names, `model` is omitted or uses
   `provider/model`, no unsupported field is present, and `<plugin>:<agent-name>` is at most 64
   characters.
5. Verify each MCP server uses one supported transport and contains no unsupported auth fields.
   Verify each App file has exactly `schemaVersion: 1` and a confirmed, unique `provider`.
6. Verify every Hook document and referenced script against
   [references/local-plugin-hooks.md](references/local-plugin-hooks.md): supported event,
   synchronous command handler, timeout, matcher, handler count, portable command, bounded output,
   and exact event-specific response shape. Resolve and invoke every external interpreter or
   executable used by a Hook. For Node.js scripts, run `node --check` after resolving `node`. If an
   external dependency cannot be resolved in the active runtime environment, report the missing
   dependency and mark Hook command execution as unverified instead of claiming success.
7. Verify there is at least one effective App, MCP, Skill, subagent, or Hook capability.
8. Verify no path escapes the Plugin root. Recheck the active format using the documented manifest
   priority; coexistence alone is valid, but do not claim MiniMax changes are active when a valid
   Agent Plugins V1 manifest wins.
9. Re-read the final files from `{{DATA_DIR}}/plugins/<plugin-directory>/`.

After writing, allow MiniMax Code's automatic local Plugin rescan to finish and verify that the
package appears as a Local Plugin without scan diagnostics. Do not ask the user to refresh or
restart unless automatic recognition actually fails. A newly discovered local Plugin is enabled by
default; if the user previously disabled the same canonical directory, preserve that choice. Scan
recognition validates the package declaration but does not prove that an external Hook command can
start; report those two checks separately.

## Run the post-creation visualization decision

Treat a business-specific GenUI Visualizer as a post-creation enhancement, not as the Plugin's
business entrypoint. First finish a complete, text-capable business Plugin, run the complete local
validation, and verify Desktop recognition. Any result-producing MCP/Skill workflow must obtain,
interpret, and report its business result without relying on a Widget; Hook-only lifecycle behavior
must remain complete without GenUI.

After that business-ready checkpoint, run this decision step for every new or existing local Plugin.
It is required even when the user asked for a text-only first version: text-only prevents automatic
Widget authoring, but it does not hide the optional enhancement entry point. If the user explicitly
declined GenUI or asked not to be prompted again, record `Keep the current Plugin` without asking
again.

Analyze the actual business flow before recommending anything:

1. Identify the result-producing steps, business questions, structured fields, provenance, units,
   states, risks, relationships, trends, and follow-up actions.
2. Rank at most three places where a chart, dashboard, diagram, interactive control, form, or mockup
   would materially improve comprehension or action. Reject decorative components and avoid
   visualizing tiny, uncertain, sensitive, or mostly narrative results.
3. For each candidate, name the business step, decision it supports, proposed Widget kind, required
   source data, useful interaction, and text fallback. Mark the recommendation `not recommended`
   when no candidate creates material value and explain why.
4. Decide ownership before offering implementation: modify a user-owned, writable local Plugin in
   place; for an official, installed, or read-only Plugin, propose a user-owned local fork under
   `{{DATA_DIR}}/plugins/` so the source package is not mutated.

When the user has not already selected an enhancement path, read
`references/genui-enhancement-decision.md`. The built-in Creator runs in MiniMax Code Desktop, so
treat Widget rendering and `sendPrompt` as available by default. Before styling, read
`references/genui-widget/SKILL.md` through its `Theme safety gate` and read
`references/genui-widget/references/color-system.md` completely. Continue every paged read while the
tool reports more lines; do not claim the protocol is complete before reaching the end. Load the
remaining pattern or recipe references only when they are relevant to the chosen Widget kind. End
the turn with one final `kind="form"` decision Widget. Put the complete text decision block as the
fallback inside the Widget instead of duplicating it as long Markdown outside the Widget. End the
response at the closing `</mavis-widget>`; do not append status prose, a code fence, another Widget,
or a tool call after it. Do not downgrade to text merely because the Agent describes its own
execution environment as CLI, shell, or Mavis.

The decision Widget is Creator UI only. It is not a capability of the new Plugin, does not register
the generic GenUI foundation, and must not create or modify Plugin files. It summarizes the ready
business Plugin, the recommendation, the inspected flow, ownership, and the smallest useful
opportunities, then collects exactly this enhancement decision:

- For `recommended`, show at most three selectable opportunity cards with no default selection,
  followed by `Implement now`, `Review the design`, and `Keep the current Plugin` actions.
- For `not recommended`, show the reason and zero opportunity cards, omit `Implement now`, make
  `Keep the current Plugin` the primary action, and keep `Review the design` as a secondary escape
  hatch.

Every action must use a visible click target and an explicit, localized `sendPrompt` message. A
Widget selection or local button state does not become authorization until its `sendPrompt` creates
the corresponding user turn. Do not use or advertise `submitForm`, auto-send a choice, preselect
`Implement now`, or mix an unrelated follow-up question into the enhancement decision.

Only when the current `agent-context` explicitly declares Widget rendering or `sendPrompt`
unavailable may the Creator output the localized text fallback directly. The Widget always embeds
that same fallback so an unsupported or failed renderer can degrade without model-side guessing.
Preserve the English semantic labels in the fallback even when translating their explanations. Both
fallback variants start with `### Optional GenUI enhancement`.

Treat `Implement now` as selected when the user clicks it and the explicit confirmation arrives in
the current conversation, or when the user independently gives a current, explicit instruction to
implement GenUI now. Merely mentioning GenUI, requesting text-only output, asking to review a
design, changing local Widget controls without sending the choice, or saying to implement it later
does not count as implementation authorization. The latest and most specific user constraint takes
precedence.

Do not create GenUI files until the user explicitly selects `Implement now` or gives that current
implementation instruction. For `Review the design`, read `references/genui-visualizer.md` and
re-read the decision message's `selectedData`. When it contains one opportunity, review exactly the
selected opportunity instead of expanding unselected candidates; compare all candidates only when
the message explicitly requests the all-candidates scope. Keep the review compact, do not emit a
second decision Widget, and wait without editing files. For `Keep the current Plugin`, stop the
enhancement and retain the base result.

After `Implement now` is selected:

1. Resolve the writable destination before authoring. For `in-place`, confirm that the target is a
   user-owned, writable local Plugin. For `local fork`, create or choose a user-owned local Plugin
   with a non-conflicting identity under `{{DATA_DIR}}/plugins/`, then make every business and
   Visualizer change in that fork. Never modify the official, installed, or read-only source Plugin.
   If no writable fork location or identity is available, stop and request it.
2. Read `references/genui-visualizer.md` and the complete bundled `references/genui-widget/`
   foundation before authoring files.
3. Generate `<business-skill>-visualizer` as a second, user-owned Skill and keep the original
   business Skill complete.
4. Copy the complete GenUI foundation into the derived Skill, record forked provenance, add both
   Skills to the writable destination's `.minimax-plugin/plugin.json`, and update only that
   destination's business Skill composition instructions.
5. Bump the version when updating an existing local Plugin, run the complete local validation again,
   and verify Desktop recognition. Report static Widget review separately from actual Desktop
   rendering and interaction acceptance.

Do not register the generic `genui-widget` foundation itself as a local Plugin capability. If the
user skips the enhancement, business semantics are insufficient, Widget authoring fails, or a Host
capability is unavailable, stop the enhancement without rolling back the base work: the business
Plugin remains valid. A generated Visualizer cannot weaken Host sandbox, CSP, capability, protocol,
or size enforcement.

## Report the result

Summarize:

- final absolute Plugin directory;
- name, version, category, default icon, optional dark-mode icon, example queries, and
  MCP/Skill/subagent/Hook capability names;
- each subagent's `<plugin>:<agent-name>` delegation name, and that the main Agent delegates to it
  through the `task` tool, plus the minimum MiniMax Code version note when subagents were added;
- created and updated files;
- static validation and optional MCP `tools/list` results;
- whether Desktop refresh/runtime recognition was verified;
- the base business capability and, when created, the Visualizer Skill, GenUI protocol and
  provenance mode, component recipes, static Widget checks, and separately verified Desktop Host
  behavior;
- any missing icon, external endpoint check, executable dependency, or user action.

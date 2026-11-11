---
name: miniapp-creator
description: |
  Create or update a local Mini App plugin, using verified business data when external sources are
  required. Use when the user invokes /miniapp-creator, asks for a standalone static or interactive
  board including a simple local tool, or asks MiniMax Code in ordinary language to turn connected
  data such as Notion or Jira into an interactive CRUD list or dashboard, even without naming Mini
  App or this Skill. Also use when the user asks to install or publish an existing local Mini App
  directory or ZIP.
  Clarify the output type only when an unqualified service-specific "board" could instead mean that
  service's native Board/View. This Skill is available only when the Host exposes the miniapp tool
  and the Agent can read, write, edit, and run local validation commands.
---

# Mini App Creator

`miniapp-creator` is this Skill's catalog, command, draft, wire, and directory ID. `miniapp` is the
Host tool. New workspace packages use `miniapps/`, `mcode.miniApp`, and a `miniapp/` payload.
Use **Mini App** in all user-facing descriptions, generated titles, and normal prose.

## Choose the workflow

- **Finished package:** If the user supplies a complete local Mini App directory or ZIP to install
  or publish, read [references/finished-package.md](references/finished-package.md) and complete that
  workflow. The workspace authoring steps below do not apply.
- **Edit an installed Mini App:** Call `inspect`; continue only when its Host-owned `source` is
  `local`. For `official`, an unavailable or unknown source, or
  `OFFICIAL_PLUGIN_READ_ONLY`, follow
  [references/diagnostics.md](references/diagnostics.md#official-plugin-editing).
- **New Mini App or workspace draft:** A new Mini App or an unpublished draft in the current
  workspace does not require an installed-source check. Use the user's request and current
  authoring context to identify this target; a failed `inspect` does not establish a workspace draft.

If the target is unclear, ask the user before authoring. For either authoring branch, continue with
the workspace authoring scope and Steps 1–6 below.

## Workspace authoring scope

The `packagePath` returned by `miniapp.init` is the candidate root and complete authoring scope. A
new package is returned under `miniapps/<pluginId>/`. The returned value is authoritative.
It is the only plugin package in scope; the Agent does not inspect sibling
candidates, installed plugins, runtime databases, private logs, or Host source code.

## 1. Resolve the requested product

Treat an explicit `/miniapp-creator` invocation as a request for a standalone Mini App. Notion,
Jira, and similar services named in that request are data sources, not the output destination.

Treat an ordinary request for a local board, dashboard, static HTML board, timer, notes board,
tracker, or similar page-like utility as a standalone Mini App request. A loose workspace HTML file
or an ordinary Browser tab is not a completed board.

For ordinary text, treat an app-like list or dashboard with connected-data interactions such as
create, read, update, or delete as an explicit Mini App request even when the user does not say
"Mini App". A named service is the data source.

If the user invokes only `@notion` or another service plugin and asks for a board, keep the request
inside that service's native Board/View workflow. Ask whether the output should be a standalone Mini
App or a native service Board/View only for a bare ordinary request such as "make a Notion board"
that describes no app behavior. Once the output is explicit, do not ask the same question again.

### Discover requirements from the user's situation

For a broad request such as "help me create a Mini App", explore before the first `ask_user`.
Review the relevant conversation context and the available Skill and tool catalog, then inspect
promising capability descriptions with the exposed discovery or read tools. Do not wait for the
user to name a use case, service, or implementation. Keep this exploration brief and within the
authorized scope; capability discovery does not require browsing personal records or unrelated
workspace files. Follow up only where it would materially improve a proposed direction.

Use what you actually found to offer two or three concrete app ideas: what each would help the user
do and which available capability supports it. Distinguish a discovered capability from verified
runtime access. Ask which direction would be useful, leaving room for a different idea or a
combination. Generic categories such as "dashboard", "utility", and "operations console" are not
an exploration result. If discovery yields no useful leads or is unavailable, say so briefly and
ask about one concrete activity; do not invent personalized recommendations.

When the user already has a goal, use it directly and explore only the missing capabilities or
consequential uncertainties. Let each answer guide the next question. Do not pre-schedule a
data-source question before knowing whether external data is needed. A sufficiently specific
request may need no discovery questions.

Ask about the uncertainty that most changes the product. Bundle questions only when their answers
are independent. Prefer an open response when the user is still discovering the goal; if examples
help, describe concrete activities rather than a catalog of app categories. For a choice, make each
option directly answer the question and explain the resulting behavior. Recommend an option only
when the user's context supports it; uncertainty alone is not a reason to recommend local data.

Clarify the relationship between concepts, not just their names. For a timer associated with work,
for example, find out what starting or finishing a focus period should do. A finished timer does not
necessarily mean the underlying task is complete. Do not introduce automatic business changes or
full task management merely to fill out a feature menu. If the user names a service, establish its
role in the workflow rather than assuming which records or operations they mean.

Separate desired behavior from verified capabilities. Ask what the user needs, but check relevant
Host or service capabilities before offering an integration as an available option or promising it.
If a consequential capability is unavailable, explain the concrete limitation and ask about the
closest useful alternative; do not silently replace the original goal.

Investigate fields and access methods yourself. Keep Connector, MCP, CLI, and API choices out of
requirements questions unless the user asks about them or a tradeoff affects setup, permissions,
portability, or everyday use. Use defaults for reversible details such as names, icons, and layout.
Once the goal and main interaction are clear, resolve any necessary data scope and proceed with
already authorized creation and installation. Do not ask for confirmation merely to fill a template.

## 2. Prove the data path before authoring

Use available capabilities such as HTTP APIs, SDKs, local CLIs, files, or Connector/MCP. Prefer the
user's explicitly chosen method when it can be verified; otherwise choose based on available capabilities,
authentication, deployment environment, and required operations. Connectors are one option, not a
Mini App prerequisite. A missing Connector does not prove data is inaccessible and is not a reason
to ask the user to switch to a local-only app or a different business goal.

For each required data source, execute a read-only query through the selected method. Verify
authentication, actual parameters, response fields and types, and a representative record or a
real empty result. Implement parsing from the observed shape; report missing required fields or
uninterpretable results as errors, never as empty data. Evaluate alternatives when the selected
path fails, and base any reported blocker on probe evidence.

Use recalled memory, prior conversation, and earlier board outcomes only as requirements context.
They do not establish current Connector authorization, tool inventory or schemas, data shape, Mini
App runtime availability, or failure state; establish those from current probes and structured
`miniapp` results.

The Mini App Node service owns live data reads and writes. When using Connector/MCP, Agent access
is limited to read-only authoring probes; the runtime uses `context.hostConnector`, selecting tools
and arguments from the current inventory and input schemas. Other access methods also run in the
Node service and do not need a Connector wrapper just to use a CLI or API.

A successful query in the Agent terminal does not prove availability in the Mini App runtime.
For CLI, API, SDK, or file access, read [references/data-access.md](references/data-access.md) and
follow its authoring probes and runtime verification guidance. Preserve the requested data
freshness and operations; changing the implementation does not mean changing the product.
Do not auto-select a snapshot or mirror, ops workflow, cron refresh, or Agent-mediated business
operation as a fallback; those are different products and require an explicit current-user request.

For a runtime Connector parser, read
[references/fixtures/host-connector-call-result.json](references/fixtures/host-connector-call-result.json)
for a sanitized, probe-observed `HostConnectorCallResult` example and copy
[references/host-connector-value.mjs](references/host-connector-value.mjs) into the workspace
package. The fixture's single text-block array is a probe-observed provider shape, not a global Host
contract; `HostConnectorCallResult.value` remains an arbitrary `JsonValue`. The helper removes that
exact shape once and decodes at most four JSON-looking layers from its root `text`; all other
`JsonValue` shapes pass through unchanged. Direct strings are never decoded. Do not recursively
decode provider-owned object fields. Treat zero parsed domain items as success only when the decoded
provider result explicitly represents an empty result. If the decoded provider result contains
source data but the domain parser produces zero items, fail the request as a parse error.

Stop before creating or changing the workspace package when authorization fails, a required field is
missing, or the result cannot be interpreted. Do not substitute sample data or an empty shell.
Declare a provider in `hostConnectorAccess.providers` only after a successful probe and only when
the runtime genuinely needs that provider.
A runtime Agent session is a separate grant: declare `agentAccess` as described in
[references/package-contract.md](references/package-contract.md) only when the board needs it.

## 3. Initialize and inspect only the current workspace package

Read [references/package-contract.md](references/package-contract.md) before writing. For a
connected-data board, complete Step 2 first. For a board with no external data source,
initialization is the first workspace action: call it before inspecting, listing, reading, writing,
or validating workspace files. Call the `miniapp` tool with `{ "action": "init", "pluginId": ... }`;
do not create or choose a package directory yourself.

Use the returned `packagePath` as the root for every workspace read, write, list, and validation,
and as the only editable workspace package. `mode: "create"` means the Host created a complete
minimal package scaffold there. `mode: "update"` means the Host proved an existing workspace package
identity without changing its files; read its complete manifest and referenced files before editing,
preserve its declaration and payload layout, and preserve unrelated Plugin Skills, MCP
servers, Hooks, apps, and files. A sibling candidate, profile
Plugin, installed Plugin, earlier Session output, or matching `pluginId` is not an update source;
leave it unread. Do not scan or copy from sibling `miniapps/` entries, and do not
write to a profile Plugin directory. Build only from the returned scaffold, this Skill's references,
and verified data probes.

If the request is to edit existing content but `init` returns `mode: "create"`, stop before editing
or publishing the scaffold. Explain that the expected package was not found in the current
workspace, and ask the user to identify the original source or confirm creating a new Mini App.
An installed `source: local` does not prove that its authoring package is in this workspace.

For `mode: "create"`, keep the scaffolded `icon.png` and manifest `icon` field unchanged. Do not
generate, draw, download, or replace a plugin icon unless the user explicitly requests a custom
icon. For `mode: "update"`, preserve the existing manifest `icon` field and referenced icon asset
unless the user explicitly requests an icon change.

Before writing runtime files, also read [references/runtime-api.md](references/runtime-api.md) and
[references/security-and-state.md](references/security-and-state.md). Use
[references/miniapp-api.ts](references/miniapp-api.ts) as a copyable authoring declaration
and [references/node-entry.mjs](references/node-entry.mjs) as the new-package Node entry template.
For a new package, copy [references/client-index.html](references/client-index.html) to
`miniapp/client/index.html` as the minimal Client implementation. For an update, keep the existing
Node entry, declarations, imports, and payload paths; edit files in place rather than copying the
new-package templates over them.

For startup behavior, Agent-facing MCP, or Plugin Hooks, read
[references/startup.md](references/startup.md). It explains Host-owned activation, lightweight
startup, and the boundary between a business Hook and runtime control.

Before writing or substantially restyling any Client files, read
[references/minimax-code-visual-ui.md](references/minimax-code-visual-ui.md) and use it as the
default Mini App visual baseline when the user has not requested a special visual style. A user-
requested style may override only the visual decisions it directly changes; runtime, security,
accessibility, content semantics, data states, and package boundaries in this Skill and its
references remain mandatory. This reference is scoped to Mini App Client output and does not modify
or replace the repository's existing MiniMax Code design standards.

Only when the requested product exposes Agent-facing MCP tools, or an update candidate already
declares MCP servers, read [references/mcp.md](references/mcp.md) before editing MCP configuration.

Before using a Host-injected `window.mcode` method in Client code, including a button that asks the
Agent to do something, read [references/client-api.md](references/client-api.md). For TypeScript or
checked JavaScript, use its copyable [references/client-api.ts](references/client-api.ts)
declarations. Client APIs are separate from Node `start(context)` and MCP calls; adding text to the
chat input requires Host confirmation, and the user sends it separately. A board that takes voice
input declares `deviceAccess: ["microphone"]`, records in the page with
[references/audio-capture.ts](references/audio-capture.ts), and sends each utterance to
`window.mcode.miniapp.speech.transcribe`; the Host has no live captioning. A board that uses the
camera or shows system notifications declares `deviceAccess: ["camera"]` or `["notifications"]`
and calls the standard Web APIs; client-api.md covers both, including bringing the page back from
a notification click.

When the product runs Agent turns through `context.agent` or `window.mcode.miniapp.agent`, read
[references/agent-interaction.md](references/agent-interaction.md) before implementing either side.
It covers business instructions, per-call controls, questionnaire continuation, and application
transport cleanup. Use its patterns with the API declarations; static pages and draft-append-only
products do not need this reference.

## 4. Build and validate the workspace package

For a new package, keep Mini App-specific files under the plugin root's `miniapp/` directory. Its
root `package.json` uses `mcode.miniApp` with schema version 2 to point at
`./miniapp/miniapp.json`. See
[references/package-contract.md](references/package-contract.md).
Every Mini App has both Client and Node runtime payloads. The Node payload exports one ESM
`start(context)` entry; a static HTML application remains a valid Client implementation served by
that Node process.

Prefer Node built-ins and Browser APIs. Run a dependency install or build only when the returned
candidate already contains its own lockfile, package-manager metadata, and build script; use that
candidate-local manager with `packagePath` as the working directory. Otherwise keep the candidate
dependency-free. Bundle or vendor every third-party runtime dependency into the final payload. Do
not inspect workspace-root package-manager state or install a package manager. `node_modules` is
build state and never a runtime payload. Host validation and publish never install dependencies or
run builds.

The authoring declaration is copied into the workspace package for type checking only. Generated
JavaScript has no runtime import of a MiniMax Mini App SDK package and does not search npm for one.

The Node entry is the board's runtime anchor. Keep it alive while the board is available and make it
hold the assigned Host port, either by serving requests itself or by proxying to a backend it
starts. `dispose()` closes that listener and every child resource the board owns, including child
processes, timers, subscriptions, streams, and persistence handles. The Host stops only this Node
entry; do not assume it will find or terminate a Python, Java, or other child process for you.

While a board is not visible, the Host may reclaim it to free memory or a service slot, without
notice and without any guaranteed callback: it may stop the Node entry, and it may destroy the page
and reload it later. Write every board so that this loses nothing:

- Persist durable state to `dataDir` as it changes. Write files atomically (write a temporary file
  in the same directory, then rename it over the target) or use a transactional store such as
  SQLite. Do not keep unsaved domain data only in memory.
- In the page, save view state when `visibilitychange` reports `document.visibilityState` as
  `hidden`, and restore it on load. Do not rely on `beforeunload` or `unload`.
- Finish `dispose()` within 2 seconds. After a stop the Host waits 2 s, then sends `SIGTERM`, then
  force-kills the entry 2 s later; on Windows `SIGTERM` already ends the process forcefully.
- Do not poll, send heartbeats, or hold requests open to stay alive: the Host does not count page
  traffic or in-process timers as use. While the Host is serving a request the backend sent, and for
  10 minutes after the last one ends, the board is not put to sleep to free a slot for another Mini
  App, and under critical memory pressure it is reclaimed only after idle boards. That is never a
  guarantee: a board that is not visible may be stopped at any time. Phase 1 offers no keep-alive
  grant, so persist data continuously and resume on your own after a restart.

Route all browser mutations through one Node domain service. Commit durable state before sending an
SSE or WebSocket event so every open page can refresh after either a page request, MCP call, or
Agent operation changes data.

Make user-visible content inspectable through accessible semantic HTML. Use clear landmark, heading,
table, form, control, state, and visible-text semantics so Browser inspection and queries can
understand the page without relying on presentation-only markup. Use `role="alert"`,
`role="status"`, and other accessibility semantics normally when they fit the content.

Validate strict JSON schemas, portable relative paths, both declared payload roots, the Node entry,
surface and MCP paths, Connector allowlist, and final runtime payload. Source files or build outputs
may be the payload; do not require a `dist` directory.

Keep validation bounded to the current candidate and tools already authorized for the Session. If an
optional shell or temporary-file validation requests permission and the user denies it once, that
validation step is complete. Continue with candidate-file checks, publish only when the required
checks are complete, and otherwise report the remaining check as unverified. Do not repeat the
request through another command, directory, temporary path, or tool.

## 5. Publish through the Host

After package validation, call the `miniapp` tool with `{ "action": "publish", "pluginId": ... }`.
Omit `sourcePath` for this workspace workflow. The Host resolves the fixed workspace package
directory from the current Session workspace. On failure, read
[references/diagnostics.md](references/diagnostics.md) and use only workspace-package files, these
references, and the tool's structured result. After success, call `inspect`, then call `open` for
the same `pluginId`. In Electron, `open` completes only after Electron Main has committed that board
to its managed Browser tab and expanded that tab for the current Session. Report the structured
`open` result; do not derive a URL or pass loopback coordinates to the renderer, Agent, or user.
`OPEN_UNAVAILABLE` means the Host did not inject an Electron surface, so report it once rather than
retrying or inspecting Host source to work around it.

For a plugin-defined page, use `open` with `path`, for example
`{ "action": "open", "pluginId": "my-app", "path": "/items/42?tab=details" }`. Start `path` with `/`
at the plugin server root, URL-encode dynamic query values, and follow the current tool schema. The
plugin must serve the route or provide a SPA fallback. Omit `path` to use `surface.path`. The Host
reuses the calling Session's plugin Tab; navigating to a different target can discard unsaved page
state.

The Host limits how many different Mini App services run at once; the limit depends on the
device's memory. Updating one of those services uses its own slot. Do not create a second Node
entry for the same board. The Host may put a least recently used board to sleep when the user opens
another one, but your `open` or `restart` never does: at the limit it returns `BUSY` with
`capacity_busy`.

For `BUSY`, read [references/diagnostics.md](references/diagnostics.md) and follow its closed
`busyReason` decision branch.

### Browser page operations

The current Agent performs page checks after `miniapp.open`; this does not add Browser access to the
Mini App Client, Node runtime, or `context.hostConnector`.

On plugin-managed Desktop, use this sequence:

1. Read the complete Browser plugin Skill using its exact name from this turn's Skill catalog. Use
   an assistant response containing only the `skill` call and wait for its result. Do not assume the
   old unqualified built-in Skill name or construct a namespaced name yourself.
2. Call the `mcp_browser` tool exposed in this turn, using `action` and `input` according to its
   current tool schema and the loaded Browser Skill. Keep arrays, booleans, and numbers as native
   JSON values; do not copy a parameter table into this Skill or invent an unavailable tool.
3. Keep the work in the current interactive Session and operate on the Mini App tab selected by
   `miniapp.open`; do not supply a guessed Session/tab ID. Perform one Browser action at a time
   and inspect its result before choosing the next action.

If the plugin Skill or the `mcp_browser` tool is unavailable, report UI acceptance as `UNVERIFIED` with
the exact blocker. For a disabled plugin, ask the user to check its state in Plugins; an older Host
without this tool must be updated. Do not fall back to `request_feature_enable`, an unlisted tool,
Node code, or a background Agent. If a call returns `SKILL_REQUIRED`, re-read the current complete
Browser plugin Skill before retrying; do not require a new Session just to refresh a stale Skill receipt. If
Browser requires authentication takeover through `ask_user`, request user takeover and end the turn;
do not continue page checks or other tools before the user responds.

On an explicitly native CLI/TUI Browser surface, follow its exposed Browser Skill and tool instead.
That separate surface is not a fallback for an unavailable Desktop plugin.

For page debugging, first call the `miniapp` tool with `{ "action": "open", "pluginId": ... }`, then
use Browser `inspect`, `query`, and actions against the opened page. Use Browser evidence to
understand visible structure, text, controls, and state, then fix the current candidate or report
the external blocker. `inspect` remains a `miniapp` lifecycle summary and does not read the page.
Continue to use the `miniapp` tool for initialization, listing, opening, lifecycle inspection,
publication, restart, and stop; Browser owns page inspection and interaction only.

Before reporting a completed Mini App, read [references/acceptance.md](references/acceptance.md) and
complete its lightweight Client acceptance after `publish` → `inspect` → `open`. This is a delivery
gate for rendered page structure, visual appearance, diagnostics, and representative interaction—not
a replacement for Host package validation. If the Browser surface is unavailable, report UI
acceptance as unverified instead of claiming PASS. Keep screenshot evidence model-visible unless the
user explicitly asks to receive it.

Plugin Skills, MCP servers, and apps continue through PluginSystem. The `miniapp` tool uses
`publish` to adopt or update a package, `restart` only to restart an installed runtime,
and `stop` only to stop a user-selected Mini App runtime while preserving its accepted package. It
is not a proxy for business operations.

## 6. Report completion

Lead with what the user can now do and what was verified. Mention the access method when it
explains a setup requirement, portability limit, or troubleshooting step, not as a feature in itself.
Distinguish verified reads from write operations that have not been exercised.
Report the verified data calls, workspace package path, adopted `pluginId`, preserved Plugin
capabilities, Client and Node payload roots, publish/inspect/open results, and unverified external
dependencies. Keep credentials, Connector bridges, internal ports, private paths, and sensitive
sample values out of the response.

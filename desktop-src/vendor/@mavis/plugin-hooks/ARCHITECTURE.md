# Plugin Hooks architecture

`@mavis/plugin-hooks` is the Node-hosted execution kernel shared by Desktop and Cloud Plugin
runtimes. It owns the normalized 11-event contract, synchronous command parsing and validation,
bounded subprocess execution, deterministic result aggregation, and activation/idle lifecycle
coordination.

The package deliberately has no workspace-package dependencies. It does not read Plugin packages,
query installation state, persist conversations, publish events, or choose product lifecycle
boundaries. Desktop and Cloud adapters provide immutable handlers, authoritative event timing,
enabled-state resolution, logging, metrics, cwd, and cancellation.

Dependency direction:

```text
Plugin readers / Desktop runtime / Cloud runtime
  -> @mavis/plugin-hooks
  -> Node.js process primitives
```

Do not move product storage, UI, marketplace, or host-specific policy into this package. Do not
duplicate the command runner in either host.

Desktop prepares a Hook-session ownership claim only when a normal Turn reaches Hook admission,
binds the process-local coordinator, and then activates the durable claim. A crash before activation
therefore cannot supersede the prior owner; an admitted Turn that fails earlier and manual
compaction likewise remain invisible to the fence, and activation failure restores the prior
process-local claim. A hard process crash immediately after activation commits can still lose that
process's in-memory Hook snapshot; the durable owner prevents an older live process from duplicating
`SessionEnd`, and a later admitted Turn can take ownership again. Before `SessionEnd`, the host
atomically records a durable execution claim, providing at-most-once command admission across live
runtimes (external commands cannot be transactionally exactly-once). The maintenance lease forwards
renewal loss through `AbortSignal`; the 3-second `SessionEnd` event budget is intentionally far
below the 30-minute maintenance lease.

## Protocol boundary

Hosts emit a normalized `PluginHookEventInput` and consume a normalized `PluginHookDecision`. The
runner is the only layer that converts that internal IR to and from Compatible, Codex, and MiniMax
wire JSON. Compatible and Codex adapters remain separate where their contracts differ; MiniMax uses
the shared event and output vocabulary instead of inventing another public schema. MiniMax tool
events preserve the native Runtime tool name and input shape exposed to the model. Runtime-only
payload fields never leak to a vendor command.

Every matching synchronous command handler receives the same immutable event input. The runner
executes at most eight commands concurrently within the shared event budget, then folds results in
stable declaration order. Compatible/Codex `PreToolUse` rewrites are the exception: the last handler
to complete supplies `updatedInput`. Deny wins over ask/defer/allow. An explicit `PermissionRequest`
allow/deny is distinct from abstaining. Its allow also carries a source-aware auto-approval scope:
Compatible is `ordinary_only` because matching deny/ask rules still run, while Codex is `any_prompt`
because its Hook verdict precedes Guardian/user approval. Compatible `PreToolUse` retains its
permission allow/ask/defer semantics; Codex `allow` is rewrite-only and never bypasses the product
permission flow.

Structured output is strict: `hookSpecificOutput.hookEventName` is required and must equal the
active event. JSON is parsed before the event/source exit-code rule is applied. MiniMax-format
handlers follow the Compatible exit-code 2 rule, including its `PermissionRequest` exemption, so a
one-line shell Hook can block without writing JSON. Codex `PostToolUse` runs for both successful and
failed tool executions; block, `continue:false`, and exit-code 2 become bounded model feedback
rather than an agent hard stop. Codex does not accept tool-result replacements. Compatible keeps
structured `updatedToolOutput` only when it matches the original vendor response shape, and accepts
`updatedMCPToolOutput` only for a real MCP call. `PostToolUse` response evidence is source-specific:
the host supplies Compatible's structured result as `payload.compatible_tool_response` and Codex's
stable model-facing result as `payload.codex_tool_response`. A Pi-native `tool_result` wrapper is
never treated as either vendor's output. Missing evidence skips only the affected source's handler
with a bounded `HOOK_INVALID_INPUT` diagnostic, so Compatible and Codex Plugins can coexist in one
session.

For synchronous command Hooks, Compatible top-level `PostToolUse` `decision: "block"` keeps the tool
result successful and adds the reason as model context beside the original result. Codex block and
exit feedback use the separate `postToolFeedback` error channel. Compatible `continueOnBlock`
belongs only to prompt-handler configuration, which this release intentionally does not execute; it
is not accepted as command stdout.

Matcher grammar is source-specific: Compatible simple alternatives use `|` or `,`, while Codex only
uses `|` and otherwise treats the matcher as a regular expression. Lifecycle matchers see only the
adapted vendor value. Compatible `args` exec-form and `shell` commands are supported. Compatible
tool-event `if` predicates use tool-specific matching; simple Bash pipelines are checked per
subcommand and ambiguous shell syntax conservatively runs the Hook. Asynchronous commands and
non-command handler types remain unsupported.

Tool identity is also evidence-based. Plugin MCP names are scoped only when the host supplies a
`toolProvenance` owner; the current handler's Plugin is never assumed to own the tool. Compatible
file-tool paths are made absolute against `cwd` (including `~` expansion), Bash timeout seconds are
converted to Compatible milliseconds, and Windows local shell calls use `PowerShell`. A native tool
is renamed to Compatible's `Read` / `Write` / `Edit` / `Bash` / `PowerShell` / `Agent` identity only
when all input fields can be converted without loss. Codex receives representable native
`write`/`edit` calls as canonical `apply_patch` commands and can match `apply_patch`, `Write`, or
`Edit`; rewritten single-file patches are restored only when they can be represented safely by the
native tool. For example, MiniMax Read's PDF-only `pages` and Desktop Task's `model` / `effort` keep
the native identity instead of leaking fields into a fake Compatible schema. Compatible reverse
adapters validate the whole Hook `updatedInput` before restoring native runtime fields. Subagent
tool events retain the child execution session/turn/transcript plus `agent_id` and `agent_type`;
Compatible `prompt_id` remains the parent prompt that spawned the child. Compatible and Codex
`SubagentStart`/`SubagentStop` instead expose the parent session identity, and Codex also exposes
the parent Turn identity, matching their lifecycle protocols.

MiniMax handlers receive the native Runtime tool name and input unchanged. Matcher values therefore
stay aligned with the tools shown to the model, and `updatedInput` uses the same native tool schema.

## Configuration-owned handlers

Hosts may also pass handlers parsed from their own configuration files rather than a Plugin package.
Such a handler sets `origin` to `user` or `project`; an absent `origin` means a Plugin handler. The
kernel does not read those files or decide which entries are enabled; it only changes three things:

- Ordering: user handlers fold first, then project handlers, then Plugin handlers. Within a
  configuration origin the order is `sourcePath` then `declarationOrder`, because the host owner id
  embeds a content digest and is not a meaningful sort key. Plugin ordering is unchanged.
- Environment: configuration handlers receive `MINIMAX_HOOKS_DIR` (the configuration directory, in
  `pluginRoot`) and `MINIMAX_HOOKS_DATA` (the host-owned writable directory, in `pluginDataDir`)
  instead of the `*_PLUGIN_ROOT` / `*PLUGIN_DATA` variables. The project-directory variables are the
  same for every origin.
- Observation: `PluginHookObserver.onHandler` reports `origin` as `user`, `project`, or `plugin`.

Budgets, matcher grammar, output parsing, and lifecycle coordination are identical for every origin.
Desktop uses this for `<dataDir>/hooks.json` and `<project>/.minimax/hooks.json`, both in the
MiniMax format.

## Deliberate compatibility limits

Desktop validates the complete Compatible `PermissionRequest.updatedPermissions` array into a typed
IR, then applies rules, modes, and directories atomically through a host-owned MiniMax store. The
four Compatible destinations remain distinct; `session` is memory-only and is cleared with runtime
Session disposal, while user/project/local state is persisted under the MiniMax data directory
rather than mutating Compatible settings files. The rewritten/current tool input is rechecked
against the effective post-update policy before execution. `dontAsk` denies unresolved asks.
`bypassPermissions` takes effect only when the Session already has the product-owned launch
capability, is always Session-only even when the requested destination is persistent, and otherwise
is a no-op. `setMode(plan)` is the one explicit limit: MiniMax Plan mode has a separate Turn
lifecycle and cannot be switched safely from a permission callback, so an array containing it is
rejected atomically with a bounded, user-visible tool denial. Cloud explicitly rejects local
permission mutations because it has no Desktop settings destination. Codex does not define
`updatedPermissions` and rejects the field.

Known Compatible output fields without a stable product consumer are recognized and safely ignored:
`classifierContext`, the newer SessionStart UI mutation fields (`initialUserMessage`, `watchPaths`,
`sessionTitle`, and `reloadSkills`), and UserPromptSubmit's `sessionTitle` and
`suppressOriginalPrompt` do not invalidate supported decisions or context in the same response.
Codex-only unsupported controls remain invalid and produce a bounded diagnostic, but a schema-valid
`systemMessage` from that response is still retained as a warning, matching Codex. Unknown or
malformed vendor output remains strict and fails open without exposing partial output.

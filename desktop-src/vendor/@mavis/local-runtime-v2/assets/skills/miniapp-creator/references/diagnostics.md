# Publish diagnostics

Use only these evidence sources:

1. for workspace authoring, the candidate at the exact `packagePath` returned by `miniapp.init` and
   its declared files; for a finished package, the exact user-selected `sourcePath` under
   [finished-package.md](finished-package.md), inspected without changing it;
2. this Skill's references;
3. structured `miniapp` publish and lifecycle inspect results. The public error contract contains a
   stable public `code`, `retryable`, and public `message`. A classified preparation failure also
   contains `diagnostic.stage`, `diagnostic.reasonCode`, `diagnostic.recovery`, and
   `diagnostic.hint`; an `INVALID_ARGUMENTS` Host Connector error may instead contain value-free
   `diagnostic.issues`; a current runtime startup failure may additionally contain Host-owned
   `runtimeError.errorText` and optional `runtimeError.stderr`. An unexpected Host failure uses
   `INTERNAL_ERROR`, includes an automatically generated `diagnosticId`, and may include
   `lastGoodAvailable` for a failed update;
4. Browser inspect, query, and action results after opening the board with `miniapp.open`.

## Official Plugin editing

Official Mini App implementations do not support local editing or republishing. An
`OFFICIAL_PLUGIN_READ_ONLY` diagnostic explains the official-source restriction behind
`PLUGIN_ALREADY_EXISTS`: this is a product policy, not an OS permission failure. Keep the official
implementation and installation cache unchanged.

If the source is unavailable or unknown, report that it could not be verified and ask the user to
clarify the target; do not assume it is local.

If an official Mini App was edited, stop further changes and tell the user. If the user chooses to
keep the edits, preserve them under a new `pluginId` through the existing local Creator workflow.
Recover the original official version separately.

## Manifest compatibility failures

- `MINIAPP_MANIFEST_FIELD_UNSUPPORTED` names a top-level `miniapp.json` field this MCode version
  does not know. On an installed Host it means the Host is older than the package; either update
  MCode or remove the field. Hosts older than this diagnostic report the same situation as
  `MINIAPP_MANIFEST_INVALID`.
- `MINIAPP_ENGINES_INVALID`: `engines.mcode` must be `">=MAJOR.MINOR.PATCH"`.
- `MINIAPP_TOOL_ACCESS_INVALID`: `toolAccess` must be `["call"]`, the only accepted value. The
  former `{ "mcp": [...] }` object is no longer accepted.
- `MINIAPP_HOST_TOO_OLD` (`user_action`): the Host is older than the package's `engines.mcode`, so
  `publish` refuses the workspace. Tell the user to update MCode, or lower the bound if the package
  does not actually need newer Host features. Do not keep republishing an unchanged workspace.

## Source selection failures

These `PREPARATION_FAILED` diagnostics use `user_action`. Follow the returned hint while preserving
the supplied source; neither the code nor the hint grants source-editing authority.

An explicit source failure never permits retrying without `sourcePath` to select a different
workspace package. An unchanged invalid source is not a reason to repeat publication.

## Inspect an open surface

Call `{ "action": "inspect", "pluginId": "..." }` to read `diagnostics`:

- `run` identifies the current or latest run, with preparation and readiness times and any confirmed
  exit time and details. `current` indicates whether it is still the current runtime. A preparation
  failure does not prove that the Host observed a process exit.
- `failure` is the failure currently reported by the Host. `run.failure` applies only to the
  displayed run, not to later runs. Error descriptions come from a fixed public catalogue.
- `logs.entries` contains a bounded list of Host startup, readiness, failure, and exit records.
  `truncated` indicates that records were trimmed. `omittedCount` counts received plugin log events
  excluded from the public view, not lost bytes.

Diagnostics are kept only in Host runtime memory and are cleared when the Host restarts. They do not
read the page, full logs, or business data, and do not prove that business results were saved. Treat
missing times, exit codes, and failure reasons as unknown. Inspection is read-only and does not
start or restart the plugin; choose `open` or `restart` from the actual error and user intent.

Follow [Browser page operations](../SKILL.md#browser-page-operations) for the current `mcp_browser`
tool and for missing or stale Skill handling.

Use `miniapp.inspect` for the installed board and runtime lifecycle summary. To debug page content,
first call `miniapp.open(pluginId)`, then use Browser `inspect`, `query`, and actions against the
opened page. Continue diagnosis from Browser-visible structure, text, controls, state, and the
current candidate. Lifecycle operations remain owned by the `miniapp` tool; do not use Browser
actions to publish, restart, or stop a board.

Public messages and catalogue diagnostics come from a closed Host catalogue and are normalized; they
do not expose the original Host or Plugin error text. Only Host-owned `runtimeError` returned by
`miniapp` is evidence for the current runtime startup failure. Read `runtimeError.errorText` and
optional `runtimeError.stderr` exactly as returned and treat both as opaque text; do not parse or
infer a format. Connector/provider raw errors and other private logs are not runtime startup
evidence and must not be mixed into these fields. Apply `edit_workspace` only to the current
authoring candidate; a finished package requires a separate editing request. Use `retry` only after
its stated condition settles, and follow only the concrete user action named by the hint when
recovery is `user_action`. `user_action` always names an action the
user can actually perform, such as authorization or choosing a running board; it never asks the user
to contact a Host owner. When `diagnostic` is absent, treat the message as generic and do not infer
a hidden reason. Complete candidate validation before publishing.

For `INVALID_ARGUMENTS`, use the public error `code`, generic `message`, value-free
`diagnostic.issues`, and the matching current inventory `inputSchema` to correct the candidate's
request. Each issue identifies only a schema `path`, `constraint`, and optional numeric `limit`; it
never exposes the rejected value.

If Browser inspection shows only a generic `CONNECTOR_PROVIDER_ERROR`, treat its cause as unknown
rather than inferring an authorization failure. Recover the provider, tool name, and arguments from
the current candidate; validate them against the current Connector inventory and input schema; then
use the same Agent Connector for an equivalent read-only probe with those public arguments. Diagnose
from that probe's public error. Never replay a create, update, delete, or other mutation merely for
diagnosis.

For `BUSY`, branch only on `busyReason`:

- `operation_busy`: delay once and retry the same requested operation exactly once. If
  `operation_busy` repeats, report it and stop. If the retry returns `capacity_busy`, enter the
  capacity branch immediately.
- `capacity_busy`: call `{ "action": "list" }` exactly once, present the boards whose runtime status
  is `running`, ask the user which one to stop, and end the turn. Before the user replies, issue no
  `sleep`, retry, `inspect`, `restart`, `publish`, `open`, or `stop` action.
  Admission runs before the package is staged and validated: on a full device, the first `publish`
  of a board that is not running returns `capacity_busy` before any manifest or validation error.
  After the user frees a slot, the retry reports validation errors as usual.
- User reply: call `stop` only for the selected `pluginId`. Only a successful stopped result proves
  capacity release and permits exactly one retry of the original blocked operation. A failed,
  cancelled, or unproven stop leaves the requested board blocked.

Never issue dependent `stop`, `publish`, or `open` calls in parallel.

Host repository source, sibling candidates, installed plugin copies, runtime SQLite,
Connector/provider raw errors, logs not returned as `miniapp` `runtimeError` or
`inspect.diagnostics`, and simulated Host child processes are outside the authoring evidence
boundary. A candidate should not be patched to mimic or bypass private Host behavior.

For `INTERNAL_ERROR`, do not edit the candidate or repeat the same lifecycle action based only on
that result. The Host generates `diagnosticId` and records it automatically. Tell the user that this
attempt failed and whether `lastGoodAvailable` says the previously accepted board remains usable. Do
not call `inspect` merely to rediscover the same information.

Report the final public code, retryability, public message, structured diagnostic when present,
candidate checks, adoption status, automatic diagnostic ID when present, and any current-startup
`runtimeError` fields exactly as returned. Do not reinterpret those fields or add internal paths,
ports, credentials, Connector/provider raw errors, or unrelated logs.

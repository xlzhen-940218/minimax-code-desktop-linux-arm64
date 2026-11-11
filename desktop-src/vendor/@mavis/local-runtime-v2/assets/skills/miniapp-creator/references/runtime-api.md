# Mini App runtime authoring API

This Skill ships an authoring snapshot, not a runtime package. The Host owns the implementation and
injects values through `start(context)`. Generated plugins do not install or import a Mini App SDK
from npm.

## Type-checking setup

For a new package, copy [miniapp-api.ts](miniapp-api.ts) beside the Node source, for example at
`miniapp/node/miniapp-api.ts`, and include it in the project's TypeScript configuration. TypeScript
source may use a relative type-only import:

```ts
import type { MiniAppContext, MiniAppModule } from './miniapp-api.js';

export const start: MiniAppModule['start'] = async (context: MiniAppContext) => {
  return { dispose: async () => {} };
};
```

JavaScript can follow [node-entry.mjs](node-entry.mjs), whose JSDoc import is erased at runtime.
Inspect the built Node artifact and verify that it contains no runtime SDK import or `require`.

## Injected context

- `pluginId` and `pluginRoot` identify the accepted package.
- `dataDir` is the Host-owned runtime data root already isolated for the plugin. Keep runtime state
  there, not in the workspace package or artifacts.
- `listen.host` and `listen.port` are the assigned loopback binding. Do not select or probe a port.
- `signal` cancels startup, requests, and background work.
- `logger` accepts stable event codes and non-sensitive structured fields.
- `hostConnector` exists when the manifest declares at least one `hostConnectorAccess` provider.
- `agent` exists when the manifest declares `agentAccess` (`"session.run"` and/or
  `"session.read"`); see [Agent](#agent).
- `tool` exists when the manifest declares `toolAccess: ["call"]`; it calls the MCP and Connector
  tools installed on this Host, each judged by the user's permission rules. See [Tool](#tool).
- All three follow the manifest, not the user's permission switches: a provider, `agentAccess` value
  or `tool:call` the user switched off keeps the object, and its calls fail with
  `CONNECTOR_NOT_PERMITTED` / `NOT_PERMITTED` / `TOOL_NOT_PERMITTED` until switched back on (see
  [package-contract.md](package-contract.md)).
- `capabilities.has(name)` answers synchronously whether this Host version supports a feature, named
  by its API path (`message.append`, `agent.run`, `agent.open`, `agent.models`, `agent.agents`,
  `agent.create`, `agent.observe`, `agent.sessions`, `agent.session`, `window`, `hostConnector`,
  `tool`, `tool.request`). The list is Host-wide and does not distinguish Node from the page:
  `has('window')` is true here although only the page has `window`. It does not reflect the manifest
  or grants: `has('agent.run')` is true even when `agent` is absent. Older Hosts omit
  `capabilities`; write `context.capabilities?.has('agent.run')` when the package must also run
  there.

Host Connector uses Node IPC internally; the public `context.hostConnector` API is unchanged.
`stdout` no longer carries the protocol, so ordinary output is not parsed as Connector messages.
Prefer `context.logger` for diagnostics. The Host collects only bounded stdout/stderr samples; keep
logs free of credentials and business content, limit their volume, and do not rely on complete log
retention.

Resolve `start(context)` only after the HTTP listener is accepting connections and all declared
routes are installed. Resolution is the process readiness signal; the plugin does not expose a
readiness route. Keep `start(context)` limited to installing routes and starting the server. Return
a `dispose()` lifecycle that closes HTTP, SSE/WebSocket connections, child processes, timers,
subscriptions, and persistence handles. The Node entry is the Host's direct root and must stay alive
while the board is available; it can proxy to a backend it owns. Do not fetch business data
synchronously in `start(context)`; register the request handlers and resolve readiness instead.

`dispose()` must finish within 2 seconds. When the Host stops the entry it waits 2 s, then sends
`SIGTERM`, then force-kills the entry 2 s later; on Windows `SIGTERM` already ends the process
forcefully. Do not defer durable writes to `dispose()`: while the board is not visible the Host may
stop the entry to free memory or a service slot without notice, and a forced end runs no callback.
Persist state to `dataDir` as it changes, using atomic writes (temporary file, then rename) or a
transactional store. Polling, heartbeats, or held requests do not keep the backend alive: page
traffic and in-process timers are not use. While the Host is serving a request from the backend, and
for 10 minutes after the last one ends, the board is not put to sleep to free a slot for another Mini
App, and under critical memory pressure it is reclaimed only after idle boards. That is never a
guarantee: a board that is not visible may still be stopped. Phase 1 offers no keep-alive grant, so
persist continuously and resume after a restart. See [security-and-state.md](security-and-state.md#reclaim-and-restore).

## Loopback authentication

The Host installs an authentication guard on `http.Server` inside the Node process before it loads
the entry, so plugin code needs no auth logic and never sees the credential. The Desktop page and
the managed MCP client send a per-run Host credential; every other request to the assigned port
receives `401` (WebSocket upgrades are closed) before any plugin handler runs. The credential header
is removed before a request reaches plugin code. After the plugin resolves `start(context)`, the
Host confirms that the guard answers on the assigned port and only then treats the board as ready.

The guard patches `http.Server.prototype`, so it covers every `node:http` server the process
creates, not only the one bound to `context.listen.port`. A second internal port the entry opens for
itself (for example an OAuth callback listener, or the entry calling back into its own assigned
port) is guarded the same way and returns `401` to any caller — including a third-party redirect —
that does not present the credential header. Route flows that must accept unauthenticated
third-party requests through the assigned port's own handler, or through a listener outside this
process, instead of a second in-process `node:http` server.

- Serve the assigned `context.listen` port with a `node:http` server (`createServer` directly or a
  framework built on it). Do not bind that port with `https`, `http2`, a raw `net` server, or a
  child process: the guard cannot protect those, so the board never becomes ready and startup fails
  with `READINESS_TIMEOUT`. A backend in another runtime must listen on its own internal port behind
  a proxy in the Node entry.
- The `/__mavis/` path prefix is reserved for the Host. Do not declare or handle routes under it.
- Build page requests from relative or same-origin URLs. Requests from a Service Worker, a popup, an
  external browser, or an ordinary Browser tab do not carry the credential and receive `401`; do not
  depend on them. Do not try to read, forward, or log authentication headers.
- A process restart issues a new credential. An already-open Desktop tab keeps its old credential
  and gets `401` until the user clicks Refresh or opens the board again; there is no push channel
  that updates it automatically. This is expected after a restart triggered without a follow-up open
  (for example, the Agent restarting the board without reopening it) or after the process crashes
  and gets reactivated; it is not a plugin bug.

## Data access methods

`hostConnector` is optional and does not prevent the Node service from using a CLI, HTTP API, SDK,
or authorized files. See [data-access.md](data-access.md) for method selection, child process
management, and verification in the actual runtime. The Host Connector rules below apply only to
calls using that method.

## Host Connector

Use `context.hostConnector` only in the Node runtime. `hostConnector.list()` is available before the
service accepts calls, so request handling may inspect the allowed inventory. `hostConnector.call()`
is available only after activation. Select a tool by its verified provider, name, and input schema.
Call `hostConnector.call()` only from an HTTP or other request handler after publication activation.
Do not perform business calls inside `start(context)`, construct or store tool refs, send them to
the Browser, or expose the Host bridge from a page route.

Refresh inventory after process startup or a stale-reference error. `CONNECTOR_NOT_PERMITTED` means
the user switched that provider off for this Mini App: nothing was sent, the provider is missing
from the next `list()`, and the same tool ref works again once the user switches it back on. For `unknown_after_dispatch`,
reconcile by reading domain state before retrying a write. Check caught errors against the exported
`HostConnectorError` shape: `code`, `message`, `disposition`, `retryable`, optional `invocationId`,
and optional `diagnostic.issues`. For invalid arguments, use each issue's `path`, `constraint`, and
optional numeric `limit` together with the matching inventory `inputSchema` to correct the request.
Diagnostics never contain the rejected argument values. Do not depend on `instanceof` across a
process boundary.

### Decoding call results

`HostConnectorCallResult.value` is the raw provider result. The Host preserves its JSON shape; it
does not normalize service-specific payloads. Compare the observed value with the sanitized probe
[fixture](fixtures/host-connector-call-result.json), then copy
[host-connector-value.mjs](host-connector-value.mjs) beside the Node source when the value needs
transport decoding.

The fixture's single text-block array is a probe-observed provider shape, not a global Host
contract. The helper recognizes it only when the root is an array of exactly one object whose only
fields are `type: "text"` and a string `text`. Only after removing that shape once does it decode at
most four JSON-looking layers from the extracted root text. Direct strings are never decoded. Direct
objects, ordinary arrays, primitives, multiple content blocks, and all other `JsonValue` shapes pass
through unchanged. Do not recursively decode provider-owned object fields, including fields named
`content`, `text`, or `value`. Malformed JSON-looking extracted text and excessive JSON string
nesting are parse errors rather than empty data.

Keep transport decoding separate from the provider/domain parser. Treat zero parsed domain items as
success only when the decoded provider result explicitly represents an empty result according to the
response shape proven during the authoring probe. If the decoded provider result contains source
data but the domain parser produces zero items, fail the request as a parse error. Never infer an
explicit empty result merely from the parser returning an empty array.

The Browser calls narrow business routes exposed by the board's Node service. Credentials, Connector
clients, and Host transport never enter Client code.

## Tool

`context.tool` calls the tools the Host has installed outside the Agent core: every Plugin's MCP
servers (this Plugin's included), the user's `mcp.json` servers, the Host's built-in MCP servers,
and every Connector provider the user has connected. Agent built-in tools (files, shell, browser)
are not reachable. It is present whenever the manifest declares `"toolAccess": ["call"]` (see
[package-contract.md](package-contract.md)). The user can switch `tool:call` off in the Mini App's
permission panel at any time: `context.tool` stays, nothing restarts, new `call()`s fail with
`TOOL_NOT_PERMITTED`, `list()` reports every tool as `deny`, and `request()` answers `deny` for
every name without a prompt. A call already running finishes. Handle
`TOOL_NOT_PERMITTED` instead of checking whether `context.tool` exists. Hosts without it answer
`capabilities.has('tool')` with false; `request()` needs `capabilities.has('tool.request')`.
`context.hostConnector` keeps working unchanged.

```ts
const { tools, partial } = await context.tool.list();
const search = tools.find(
  (tool) => tool.kind === 'mcp' && tool.server === 'notes' && tool.tool === 'search',
);
if (search && search.permission !== 'deny') {
  const result = await context.tool.call(search.name, { query: 'budget' }, { signal });
}
```

- A tool is named by its runtime name, the one an Agent sees: `mcp__<server>__<tool>` for MCP and
  `connector__<provider>__<tool>` for Connectors. The Host may shorten or disambiguate MCP names, so
  do not build or hard-code them: take `name` from `list()`, matching on `kind`, `server` /
  `provider` and `tool`. An unknown name fails with `INVALID_ARGUMENTS` (list again).
- `list()` returns `{ tools, partial }`; each tool is
  `{ name, kind, server | provider, tool, description?, inputSchema, permission }`. `permission`
  (`allow` / `ask` / `deny`) is what a call would meet now; it is informational, and every call is
  judged again. `partial` is true when a source could not be listed (Connector login, an MCP server
  that failed or is still starting); the listed tools are still callable. `list()` rejects only when
  every source failed.
- Stable names you may write directly: on Desktop the Matrix tools come from the `matrix` Connector,
  for example `connector__matrix__web_search`; the built-in Matrix MCP server is not mounted there.
  Which Matrix tools exist depends on the account; check `list()` before relying on any other name.

### Permission

`toolAccess: ["call"]` only lets the Mini App ask. Every `call()` is judged by the same permission
rules an Agent meets, read from the user's global rules and global permission mode (agent and
session rules do not apply: a Mini App call belongs to no Agent or session):

- `allow` runs the tool. With no rule, MCP and Connector tools are allowed, as for an Agent;
  arguments that name paths outside the Host data directory ask.
- `deny` fails with `TOOL_NOT_PERMITTED`.
- `ask` shows a Host prompt naming this Mini App, the tool, its server or provider and the
  arguments, with **Allow once**, **Always allow** and **Deny**. Always allow writes the same global
  rule as the chat approval card, so it also applies to Agents; Allow once and Deny are not stored.
  The prompt appears in the Host window when it is visible or when this Mini App has an open page.
  When nobody can be asked the call fails with `TOOL_APPROVAL_REQUIRED`. The prompt waits at most
  five minutes (`TOOL_TIMEOUT`, `not_dispatched`).
- Host built-in tools run without a check, as for an Agent. Plugin hooks (`PreToolUse` /
  `PostToolUse`) do not run for `context.tool`: hooks respond to Agent activity only.
- The Host owns the prompt; Mini App code cannot draw, answer or skip it.

### Asking ahead: `request()`

When the Host window is hidden and no page of this Mini App is open, an `ask` fails with
`TOOL_APPROVAL_REQUIRED`. Ask for "always allow" while the user is present instead:

```ts
// Page: in a click handler, e.g. a "Connect tools" button shown on first open.
const permissions = await window.mcode?.miniapp?.tool?.request([searchName, sendName]);
// Node: from request handling while the page is open.
const state = await context.tool.request([searchName]);
```

- One Host prompt lists the named tools that are still `ask`, each with a checkbox; tools already
  `allow` or `deny` are left out. Always allow writes a global rule for each ticked tool. The result
  maps every name to its state afterwards; it is for your UI only, the Host never trusts it back.
- Three limits keep prompts rare: the page may call `request()` only inside a user gesture
  (otherwise `invalid_request`), one request names at most 10 tools (otherwise `INVALID_ARGUMENTS` /
  `invalid_request`), and nothing already decided is asked again.
- In Node, when nobody can be asked it rejects with `TOOL_APPROVAL_REQUIRED` and the error carries
  `permissions`, the unchanged state. The page `request()` needs the Node process to be running.
- Names come from Node `list()`; pass them to the page through your own route.

### Results and errors

- A Connector result is `{ invocationId, kind: 'connector', value }`; `value` is the raw provider
  result, decoded as in [Decoding call results](#decoding-call-results). An MCP result is
  `{ invocationId, kind: 'mcp', isError, content, structuredContent? }`. `isError: true` is the MCP
  tool reporting its own failure: the call still resolves, and `content` keeps the tool's error
  text. Show or log it instead of treating it as a transport error.
- Connector tools time out after 30 seconds and MCP tools after at most 120 seconds, counted after
  any prompt. An MCP server that does not answer within its own `timeout` fails the call with
  `TOOL_TIMEOUT` and `unknown_after_dispatch`: the tool may have run.
- `context.tool` and `context.hostConnector` share this process's one Connector inventory. A listing
  through `hostConnector` can supersede `context.tool`'s Connector handles; `context.tool` then
  lists again once by itself. `hostConnector` refs are not refreshed for you.
- A result must fit one 8 MiB frame. A larger one, usually inline base64 images, fails the whole
  call with `TOOL_RESULT_TOO_LARGE` even though the tool ran, and none of its content (text or
  `isError`) reaches you. Have such a tool write the file and return its path or URL, or ask it for
  a smaller result; do not repeat a write blindly.
- A server this Mini App serves through `mcpEndpoints` runs in this same Node process: call your own
  function, not `context.tool`.
- The page has only `tool.request()`; listing and calling stay in Node. Expose narrow business
  routes from Node instead.

Errors use the `HostConnectorError` shape. The `code` names the cause; only `disposition` says
whether the tool may have run. `not_dispatched` means nothing reached the tool, so retrying is safe
when `retryable` is true; `unknown_after_dispatch` means the tool may have run, so read the domain
state before repeating a write. The Host never retries.

| `code`                   | Cause                                                                            | `disposition`                                | `retryable`                     |
| ------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------- |
| `INVALID_ARGUMENTS`      | The name is not listed (list again), or the arguments or name list are malformed | `not_dispatched`                             | false                           |
| `TOOL_NOT_PERMITTED`     | `tool:call` switched off, a deny rule, or the user chose Deny                    | `not_dispatched`                             | false                           |
| `TOOL_APPROVAL_REQUIRED` | The rules ask and no Host window can show the prompt                             | `not_dispatched`                             | false                           |
| `TOOL_REF_STALE`         | The tool disappeared between listing and the call; list again                    | `not_dispatched`                             | false                           |
| `TOOL_UNAVAILABLE`       | Tools are not available to this process yet, or the Host failed first            | `not_dispatched`                             | as reported                     |
| `MCP_SERVER_UNAVAILABLE` | The MCP server failed or is still starting                                       | `not_dispatched`                             | true                            |
| `SERVICE_RESTARTED`      | The Mini App is restarting                                                       | `not_dispatched`                             | true                            |
| `TOOL_TIMEOUT`           | The prompt or the call ran out of time, or the MCP server hit its own timeout    | `not_dispatched` or `unknown_after_dispatch` | true only when `not_dispatched` |
| `REQUEST_CANCELLED`      | Your `signal` aborted the call                                                   | `not_dispatched` or `unknown_after_dispatch` | false                           |
| `TOOL_RESULT_TOO_LARGE`  | The tool finished but its result exceeds 8 MiB                                   | `unknown_after_dispatch`                     | false                           |
| `TOOL_OUTCOME_UNKNOWN`   | The outcome was lost for another reason, such as the channel closing             | `unknown_after_dispatch`                     | false                           |

Connector tools also keep their Connector codes: `INVALID_ARGUMENTS` with `diagnostic.issues` for
arguments that do not match the schema, `CONNECTOR_PROVIDER_ERROR` (`provider_reported`), and
`CONNECTOR_UNAVAILABLE` (`not_dispatched`).

## Agent

Call `context.agent.run({ text, sessionId?, model?, agent?, whenBusy? }, { signal?, onEvent? })` from a request handler after
activation, never inside `start(context)`. It runs one turn with the session's Agent and its full
capabilities (files, shell, Skills, and MCP including this Mini App's own), and resolves when the
turn ends with `{ sessionId, turnId, model?, status, text?, error?, pendingQuestion? }`. Page-initiated runs
use the agent of the chat session the Mini App is open in; Node-initiated runs, and pages not opened
from a session, use the primary Agent unless `agent` is passed (see `agents()` below); continuing a
session keeps its agent. A page-initiated
session works in the project directory of its chat when that chat has one; otherwise, and for
Node-initiated runs, the Agent works in this Mini App's own Agent directory; a continued session
keeps its directory. A new session takes the model and thinking level of the chat it was created
from (the runtime default when the chat has none or the session is Node-created), and keeps them.
`run` / `answer` may pass `model` to switch the session's model first; the Host validates it the way
the composer validates a new session's model (the model must be one the user can see in `models()`)
and rejects an unusable one with `INVALID_ARGUMENTS`. A model whose BYOK credentials are missing is
accepted here, and the turn then ends with `status: 'error'`. Results and `turn.started`
carry the model the turn was dispatched with. `status` is `finished`,
`error`, or `aborted` (or `steered`, only with `whenBusy`, below); `text` is the final assistant reply. Pass the returned `sessionId` to
continue the same conversation; each Mini App can only continue its own sessions. Aborting `signal`
cancels the turn: a started run resolves with `status: "aborted"` once the Host confirmed the abort
and rejects with `AGENT_OUTCOME_UNKNOWN` when it could not; one not yet sent rejects with
`REQUEST_CANCELLED`.

### Follow-ups while the session is busy (`whenBusy`)

Without `whenBusy`, `run({ sessionId })` on a busy session rejects with `BUSY`
(`reason: 'session_busy'`): the session is running a turn, whoever started it (an earlier call, the
chat side panel, or the Host itself, for example to report a background task the Agent left
running), is compacting, or has messages queued ahead (such as ones the user stopped). The text
reaches no turn, so sending it again later runs it once. `whenBusy` picks one of the Desktop
composer's two follow-up behaviours instead. It needs `sessionId`; on an idle session both start a
turn like a plain `run`.

- `whenBusy: 'queue'` — the text waits in the session queue (the one the chat side panel shows,
  read-only) and runs as its own turn once the turns ahead of it finished. You get `run.queued`
  with its queue `position`, then the call follows that turn and resolves like any `run`.
- `whenBusy: 'steer'` — the text is handed to the running turn, which reads it at its next input
  point (after the current tool call or step) and adjusts what it is doing. You get
  `message.pending`, then `message.steered` once it was read, and the call resolves with
  `{ sessionId, turnId, status: 'steered' }`: no `text`, because the reply belongs to the running
  turn, and whoever runs that turn (usually your own earlier `run`) receives it. If the running turn
  answers before reading the text, the text runs as the next turn instead and the call follows it
  like `'queue'`. If the running turn is stopped, the text stays in the conversation without
  running and the call still resolves `steered`.

Cancelling a queued call removes its text from the queue (`REQUEST_CANCELLED`); once the text
opened its own turn, cancelling stops that turn as usual. A steered text cannot be withdrawn: a
cancel before the running turn read it rejects with `AGENT_OUTCOME_UNKNOWN` and does not stop that
turn. When the user stopped the session while messages were queued, the queue is paused: a
`whenBusy` call then waits behind those messages until the user resumes the queue or sends from the
chat (which resumes it), unless nothing is left queued, in which case it starts right away (as
Desktop's send does). A waiting call keeps its run slot; cancel it to free the slot. While a
steered text waits to be read, the running turn does not ask the user a new questionnaire, as with
Desktop's steer.

For a chat bot, send every incoming message with `run({ sessionId, text, whenBusy: 'queue' })` and
post each result's `text`; use `'steer'` for messages meant to change the work in progress, and post
nothing for a `steered` result. A steered text joining a turn the user started from the side panel
is answered only in that panel.

For business prompt construction, controls, and application transport cleanup, follow
[agent-interaction.md](agent-interaction.md). This reference defines the Host API contract.

### Interaction

The Mini App renders the Agent's interaction itself. Two interactions block a turn, and each maps to
one event and one reply:

- `permission.requested` → `reply`: a tool call waits for approval. Decide it with `allowOnce` or
  `deny`; there is no `allowAlways`, because a Mini App does not write the user's global rules.
- `question.requested` → `answer`: the turn paused on a questionnaire (`ask_user`, a feature enable,
  or a Plan review). `request` is the same questionnaire the Host chat renders; the answer starts
  the continuation turn, which you observe like `run`.

A permission request waits only while someone can answer it: (a) the run that owns the session
passed `onEvent` (page or Node), or (b) the session is currently shown in a chat side panel through
a page's `open`. Otherwise it is denied, and the model is told that
nobody can answer it and should continue without the tool. Where the session was created does not
count: a session started from a chat does not wait on its own. Closing the side panel tab ends (b);
from then on the page or Node code must handle `permission.requested` itself or call `open` again. A
questionnaire nobody listens to ends the turn with `result.pendingQuestion`; continue with `answer`.
A run that passes `onEvent` must handle `permission.requested` itself, or it waits until `cancel`,
abort, or the page closes. The panel in (b) is reported closed when the Host window reloads or closes;
after a runtime restart or the deletion of the host chat, the page must `open` again. There is no timeout: a waiting run
is released by cancel or abort, process exit, or republish.

Node code cannot open a session in a chat side panel (it has no host chat). A page can open any
session this Mini App owns, whichever chat or Node run created it (`open` in
[client-api.md](client-api.md)); while that tab stays open, permission requests of the session wait
for it even when a Node run continues the session without `onEvent`.

- `context.agent.reply({ sessionId, requestId, decision })` decides a `permission.requested` while
  its run is still waiting; `decision` is `allowOnce` or `deny`. A request that is unknown or
  already settled rejects with `REQUEST_NOT_FOUND`.

  Node allows up to 16 outstanding `run` / `answer` / `models` / `agents` / `create` and Connector
  requests together, independently of the Host FIFO. Permission `reply` requests have a separate
  limit of 16, so a full ordinary request budget still permits replying. Exceeding either Agent
  request group's limit rejects with retryable `AGENT_UNAVAILABLE`; completion releases its slot.
  `create` takes no Host run slot but still uses the ordinary Node request budget.

- `context.agent.answer({ sessionId, requestId, answers, model? }, { signal?, onEvent? })` answers the
  questionnaire `requestId` from `question.requested` or `result.pendingQuestion`; both carry the
  questionnaire as `request`, so a run without `onEvent` can render it too. `answers` holds one
  `{ stepId, selectedOptionIds, selectedOther, otherText?, skipped? }` per step. It resolves like
  `run`; an unknown or already settled questionnaire rejects with `REQUEST_NOT_FOUND`, and an answer
  that was recorded but whose continuation turn was not observed rejects with
  `AGENT_OUTCOME_UNKNOWN`. Call it after the paused `run` resolves: that run still holds the
  session's single-run slot while `question.requested` is delivered, so an earlier `answer` rejects
  with `BUSY`. `answer({ model })` switches the session's model before the questionnaire lookup, so a
  `REQUEST_NOT_FOUND` answer still leaves the model switched.
- `context.agent.models()` returns the available model catalog `models[]` and the runtime `default`;
  Node has no `host` entry. `default` is a selection carrying the global variant / thinking, ready
  to pass as `model` to `run` / `answer`. To select a catalog entry `option`, construct
  `{ providerId: option.providerId, modelId: option.modelId }` and add a selected `variant` if
  needed. If the model supports thinking and the user selects an effort from
  `option.thinking.efforts`, pass `thinking: { effort }`. The catalog's
  `thinking: { efforts, default? }` describes capabilities; the request takes
  `thinking: { effort }`. Preserve `variant: ''`: it explicitly turns thinking off. `models()`
  rejects with `INVALID_ARGUMENTS` when the runtime has no usable default model.
- `context.agent.agents()` lists the agents the user has configured (`name`, `displayName`,
  `primary`). `create({ agent })` or a first `run({ agent })` starts the session as that agent
  instead of the default; `name` must come from this list, and the alias `main` is rejected. A
  session never changes its agent, so continuing with `agent` is `INVALID_ARGUMENTS` — create a new
  session to hand work to another agent. The plugin directory follows the chosen agent.
- `context.agent.create({ agent? })` creates a session (agent, this Mini App's Agent directory, the
  runtime default model) without running a turn and returns `{ sessionId }`; continue it with
  `run({ sessionId })`. It takes no run slot. A session created by a page bound to its chat can be
  continued here the same way once the page hands over its `sessionId`.

```ts
import type {
  MiniAppAgentClient,
  MiniAppAgentQuestionAnswer,
  MiniAppAgentQuestionnaire,
  MiniAppAgentRunEvent,
} from './miniapp-api.js';

// Your own UI round trips, for example an SSE push to the page and a POST back.
declare function askUser(request: MiniAppAgentQuestionnaire): Promise<MiniAppAgentQuestionAnswer[]>;
declare function confirmTool(toolName: string, reason: string): Promise<boolean>;

async function runWithQuestions(agent: MiniAppAgentClient, text: string) {
  const onEvent = (event: MiniAppAgentRunEvent) => {
    if (event.type !== 'permission.requested') return;
    // The run waits for this decision; the event names the session even on its first run.
    void confirmTool(event.toolName, event.reason)
      .then((allowed) =>
        agent.reply({
          sessionId: event.sessionId,
          requestId: event.requestId,
          decision: allowed ? 'allowOnce' : 'deny',
        }),
      )
      .catch(() => {}); // REQUEST_NOT_FOUND: the run was cancelled meanwhile.
  };
  let result = await agent.run({ text }, { onEvent });
  // Answer only after the run resolves: until then it holds the session's single-run slot.
  while (result.pendingQuestion) {
    const answers = await askUser(result.pendingQuestion.request);
    result = await agent.answer(
      { sessionId: result.sessionId, requestId: result.pendingQuestion.requestId, answers },
      { onEvent },
    );
  }
  return result;
}
```

`onEvent` receives progress events `{ type, sessionId, turnId, ... }`. Every event except
`run.queued` names its session, so `reply` works before the `run` that created the session returns.
Ignore any `type` you do not know; new types may be added.

- `run.queued` — the call waits; `position` is its 1-based place in line. Sent once per wait,
  before the turn starts: it has no `turnId`. It means all run slots are taken (it carries `sessionId` only when
  the call continues a session), or, with `whenBusy: 'queue'`, that the text waits in the session
  queue. A `whenBusy` call can get it twice: first for a run slot, then for the session queue.
- `message.pending` / `message.steered` — only with `whenBusy: 'steer'`: the text was handed to the
  running turn `turnId`, then read by it. `message.steered` is the call's last event.
- `turn.started` — the Agent began the turn; `model` is the model it was dispatched with.
- `text.delta` — `text` is the next piece of the reply as it streams.
- `message.committed` — `text` is one complete assistant message; a turn can have several.
- `tool.started` — the Agent called the tool `name`.
- `tool.finished` — that tool returned; `ok` is `false` when it failed.
- `permission.requested` — the tool `toolName` waits for `reply`; carries `requestId`, `reason`, and
  `toolInput?`. When the Agent delegated to a child session, the child's asks arrive here with the
  child's own `sessionId` and `turnId`; `reply` with those and do not filter events by the root
  turn, or the run waits forever.
- `question.requested` — sent just before `turn.finished` when the turn paused; carries `requestId`,
  `mode` (`questionnaire`, `feature-enable`, or `plan`), and `request`, whose `steps` each have an
  `id`, a `question`, `selectionMode`, and `options`; `request.modePayload` holds the Plan review
  Markdown.
- `turn.finished` — last unless the call ended `steered`; carries the same `status`, `text?`, and
  `error?` as the result.

At most `agentConcurrency` runs (default 4) per Mini App are in flight, and one per session. Further
`run` / `answer` calls wait in order, up to four times that many; aborting a waiting call's `signal`
rejects it with `REQUEST_CANCELLED`. A `whenBusy` call on a session that already has a call of this
Mini App in flight shares that call's slot instead of waiting for another; up to four times
`agentConcurrency` such calls may be in flight. A Mini App may also start at most 12 turns per
60-second window, or 5 × `agentConcurrency` when that is larger; only calls that take a run slot or
join one with `whenBusy` count, so a full queue always drains within one window, and the count
survives a Mini App restart. `BUSY` (retryable) means the session is busy (`reason: 'session_busy'`,
never with `whenBusy`; see above, the text reached no turn), the queue is full
(`reason: 'queue_full'`), or the per-minute cap was hit (`reason: 'rate_limited'`). Inside a root
session the Mini App started, the Agent has no `miniapp` control tool and `@`-mentions do not
cold-start other Mini Apps, so a run cannot publish, restart, or stop Mini Apps (including this
one); sessions it delegates to sub-agents are not covered. Check caught errors by `code`:
`NOT_PERMITTED`, `BUSY`, `SESSION_NOT_FOUND`, `INVALID_ARGUMENTS`, `AGENT_UNAVAILABLE`,
`REQUEST_CANCELLED`, `AGENT_OUTCOME_UNKNOWN`, or `REQUEST_NOT_FOUND`, plus `retryable`.
`AGENT_OUTCOME_UNKNOWN` means the turn may have run; do not retry it automatically. It is also used
when a turn ended (its `turn.finished` was delivered) but the Host could not tell whether a question
is pending: inspect the session, then continue with `run({ sessionId })` or `answer`.
`AGENT_UNAVAILABLE` means nothing was started; a call from a Mini App process that has since been
replaced gets it with `retryable: true`. A service restart cancels in-flight runs. `NOT_PERMITTED`
also means the user switched `session.run` off for this Mini App: in-flight runs end as `aborted`,
waiting calls and new calls are refused, and `context.agent` stays; calls work again once the user
switches it back on.

### Observing and reading sessions

- `context.agent.observe({ all: true }, { onEvent, signal? })` reports `turn.started`,
  `message.committed` (the final reply) and `turn.finished` of every user conversation, each with
  `sessionId` and the conversation's `title` when it has one; `observe({ sessionId }, { onEvent,
  signal? })` reports every progress event of that session, turn after turn. Pass exactly one
  target, or it rejects with `INVALID_ARGUMENTS`. An observer's `turn.started` carries `model`
  only when the Host could read it. Asks never reach an observer. There is no request timeout; the
  promise resolves when the subscription ends (`signal` aborted, the session deleted, the process
  stopped or replaced, `session.read` switched off) and rejects with a `MiniAppAgentError` when it
  could not start. Up to 4 observers per Mini App (`BUSY`, retryable, `reason: 'observer_limit'`),
  apart from the run slots, the start budget and the ordinary request budget. Once `signal` aborts,
  `onEvent` gets nothing more, not even events already on their way (the same holds for `run` and
  `answer`). When events back up, `text.delta` and `tool.*` events may be dropped, but
  `turn.started`, `message.committed` and `turn.finished` are not, unless one of them exceeds the
  8 MiB frame limit (a reply that large is dropped and logged on the Host); `turn.finished` comes
  without `text` (and with no `message.committed`) when the Host could not read the final reply.
- `context.agent.sessions()` (`{ sessions }`) and `context.agent.session(sessionId)` read the
  user's conversations, with the same fields as on the page (see
  [client-api.md](client-api.md#miniappagent)). Like `observe`, they change nothing: a lost read is
  `AGENT_UNAVAILABLE`, never `AGENT_OUTCOME_UNKNOWN`.
- `session(sessionId)` needs the id (`INVALID_ARGUMENTS` without it): the Node process serves every
  tab of the Mini App, so it has no current chat. To work on the chat a tab is open in, have the
  page read it with its own `session()` and pass the `sessionId` to Node.
- All three need `agentAccess: ["session.read"]` except for this Mini App's own sessions; see
  [agent-interaction.md](agent-interaction.md#observing-the-users-sessions).

# Security and state rules

## Process and Browser boundary

- Node owns data access through CLIs, APIs, SDKs, files, and Connectors, as well as persistence.
  Client owns presentation and user interaction.
- Keep credentials, authorization headers, Connector inventory, opaque tool refs, internal ports,
  and Host objects out of HTML, Client JavaScript, logs, SSE/WebSocket payloads, and error
  responses.
- Bind only `context.listen` and expose only declared surface and MCP routes.
- The Host guards the assigned port at the `http.Server` layer: only the Desktop page and managed MCP
  client carry its per-run credential, and all other callers get `401`. Serve the port with a
  `node:http` server, keep the `/__mavis/` path prefix free, and do not add another authorization
  scheme that expects the Host's credential. See
  [runtime-api.md](runtime-api.md#loopback-authentication).
- Validate request parameters and responses. Do not expose arbitrary command, URL, Connector,
  or filesystem proxies.

## One mutation path

Route every business mutation through one Node domain service:

```text
HTTP / MCP / background command -> validate -> domain service -> durable commit -> SSE or WS event
```

Page requests, MCP tools, and background refreshes share that service. Commit first and broadcast
second. A failed broadcast does not roll back committed state; reconnecting pages recover by reading
the current snapshot. Use stable idempotency keys and reconcile an unknown Connector write outcome
before retrying.

Store durable state under the injected `dataDir`. Keep artifacts reproducible. Browser storage may
hold view preferences such as filters, sort order, and expanded rows, but not Connector or domain
data.

## Reclaim and restore

The Host may reclaim a board while it is not visible, to free memory or a service slot. It may stop
the Node backend, and it may destroy the page and reload it later when the user returns. A page in
its own window counts as not visible while that window is minimized or hidden (including after
`window.update({ visible: false })`); the window stays, and the page reloads in it when the window
is shown again. Neither happens with notice, and no callback is guaranteed to run. Treat every
hidden moment as a possible end of the process and of the page:

- Persist state to `dataDir` as it changes, not on shutdown. Write files atomically (write a
  temporary file in the same directory, then rename it over the target) or use a store with
  transactions such as SQLite, so a forced end never leaves a half-written file.
- In the page, save view state when `visibilitychange` reports `document.visibilityState` as
  `hidden`, and restore it on load from that saved state and the Node snapshot. Do not rely on
  `beforeunload` or `unload`; a reclaimed page may never receive them.
- Finish `dispose()` within 2 seconds. The Host waits 2 s after a stop, then sends `SIGTERM`, then
  force-kills the entry 2 s later; on Windows `SIGTERM` already ends the process forcefully.
- Do not poll, send heartbeats, or hold requests open to stay alive: the Host does not count page
  traffic or in-process timers as use. While the Host is serving a request from the backend, and for
  10 minutes after the last one ends, the board is not put to sleep to free a slot for another Mini
  App, and under critical memory pressure it is reclaimed only after idle boards. That is never a
  guarantee: a board that is not visible may be stopped at any time. Phase 1 offers no keep-alive
  grant, so continuous background work, such as ongoing data collection, persists its data
  continuously and resumes on its own after a restart.

## Update and recovery

The `miniapp` tool's `publish` action stages, validates, and atomically adopts or updates the candidate from the
current Session workspace. It does not install dependencies or build source. A failed publish keeps
the last accepted package metadata, but a failure after the old service stops leaves the service
failed or stopped; the Host does not roll back or restart the old service automatically. Fix
candidate-owned diagnostics and publish again, or explicitly restart the accepted package; use
`inspect` to confirm the result. `restart` never reads or adopts workspace changes.

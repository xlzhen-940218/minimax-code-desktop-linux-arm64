# Mini App package contract

The `miniapp` Host tool and `miniapps/` workspace directory are canonical Host identifiers. Packages
use the `miniApp` declaration with a `miniapp/` payload. The product name is **Mini App**.

## Workspace package root

Initialize the workspace package with `{ "action": "init", "pluginId": ... }` and edit only the
returned workspace-relative `packagePath`. New packages use `miniapps/<pluginId>/`. The returned
path is authoritative and remains a normal MiniMax Plugin package.
`.minimax-plugin/plugin.json` is the source of truth for identity, metadata, icon, Skills, MCP
servers, and apps; Mini App authoring does not reinterpret or clear those fields.

A new MiniMax Plugin manifest (`schemaVersion: 1`) contains these required fields (only
`displayName` is optional):

```json
{
  "schemaVersion": 1,
  "name": "sales-mini-app",
  "displayName": "Sales Mini App",
  "version": "1.0.0",
  "description": "Shows the verified sales pipeline.",
  "author": "User",
  "icon": "icon.png",
  "category": "Business",
  "exampleQueries": ["Open my sales pipeline dashboard."],
  "apps": [],
  "mcpServers": [],
  "skills": []
}
```

- `schemaVersion` is `1`; `name` is at most 80 characters and matches
  `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`; `version` is SemVer.
- `description`, `author`, and every example query are non-empty. `icon` resolves to a real PNG,
  JPEG, or WebP inside the workspace package. The Host scaffold supplies the default `icon.png`;
  preserve it unless the user explicitly requests a custom icon.
- `apps`, `mcpServers`, and `skills` keep their existing PluginSystem meanings. Preserve them when
  updating a plugin, and use empty arrays only when that capability is genuinely absent.

For a newly created Mini App, the root `package.json` writes this exact canonical extension:

```json
{
  "mcode": {
    "schemaVersion": 2,
    "miniApp": "./miniapp/miniapp.json"
  }
}
```

When the Host returns `mode: "update"`, preserve the existing Mini App declaration and referenced
payload layout.

Prefer Node built-ins and Browser APIs. Run a dependency install or build only when the returned
candidate contains its own lockfile, package-manager metadata, and build script. Use that
candidate-local manager with `packagePath` as the working directory; do not inspect workspace-root
package-manager state or install a package manager. Bundle or vendor every third-party runtime
dependency under a declared payload root.

`node_modules` is candidate-local build state and never part of the Mini App runtime payload. The
three Mini App runtime digests (content, Client, and Node) exclude it. For a mixed Mini App with a
stdio MCP server, the ordinary whole-package Plugin identity still traverses and includes
`node_modules` for MCP lifecycle, while Host staging and publish do not copy it. The Agent may use
it while authoring, but the Host validation and publish flow never installs dependencies or runs
builds.

## Mini App manifest

Mini App authoring is process-only. Both Client and Node runtime payload roots are required:

```json
{
  "schemaVersion": 1,
  "artifacts": {
    "client": ["./miniapp/client"],
    "node": ["./miniapp/node"]
  },
  "runtime": {
    "kind": "process",
    "entry": "./miniapp/node/server.mjs",
    "lifecycle": "on-demand"
  },
  "surface": {
    "path": "/dashboard",
    "window": {
      "width": 960,
      "height": 700,
      "minWidth": 480,
      "minHeight": 360,
      "resizable": true,
      "frame": true,
      "transparent": false,
      "alwaysOnTop": false,
      "skipTaskbar": false,
      "clickThrough": false
    }
  },
  "mcpEndpoints": [],
  "hostConnectorAccess": { "providers": ["notion"] },
  "agentAccess": ["session.run"],
  "agentConcurrency": 4,
  "deviceAccess": ["microphone"]
}
```

The example above is the `miniapp/miniapp.json` format.

- `schemaVersion` is `1`; unknown top-level fields are rejected with
  `MINIAPP_MANIFEST_FIELD_UNSUPPORTED`.
- `artifacts.client` and `artifacts.node` are non-empty, unique runtime payload digest roots. They
  define what the Host hashes and adopts; they are not required to be compiler output directories.
  Roots may contain directly runnable source files or build outputs, and every path stays under
  the package's `miniapp/` payload directory.
- `runtime.entry` is the Node module entry, ends in `.js`, `.mjs`, or `.cjs`, and is covered by a
  Node payload root. Lifecycle is always `on-demand`; the field may be omitted. The retired
  `background` spelling is accepted as an `on-demand` compatibility input and never starts a service
  during Plugin enablement or discovery. `on-demand` also means the Host may stop the service while
  the board is not visible, and may destroy its page and reload it later, without notice and without
  a guaranteed callback; see [security-and-state.md](security-and-state.md#reclaim-and-restore).
- `surface.path` is the page HTTP entry served by the Node process. Surface and MCP paths are
  canonical Host-relative routes without origin, query, fragment, or backslash.
- `surface.window` is optional and declares a whitelisted subset of Electron's
  `BaseWindowConstructorOptions` for the window the Host opens when the user pops this page out of
  the File Panel into its own window. Every field is optional; unknown fields are rejected. Widths
  and heights are integers in `[200, 10000]`. When both a dimension and its matching `min*` are
  given, `minWidth <= width` and `minHeight <= height`. `transparent: true` requires an explicit
  `frame: false`. Declared defaults (used when a field is omitted):
  - `width` / `height`: the page's last size inside the File Panel before it was popped out.
  - `minWidth`: `480`; `minHeight`: `360`.
  - `resizable`: `true`; `frame`: `true`; `transparent`: `false`; `alwaysOnTop`: `false`;
    `skipTaskbar`: `false`; `clickThrough`: `false`.
  - `clickThrough: true` lets mouse events pass through the window to whatever is underneath
    (the page still receives mouse-move events). Use it for small floating widgets with
    transparent margins. It is also the ceiling for the page's runtime window handle: a page may
    only turn click-through on at runtime (`update({ clickThrough: true })`) when the manifest
    declares it; the same rule applies to `alwaysOnTop`.

  `surface.window` cannot declare the window's relationship to the main window (it is always an
  independent top-level window: hidden when the main window is minimized to the tray, shown again
  when the main window restores, but never minimized alongside it), `title` (always the Mini App's
  `displayName`), screen position or position memory, or what happens on close (Cmd/Ctrl+W is
  equivalent to the close button; both always return the page to the File Panel) or on open
  (the window only ever appears through the File Panel's pop-out action, never on launch).
- Each MCP endpoint references an MCP server already declared by `plugin.json`. Read
  [mcp.md](mcp.md) only when authoring or preserving Agent-facing MCP tools.
- Connector providers use lowercase letters, digits, `_`, or `-`, are unique, and were proven by a
  real read before authoring.
- `agentAccess` is optional and denies Agent access when absent or empty. Allowed values are
  `"session.run"` and `"session.read"`; neither implies the other, and both may be declared.
  `"session.read"` lets the Mini App list and read the user's own conversations and observe their
  Agent turns (`agent.sessions()`, `agent.session()`, `agent.observe`), including the final reply
  text of every turn. Reading the chat a page is open in (`session()` without an id, e.g. for its
  project directory) needs it too and also opens the user's other conversations; declare it only when the board's purpose is to follow what the user's Agent
  is doing (see [agent-interaction.md](agent-interaction.md#observing-the-users-sessions)). A Host
  older than `session.read` rejects the whole package as `MINIAPP_AGENT_ACCESS_INVALID`; when the
  user names the MCode version the package needs, also write `engines` (below).
  `"session.run"` lets the Mini App run Agent turns through `context.agent` or
  `window.mcode.miniapp.agent`, with the Agent's full capabilities (files, shell, Skills, and MCP
  including this Mini App's own). Page-initiated runs use the agent of the chat session the Mini App
  is open in; Node-initiated runs, and pages not opened from a session, use the primary Agent;
  continuing a session keeps its agent. The Mini App renders the interaction: it decides
  `permission.requested` with `reply` and answers `question.requested` with `answer`. A permission
  request waits only while someone can answer it: the run passed `onEvent`, or a page has the
  session open in a chat side panel via `open`; otherwise it is denied and the model is told why
  (see [runtime-api.md](runtime-api.md#interaction)). Up to `agentConcurrency` runs per Mini App
  run at once; further calls wait in order. Declare it only when the board genuinely needs an Agent
  at runtime.
- `agentConcurrency` is optional: an integer from 1 to 32, default 4. It sets how many Agent runs of
  this Mini App execute at once; further calls wait in order, up to four times that many. It has no
  effect without `agentAccess`.
- `hostAccess` 可选，首期只接受 `["navigation.read"]`，缺省或空数组不授予导航观察。它投影为独立开关
  `host:navigation.read`，可以感知 Host 公开页面类型、设置是否打开，以及不含会话身份的上下文变化。仅在 Mini
  App 逻辑可见时交付，隐藏时一次性读取也会被拒绝；恢复时仅通知最新状态，不补发隐藏期间的轨迹。撤权后旧订阅结束，需要重新订阅。明暗与已生效语言不需要该权限；用户点击打开已知入口也不需要该权限。不要为读取展示偏好或打开入口声明
  `session.read`。未识别该字段的旧 Host 会拒绝整个包；非法值返回 `MINIAPP_HOST_ACCESS_INVALID`。
- `deviceAccess` is optional and lists the device permissions the page may hold; absent or empty
  means none. Allowed values, named as `navigator.permissions.query` names them:
  - `"microphone"`: the page may call `getUserMedia({ audio })` and
    `window.mcode.miniapp.speech.transcribe` (see [client-api.md](client-api.md)). Without it the
    Host denies the microphone to the page (`NotAllowedError`) and `transcribe` rejects with
    `not_permitted`.
  - `"camera"`: the page may call `getUserMedia({ video })`.
  - `"notifications"`: the page may show system notifications with `new Notification(...)` (see
    [client-api.md](client-api.md#camera-and-system-notifications)).

  Geolocation, clipboard read, screen capture and every other permission a browser would prompt
  for are denied to Mini App pages; sanitized clipboard write, fullscreen and pointer lock work
  without a declaration. Declare only what the board uses. A Host older than this field rejects the
  whole package as `MINIAPP_MANIFEST_FIELD_UNSUPPORTED`, and a Host that predates one of the values
  rejects it as `MINIAPP_DEVICE_ACCESS_INVALID`; `engines` below still applies (omitted unless the
  user names a version).
- The user can switch off what the manifest declares, item by item, in the plugin details: each
  `hostConnectorAccess` provider, each `agentAccess` value (`session.run`, `session.read`),
  `toolAccess: "call"`, each `deviceAccess` value and `hostAccess: "navigation.read"`. Everything starts on and there is no
  first-use prompt. A switch applies at
  once and never restarts the Mini App: `context.hostConnector`, `context.agent` and `context.tool`
  stay present as the manifest declares them. An off provider disappears from
  `context.hostConnector.list()` and its calls fail with `CONNECTOR_NOT_PERMITTED`; an off
  `session.run` stops the Mini App's running Agent turns and makes `run`, `reply`, `answer`,
  `cancel`, `open`, `models`, `agents` and `create` fail with `NOT_PERMITTED` (`not_permitted` on
  the page); an off `session.read` ends the Mini App's session observers and makes `sessions()`,
  `observe({ all: true })` and reading or observing any session but its own fail the same way. The
  Mini App's own sessions stay readable with either value on; with neither on, `session(id)` and
  `observe({ sessionId })` fail for them too. An off `tool:call` makes `context.tool` calls fail
  with `TOOL_NOT_PERMITTED`. An off `microphone` makes the next `getUserMedia` fail with
  `NotAllowedError` and `speech.transcribe` with `not_permitted`; an off `camera` does the same for
  video. A recording or camera stream already open keeps running until the page stops it. An off
  `notifications` stops further notifications and makes `Notification.permission` read `denied`.
  Switching an item back on admits the next call.
  Handle these errors where the call is made and show a clear in-board message; do not treat them
  as a reason to exit. `surface.window` flags are not switches: what the manifest declares applies.
- `toolAccess` is optional. `"toolAccess": ["call"]` gives Node code `context.tool`, which calls the
  MCP and Connector tools installed on this Host (see [runtime-api.md](runtime-api.md#tool)). It
  only lets the Mini App ask: each call is judged by the user's permission rules, and the user may
  be prompted. Declare it only when the Mini App really calls tools. `"call"` is the only accepted
  value; anything else fails with `MINIAPP_TOOL_ACCESS_INVALID`. `hostConnectorAccess` does not
  grant `context.tool`. Older Hosts do not know this field; declare `engines` with it (see below).
- `engines` is optional and **omitted by default**: the Agent cannot observe the user's MCode
  version, so a guessed lower bound only risks locking the user out. Write
  `"engines": { "mcode": ">=MAJOR.MINOR.PATCH" }` only when the user names the version the package
  needs. The bound is enforced only by Hosts that know `engines` and can parse the rest of the
  manifest. `miniapp.json` is strict, so a Host older than `engines` itself rejects any field it
  does not know, `engines` included, as `MINIAPP_MANIFEST_INVALID` and never reads the bound;
  `engines` gives a readable `MINIAPP_HOST_TOO_OLD` only on a Host that supports it but is older
  than the version the user named. Only a `>=` bound with three numeric segments is accepted
  (`MINIAPP_ENGINES_INVALID`). A Host older than the bound refuses to publish the workspace with
  `MINIAPP_HOST_TOO_OLD`; a package installed from elsewhere stays installed with its standalone
  Skills and MCP, but its Mini App and managed MCP endpoints are withheld. On a Host that knows
  `engines`, an unknown top-level field is rejected with `MINIAPP_MANIFEST_FIELD_UNSUPPORTED`; that
  error on an installed Host means the Host is too old for the package.

## Node runtime ownership

The Node entry is the board's long-lived Host anchor. It must keep the assigned loopback port open
for as long as the board is available, either by serving requests itself or by proxying to a backend
it starts. The entry may use any implementation behind that port, including Python or another
runtime, but the assigned port itself must be served by the entry's `node:http` server so the Host's
[loopback authentication](runtime-api.md#loopback-authentication) guard applies.

Return `dispose()` from `start(context)` and close the listener, child processes, timers,
subscriptions, streams, and persistence handles that the board owns, within 2 seconds: the Host
waits 2 s after a stop, then sends `SIGTERM`, then force-kills the entry 2 s later (on Windows
`SIGTERM` is already forceful). The Host can stop only its direct Node entry. It does not promise to
discover, terminate, or prove the end of processes the plugin creates.

The Host runs a device-dependent maximum number of different Mini App services at once. A service
beyond that limit, or an update waiting for an already-dispatched request, returns `BUSY`; retry
after the active request or another board has settled. Never start a second Node entry for the same
board.

## Payload paths

Use portable, canonical, workspace-package-relative paths. Reject absolute paths, `..`, backslashes,
symlinks, and references outside the workspace package. Runtime payload roots are digest roots, not
a demand for compiled output or a `dist` convention. `node_modules` is the only excluded path
segment; all other authored files are allowed and contribute to the three Mini App runtime digests.
A mixed stdio package's separate ordinary identity still includes `node_modules`, even though the
Host omits that directory from the staged and published package. The Host does not maintain another
authored-file blacklist for VCS metadata, virtual environments, coverage/cache data, IDE metadata,
temporary files, logs, or PID files. Remove files that should not be adopted before publish.

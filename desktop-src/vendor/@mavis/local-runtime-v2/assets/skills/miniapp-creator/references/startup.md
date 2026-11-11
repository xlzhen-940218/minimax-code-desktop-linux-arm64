# Mini App startup and Agent tools

## What the Host starts

Selecting a Mini App from the Desktop `@` list starts or reuses its Node service. In an existing
Session, Desktop expands the sidebar after the page opens successfully; a failed startup does not
open an empty panel. On the new-conversation screen, it starts only the service. The normal first
send creates the Session, then opens pages for explicitly selected Mini Apps whose startup
succeeded and whose references remain in the submitted message. A failed startup does not
automatically retry page opening on the first send. Typing `@`, restoring a draft, and displaying
history do not automatically open pages.

The service is shared by plugin identity, while each Session has its own page. Once a page-opening
operation is issued, removing the reference, cancelling the message, or switching Sessions does
not withdraw it. The page stays with the Session that requested it; the user closes it manually.
Removing an `@` reference does not stop the shared service. Confirming the close dialog for a
running Mini App tab stops its shared service and closes that plugin's tabs across Sessions.
The Host manages a device-dependent service limit. When a user's `@` selection needs a new slot and
capacity is full, the Host puts the least recently used Mini App that it may reclaim to sleep and
then starts the selected one. Only when no running Mini App can be put to sleep does Desktop keep the
reference, show a service-limit toast, and not start the service or open its page; after freeing a
slot, the user can select the reference again or open the Mini App from its launcher. A reference
in any turn other than the local user's own composer message never puts another Mini App to sleep.
Repeated references to an already-running plugin reuse that service.
Manual opening from the Mini App launcher follows the same rule and shows its capacity dialog only
when nothing can be put to sleep. A Skill or Hook must not start another Node process to bypass the
limit.

Use the existing `miniapp.open` action when the business workflow needs the user to see a page.
Opening reuses an available service; `restart` is an explicit lifecycle operation, not preparation
for an ordinary business request.

## Managed and independent MCP

Read [mcp.md](mcp.md) for the declarations and transport shapes. Choose the lifecycle per server,
not per package:

- A server named in `mcpEndpoints` runs inside the Mini App Node service. Before requesting the
  model, the Host activates that service, connects MCP, discovers tools, and checks that the
  required server is available in this turn's tool set.
- A server not named in `mcpEndpoints` uses the ordinary Plugin MCP lifecycle. Its discovery need
  not wait for the Mini App Node service. Only use this form when the server can run independently.

One package can contain both forms. A listening HTTP port does not prove that MCP is working, and
the page can work even when its MCP handler is broken. A required managed MCP failure stops turn
preparation instead of asking the model to work without its tools. Model requests do not wait for
page rendering.

## Make MCP ready before business work

Keep `start(context)` limited to required local configuration, route installation, and starting the
HTTP listener. Resolve it only after all declared routes, including MCP, accept requests. See
[runtime-api.md](runtime-api.md) for disposal, logging, and Connector restrictions.

Keep `tools/list` lightweight: return tool definitions without importing business data, scanning
documents, building indexes, or querying a remote service. Prepare those dependencies inside the
business request that needs them. For example, the handlers can share one initialization promise:

```js
const tools = [
  {
    name: 'query_records',
    description: 'Queries the current project records.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// Register this handler with the MCP implementation; it needs no business initialization.
function listTools() {
  return { tools };
}

let recordsReady;
async function getRecords() {
  // Plugin-owned business initialization, only on a request.
  const pending = (recordsReady ??= loadRecords());
  try {
    return await pending;
  } catch (error) {
    if (recordsReady === pending) recordsReady = undefined;
    throw error;
  }
}

async function queryRecords() {
  const records = await getRecords();
  return { content: [{ type: 'text', text: JSON.stringify(records) }] };
}
```

This is a handler pattern, not a complete MCP server. Implement the declared Streamable HTTP
protocol with the package's MCP implementation. CPU-heavy work needs bounded chunks or a
plugin-owned worker; adding `async` alone does not prevent it from blocking the Node thread.

## Optional Plugin Hooks

When creating or modifying Hooks, read the `plugin-creator` Skill's
`references/local-plugin-hooks.md` for the complete Hook contract. Reuse that reference's event,
stdin/stdout, timeout, matcher, and cross-platform rules, not its installed-directory authoring
workflow. All Mini App changes stay in the candidate returned by `miniapp.init` and are published
through the Host.

Declare package-relative Hook files in the manifest's optional `hooks` array, and keep scripts in
the same package. Use synchronous `type: "command"` handlers and a portable interpreter that is
actually available; provide `commandWindows` when needed. Keep stdout for the documented JSON
response and validate the script and its event-specific output. Preserve existing Hooks on updates.

Hooks describe business behavior. `additionalContext` can tell the Agent what to do next.
`UserPromptSubmit` runs after the turn's tools have been selected, so it cannot make a cold managed
MCP discoverable for that turn. Host startup does not depend on a Hook or on the Agent reading a
Skill first.

## Verify the startup path

1. Measure a cold start through the normal Host entry. Record startup and MCP discovery separately
   when diagnostics expose them; do not promise a fixed number of seconds.
2. Verify `tools/list` succeeds before any business initialization, then invoke a representative
   business tool and verify its real result.
3. Try immediate send after `@`, a repeated reference, and an independent MCP where applicable.
   Confirm one shared Node service and no wait for page rendering.
4. For Hook changes, run the reference's declaration, script, interpreter, and response checks.

Report unavailable runtime checks as unverified. Updated Creator guidance applies to new or edited
packages; an existing imported ZIP keeps its current startup code until the package is updated.

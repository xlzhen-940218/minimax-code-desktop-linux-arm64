# Mini App MCP authoring

Choose exactly one lifecycle for each MCP server identity. An ordinary Plugin MCP server remains
independent of the Mini App Node runtime. A Mini App-managed MCP server is implemented by that
Node runtime and is available only while its accepted generation is running. Do not declare the same
server identity as both forms.

`mcpEndpoints` is a Mini App-only declaration. It does not change MCP servers that it does not
name, and it does not affect MCP in a package without a Mini App contribution.

## Ordinary stdio MCP

Declare the MCP file in `.minimax-plugin/plugin.json`:

```json
{
  "mcpServers": ["servers.mcp.json"]
}
```

Use a normal stdio definition in `servers.mcp.json`:

```json
{
  "schemaVersion": 1,
  "mcpServers": {
    "board-summary": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp/board-summary.mjs"],
      "env": {},
      "description": "Summarizes board data.",
      "timeout": 30000
    }
  }
}
```

In the Mini App manifest `miniapp/miniapp.json`, keep this field empty so PluginSystem retains the
ordinary stdio transport:

```json
{
  "mcpEndpoints": []
}
```

## Mini App-managed Streamable HTTP MCP

Declare the MCP file in `.minimax-plugin/plugin.json` as above. In `servers.mcp.json`, declare a
Streamable HTTP identity with the valid fail-closed placeholder used only before Host adoption:

```json
{
  "schemaVersion": 1,
  "mcpServers": {
    "board-summary": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:9/mcp/board-summary",
      "headers": {},
      "description": "Summarizes the running Mini App.",
      "timeout": 30000
    }
  }
}
```

Reference it from the selected Mini App manifest with the only accepted endpoint fields:

```json
{
  "mcpEndpoints": [
    {
      "server": "board-summary",
      "path": "/mcp/board-summary"
    }
  ]
}
```

The Node entry must implement Streamable HTTP MCP at that exact `context.listen` path before
`start(context)` resolves. The Host rewrites only the named server to the current run; the existing
Plugin MCP runtime remains the sole owner of tool discovery, ordering, schemas, calls, and errors.
An invalid MCP handler does not invalidate the Mini App page, but its Agent tools remain
unavailable until the plugin is fixed and published again. `mcpEndpoints` does not generate a route,
bridge an ordinary stdio process, or make a missing handler available.

## Calling Plugin MCP from the Node runtime

The Agent calls the Plugin's MCP tools in a turn. The Mini App's own Node code can call them too
through `context.tool` after declaring `"toolAccess": ["call"]` in `miniapp/miniapp.json`. Take the
tool's runtime name from `context.tool.list()` (match `server` and `tool`; do not build the name),
then `context.tool.call(name, { text })` resolves with
`{ kind: 'mcp', isError, content, structuredContent? }`; the user's permission rules judge every
call (see [runtime-api.md](runtime-api.md#tool)). A server listed in `mcpEndpoints` is implemented
by this Node process, so call that function directly.

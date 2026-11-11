# MCP Server Settings

Use this reference when managing Model Context Protocol (MCP) server settings for the current Mavis
profile.

## Scope and Boundary

The native `mavis` tool manages **configured MCP servers in the current profile**. It does not scan
the filesystem, PATH, local ports, package registries, or project files to infer unregistered MCP
servers.

Use the native `mavis` tool, not a shell command:

```text
mavis({ command: "mcp <action>", args: { ... } })
```

Available actions:

- `mcp list`: list configured servers; optionally filter by `search`.
- `mcp get`: inspect a named server's persisted configuration and enabled state.
- `mcp create`: add a server.
- `mcp update`: change a server configuration or enabled state.
- `mcp delete`: remove a server.
- `mcp help`: inspect the runtime command shape.

## Authorization and Safety

- `mcp list`, `mcp get`, and `mcp help` are read-only and may be used to inspect current state.
- Create, update, or delete a server only after the user explicitly requests or approves that exact
  configuration change.
- Treat `env` and `headers` as secrets. They can be accepted for writes but are never returned by
  the native tool; never print, log, or restate their values.
- Prefer the narrowest configuration that meets the user's need. Do not add credentials, write
  permissions, or extra servers without an explicit request.
- A successful `mcp create` or `mcp get` confirms persisted configuration, not endpoint
  reachability, authentication success, server initialization, or tool availability in the current
  session. Do not report a server as connected or usable unless the runtime provides separate
  evidence.

## Transport Configuration

| Transport         | Required endpoint field | Typical optional fields                               |
| ----------------- | ----------------------- | ----------------------------------------------------- |
| `stdio`           | `command`               | `args`, `env`, `timeout_ms`, `description`, `enabled` |
| `http`            | `url`                   | `headers`, `timeout_ms`, `description`, `enabled`     |
| `streamable-http` | `url`                   | `headers`, `timeout_ms`, `description`, `enabled`     |
| `sse`             | `url`                   | `headers`, `timeout_ms`, `description`, `enabled`     |

Do not combine a local-process `command` with a remote-server `url`. For updates, provide a
meaningful configuration change; use `enabled: false` to disable a server without deleting it.

## Safe Workflow

1. Inspect existing configuration with `mcp list` or `mcp get`.
2. For a new server, identify its name, transport, endpoint, authentication method, and intended
   scope. Ask only for missing details that materially change the configuration.
3. Before a mutation, state the exact server name, transport, endpoint or command, enabled state,
   and whether credentials will be stored. Wait for explicit authorization unless the user already
   requested that exact action.
4. Call `mcp create`, `mcp update`, or `mcp delete`.
5. Call `mcp get` to confirm the persisted non-secret configuration, and report configuration status
   separately from connectivity or tool-discovery status.

## Examples

```text
mavis({ command: "mcp list", args: {} })

mavis({ command: "mcp get", args: { name: "docs" } })

mavis({
  command: "mcp create",
  args: {
    name: "docs",
    transport: "streamable-http",
    url: "https://example.com/mcp",
    timeout_ms: 30000,
    enabled: true
  }
})

mavis({
  command: "mcp update",
  args: { name: "docs", enabled: false }
})

mavis({ command: "mcp delete", args: { name: "docs" } })
```

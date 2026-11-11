# Mini App data access and runtime verification

## Choose an available method

The Mini App Node service can invoke a local CLI, call an HTTP API or SDK, or read authorized files.
`context.hostConnector` applies only when using a Host Connector. CLI access does not require
`hostConnectorAccess.providers`; that field declares only Connectors the runtime actually calls.
With `"toolAccess": ["call"]`, `context.tool` calls every connected Connector provider and every
installed MCP server under the runtime names an Agent sees, each call judged by the user's
permission rules; see [runtime-api.md](runtime-api.md#tool).

Use an available service Skill or documentation to establish the calling convention. For example,
when the user specifies `lark-cli`, read the relevant Feishu Skill and probe the command,
authentication, and real response. Do not gate progress on the presence of a Feishu Connector.
Choose based on implementation evidence; Agent tool search alone does not establish Node service
capabilities.

## Verify in two stages

1. Before creating or editing the candidate package, execute a read-only query through the chosen
   method. Confirm access to the required data and record the structure needed for parsing without
   putting sensitive samples or credentials in the package. Identify concrete failures such as a
   missing command, authentication, permissions, arguments, or response parsing. Evaluate other
   methods that satisfy the same requirement rather than defaulting to an offline product.
2. After publishing and opening, exercise a Mini App business read to verify that the actual Node
   process can use the data source. The Agent terminal's PATH, authentication, and working directory
   are not substitutes for this evidence. Confirm the page uses a current query, not an authoring
   snapshot; an empty result must also come from a successful query. Fix the candidate or report
   the specific runtime blocker. `runtime.status: running` alone does not prove data access works.

Read-only probes do not authorize creating, editing, or deleting real business data. Implement
writes against verified command/API contracts and exercise only operations the user has authorized.
Mark untested writes as unverified; do not substitute mock results for real verification.

## CLI implementation

- Invoke the verified executable in Node with `spawn`, `execFile`, or an equivalent, passing a
  separate argument array. Do not interpolate page input into shell commands or expose a generic
  execution endpoint that lets the page choose arbitrary programs, arguments, or paths.
- Verify the actual entry point for the deployment platform; do not assume Windows `.cmd` files
  launch the same way as macOS executables. The page submits business fields, which Node validates
  and maps to fixed commands. An installed, authenticated CLI is a local external dependency, not
  proof that the package will work on another machine. Report it at delivery; do not automatically
  install it or change user authentication.
- Use the CLI's structured output, checking exit status, business errors, and response shape
  separately. Bound execution time and output size. Handle missing commands, expired authentication,
  cancellation, and parsing failures. Return understandable page errors without passing through
  stderr or authentication details that may contain sensitive information.
- Track child processes for active requests and handle timeouts and `context.signal` cancellation.
  Have `dispose()` clean up owned child processes and resources. Do not assume that stopping the
  Node entry automatically cleans up all its children.
- Use the tool's normal authentication mechanism. Do not copy credentials into the package, page,
  or logs, or bypass permissions to reuse Agent authentication. A timed-out CLI write may already
  have taken effect; read business state before deciding whether to retry.

## APIs, SDKs, and files

Keep API/SDK authentication in Node. Bundle third-party runtime dependencies according to the
package contract rather than relying on development `node_modules`. Restrict file reads to the
user-authorized data scope; do not turn a business route into an arbitrary filesystem proxy.
Every method preserves the Client, credential, and state boundaries in
[security-and-state.md](security-and-state.md).

# MiniMax Code Mini App reference

Use this reference for what a Mini App is, what it can do, how it relates to Plugin and Agent, how to
build, run, update, and publish one, and why a Mini App is missing, not starting, or not callable.

## Stable concepts and boundaries

- A Mini App is a long-running application with a page and a Node service, installed as a MiniMax
  Plugin. It keeps state on a page that stays live instead of ending with one conversation.
- A Mini App is a regular MiniMax Plugin plus a `miniapp.json` declaration and two runtime payloads,
  one for the page and one for Node. Mini App adds the application surface; it does not replace
  Plugin packaging, Skills, or MCP.
- The Agent can call a Mini App's tools, and a Mini App can hand work back to the Agent. A person
  confirms at every key point.
- `installed ≠ running ≠ published`: a Mini App present in the marketplace or plugin list proves
  none of the later states.
- Capability status differs by module. Some Mini App capabilities are released while others are
  experimental, upcoming, or planned; check the current status page before promising behavior.

## Build a Mini App

For creating or editing a Mini App, load the `miniapp-creator` Skill and follow it. In the desktop
app the user can also start from `/miniapp-creator`. This reference explains product concepts,
routing, and where to verify facts; it is not a substitute for the authoring Skill.

## Official source discovery

Use only the current region's MiniMax Code index:

- `region: cn` → `https://agent.minimax.cn/docs/llms.txt`
- `region: en` → `https://agent.minimax.io/docs/llms.txt`

Product overview and capability pages:

- `/docs/code/agents/mini-apps.md`
- `/docs/miniapp/overview.md`
- `/docs/miniapp/features.md`
- `/docs/miniapp/progress.md`
- `/docs/miniapp/learn/architecture.md`
- `/docs/miniapp/sessions.md`

Host behavior:

- `/docs/miniapp/host/lifecycle.md`
- `/docs/miniapp/host/security.md`

Authoring pages:

- `/docs/miniapp/authors/quickstart.md`
- `/docs/miniapp/authors/package.md`
- `/docs/miniapp/authors/node-runtime.md`
- `/docs/miniapp/authors/client-api.md`
- `/docs/miniapp/authors/agent.md`
- `/docs/miniapp/authors/data.md`
- `/docs/miniapp/authors/publish.md`
- `/docs/miniapp/authors/share.md`

Reference pages:

- `/docs/miniapp/reference/manifest.md`
- `/docs/miniapp/reference/errors.md`

For Plugin packaging, marketplace installation, and Plugin development in general, read
`references/extensions.md`. Do not hard-code field names, method lists, status labels, or limits from
memory; `miniapp.json` rejects unknown fields and the manifest page is authoritative.

## Diagnostic workflow

1. Establish the layer: not installed, installed but not running, running but the page cannot reach
   Node, or the Agent cannot call the Mini App.
2. Confirm surface, client version, login, and plugin enablement before reading source.
3. For a startup or update failure, read the structured result the host returns and map it through
   the error-code page instead of guessing.
4. For a manifest problem, compare the declaration against the current manifest reference; unknown
   fields are rejected.
5. For publishing, remember that publishing is a transaction that can roll back; report the host
   result rather than assuming success.

## Safety

Never put credentials in a Mini App package, manifest, or page code. Business data reads and writes
belong in the Mini App's Node service; the page calls only the business interfaces Node exposes.
Confirm with the user before publishing, sharing, submitting to the marketplace, or any other
externally visible action. Do not expose private endpoints, host credentials, or the Agent interface
beyond what the current official documentation already publishes.

# IM

Use this doc for IM bridge configuration: Feishu and Telegram route rules, route testing, bridge
status, and defaults.

## Status

```bash
mavis im status
```

Returns enabled/disabled bridge state per platform, route counts, and configured defaults.

## Route Rules

### List

```bash
mavis im route list
mavis im route ls
```

Optional filter: `--platform feishu|telegram`

### Add

```bash
mavis im route add \
  --id <ruleId> \
  --platform <platform> \
  --agent <agentId> \
  [--chat-type <type>] [--chat-id <id>] [--sender-id <id>] \
  [--strategy <strategy>] [--title <template>] [--priority <n>] \
  [--require-mention] [--disabled]
```

Required:

- `--id` kebab-case rule ID
- `--platform` `feishu` or `telegram`
- `--agent` target agent

Optional selectors:

- `--chat-type`: `group`, `p2p`, `private`, `supergroup`, `*`
- `--chat-id`
- `--sender-id`

Optional behavior:

- `--strategy`: `root`, `per-sender`, `per-chat`, `shared-task` (legacy `main` accepted as alias for `root`)
- `--title <template>` for `shared-task`
- `--priority <n>` lower number = higher priority
- `--require-mention`
- `--disabled`

### Inspect / Update / Delete

```bash
mavis im route get <ruleId>
mavis im route update <ruleId> [flags]
mavis im route delete <ruleId>
mavis im route rm <ruleId>
```

Update supports agent, strategy, priority, enabled state, mention requirement, chat type, chat ID,
sender ID.

### Dry-Run Test

```bash
mavis im route test --platform <platform> --chat-type <type> [--chat-id <id>] [--sender-id <id>] [--mention]
```

Outputs whether the event would be routed or blocked and, if routed, which rule / agent / strategy
would apply.

## Default Routes

```bash
mavis im defaults
mavis im defaults set --platform <platform> --agent <agentId> --strategy <strategy>
```

Defaults apply only when no route rule matches.

## Session Strategy Meanings

- `root`: one shared root session (formerly named `main`; the legacy `main`
  literal is still accepted and normalized to `root` on intake)
- `per-sender`: one session per sender
- `per-chat`: one session per chat/channel
- `shared-task`: shared task session with title template

## Use This Doc When

- inbound IM traffic is landing on the wrong agent
- you need deterministic routing by chat/sender/type
- you need to reason about session fan-out on chat platforms

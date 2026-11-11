# MiniMax Code extensions reference

Use this reference for Skills, Plugins, MCP, Apps, Connectors, Marketplace, extension installation/development, discovery/loading/triggering/execution, or why an extension is missing or has no tools.

## Stable concepts and boundaries

- Skill is instruction content that guides an Agent; Plugin is a distributable product extension; MCP connects supported external tools/services; App/Connector is a product-managed user-facing integration concept.
- `discovered ≠ installed ≠ loaded ≠ triggered ≠ executed`: a catalog/list entry alone proves none of the later states.
- A capability can also be gated by surface, version, login, permissions, provider/model, region, account, or plan.

## Computer Use entry guidance

In the MiniMax Code desktop app, native desktop interaction is provided by the
“电脑操控” / “Computer Use” plugin. When the user requests desktop interaction but
computer_* tools are unavailable, give a brief entry hint in the user's language:

> 在输入框输入 `@`，选择「电脑操控」后发送这条任务。如果找不到，请先到插件市场安装，并按提示完成授权。

> Type `@` in the message input, select “Computer Use”, and send this task.
> If it is not listed, install it from Plugins and follow any permission prompts.

- This is desktop-app guidance; do not promise that the same entry exists on Web,
  CLI, or another surface. If the current surface is unknown, qualify the guidance
  as instructions for the desktop app.
- Provide the entry guidance without diagnosing installation or permission status.
- Do not repeatedly show setup guidance when the tools are already available.
- For what Computer Use can do, how it works, and its platform/version limits,
  find Computer Use / 电脑操控 in the current-region official documentation index.
  Do not treat this entry hint as a complete feature reference.

## Official source discovery

Use only the current region's MiniMax Code index:

- `region: cn` → `https://agent.minimax.cn/docs/llms.txt`
- `region: en` → `https://agent.minimax.io/docs/llms.txt`

Read the current `.md` pages for `/docs/code/agents/skills`, `/docs/code/agents/mcp`, `/docs/code/agents/plugins`, and `/docs/code/agents/plugin-submission` for building and submitting a Plugin.

For CLI questions read the regional pages `/docs/cli/quick-start`, `/docs/cli/features`, `/docs/cli/workflows`, `/docs/cli/configuration`, `/docs/cli/automation`, `/docs/cli/integrations`, `/docs/cli/computer-use`, `/docs/cli/reference`, `/docs/cli/security`, and `/docs/cli/faq`. `mcode exec` for headless and CI use, ACP editor integration, `mcode plugin`, and CLI Computer Use are separate entry points; do not describe one from another's documentation.

For Mini App, which installs as a Plugin but has its own runtime and manifest, read `references/miniapps.md`.

Do not copy current field names, transport lists, UI labels, or command options from memory. Never query both regional indexes for an ordinary current-region question.

## Diagnostic workflow

1. Name the requested object: Skill, Plugin, MCP server, App/Connector, or built-in tool.
2. Check discovery/install state, then surface/version/login and permission state.
3. For Skill: verify it is selected/loaded and that trigger wording matches; being listed does not mean it was injected into the turn.
4. For Plugin: verify installation/package health and whether its exposed capabilities are available; OAuth or credential setup remains user-controlled.
5. For MCP: verify current-doc configuration syntax, server connection/test result, enabled tools, and server-side health. “Plugin has MCP but no tools” is not fixed by guessing a connection address.
6. For execution failures, identify the first failed state and give one concrete user action.

## Safety

Never request or repeat passwords, API keys, OAuth secrets, tokens, or verification codes in chat. Never bypass consent, permission, plan, or server validation. Do not represent an internal component as an independent public product.

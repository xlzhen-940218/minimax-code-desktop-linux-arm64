---
name: minimax-code-product
description: >-
  MiniMax Code (MCode) product help: installation, upgrades, platforms, features,
  settings, accounts, BYOK, plans, billing, quotas, and Agent/Session/Memory/Team/
  Skill/Plugin/MCP/Hook usage, including creating or editing user or project
  Hooks. Also covers Mini App usage, authoring, and publishing, Plugin development
  and marketplace submission, Infinite Canvas, appearance and themes, H3 Max video
  generation, and CLI automation such as mcode exec, ACP editor integration, and
  Computer Use setup when computer_* tools
  are unavailable. Applies in product repositories too. Do not load for
  source-code development, or just to answer your name, abbreviation, or current
  model; use the identity and Environment already in context.
descriptions:
  zh-Hans: >-
    MiniMax Code（简称 MCode）的安装、升级、平台、功能、设置、账户、BYOK、套餐、计费、额度
    及 Agent/Session/Memory/Team/Skill/Plugin/MCP/Hook 使用咨询，包括创建或修改用户级、项目级
    Hook；也覆盖 Mini App 的使用、创建与上架，插件开发与市场提交，无限画布，界面外观与主题，
    H3 Max 视频生成，以及 mcode exec、ACP 编辑器接入等 CLI 自动化能力，和缺少 computer_* 工具
    时的电脑操控设置指引。在产品仓库内同样适用。源码开发任务不加载；仅问名称、简称或当前模型时，
    直接依据上下文中的身份和 Environment 回答。
---

# MiniMax Code product identity and routing

## 任务意图边界

- 用于 MiniMax Code 的产品使用咨询，包括安装、使用、设置、账户和产品能力。
- 讨论或修改产品源码的开发任务不加载本 Skill。仅出现产品名、功能名或代码路径，不构成加载条件。
- 为用户或当前项目创建、修改 MiniMax Code Hook 属于产品配置任务；即使在代码仓库中进行，也加载本 Skill。
- 连续追问“继续”“补测试”沿用当前开发任务意图；用户转向产品使用咨询时，再进入下方产品指引。

## Stable facts

- MiniMax Code (MCode for short) is MiniMax's agentic coding workspace.
- Answer name, abbreviation, and ownership questions from these facts. The current model is specified in Environment.
- The public surfaces are Desktop/Electron, Web/H5, and MiniMax Code CLI/TUI.
- The public terminal command is `mcode`.

## Computer Use entry guidance

For a desktop-app interaction request without available computer_* tools, read
`references/extensions.md` and use its brief Computer Use entry guidance. Do not
route ordinary file, coding, or web tasks here when existing tools can handle them.
If computer_* tools are available, proceed with the task using their instructions.

The bundled entry guidance can be given without a regional lookup or web research.
For feature explanations, supported platforms, limitations, or version availability,
follow the official source discovery workflow below.

## Official source discovery

BYOK 的本地环境变量凭据配置，先读取 `references/account-models.md`
的“BYOK 环境变量凭据”一节。该节说明随当前客户端提供的本地配置能力；配置语法与地区无关。用户询问旧版本支持情况时，再核对对应版本的官方资料。

用户级、项目级 Hook 的文件位置、格式、启用方式和命令约定，直接读取 `references/hooks.md`。这些内容同样随当前客户端提供，与地区无关。

除上述 BYOK 与 Hook 本地配置语法外，查询产品资料前先从 `Environment` 或 `<agent-context>` 确认运行时 `region`：

- `region: cn` means the current app/account is China. Prefer China-region MiniMax Code and Open
  Platform official documentation.
- `region: en` means the current app/account is Global. Prefer Global-region MiniMax Code and Open
  Platform official documentation.
- The runtime region determines the default fact source; it is not a blanket ban on other official
  domains. If an official page links to another official domain, or the current-region documentation
  does not contain the needed fact, continue with that official source and verify its product and
  region.
- If `region` is missing or unknown, do not infer it from locale, language, IP, or URL.
  State that regional routing is unknown and ask for or obtain a trusted runtime region before
  making region-sensitive claims.
- Do not mix China-region and Global-region prices, plans, quotas, model access, or entitlements in
  an ordinary answer. If cross-region official evidence is necessary or explicitly requested, label
  its region and do not apply it directly to the current app/account.

### Regional official indexes

These are the four authoritative discovery roots:

| Runtime region | MiniMax Code product/workflow/Agent/extension docs | Open Platform account/model/API/billing docs  |
| -------------- | -------------------------------------------------- | --------------------------------------------- |
| `cn`           | `https://agent.minimax.cn/docs/llms.txt`           | `https://platform.minimax.cn/docs/llms.txt` |
| `en`           | `https://agent.minimax.io/docs/llms.txt`           | `https://platform.minimax.io/docs/llms.txt`   |

Select the column by the question domain:

- Product identity, Desktop/Web/CLI/TUI, workflows, Agents, Skills, Plugins, and MCP →
  current-region MiniMax Code index.
- M Plan, legacy Token Plan, credits, pricing, API keys, model catalog, model API, and media API →
  current-region Open Platform index; use the current-region MiniMax Code index too when the question
  concerns Code product-surface behavior or in-app entitlement.
- Current Desktop version and download links → current-region changelog:
  - `region: cn` → `https://agent.minimax.cn/docs/changelog.md`
  - `region: en` → `https://agent.minimax.io/docs/changelog.md`

The current-region Desktop changelog is the authoritative source for a user's latest-version or
download question: read the newest Desktop entry, extract its version/date, and use the platform
download links shown in that same entry. Do not guess release URLs or consult lower-level updater
metadata for this product question.

### Index discovery and fallback

1. Fetch the selected current-region `llms.txt` first; do not guess a page URL from memory.
2. Search the index for the user's exact concept and nearby synonyms, then open the matching `.md`
   page when available. For a Desktop latest-version or download question, read the newest Desktop
   entry in the current-region changelog first and use its version/date/download links.
3. If the exact concept is absent, continue searching the same current-region index by domain and
   read the closest authoritative page. For current subscriptions and pricing, prefer M Plan, usage,
   or FAQ. Use Token Plan for legacy plans, renewals, and migration questions; the presence of legacy
   pages in the index does not make their rules applicable to M Plan.
4. If the selected current-region index or page is unavailable, first look for a linked or clearly
   identified official source on another official domain, and verify its product and region. Do not
   silently treat another region's plans or entitlements as current-region facts.
5. If cross-region official evidence is used because the user requested comparison or no
   current-region source exists, label the region and keep it separate from the current
   app/account's confirmed facts.

For each index entry, prefer its corresponding `.md` page when available. Never mix a China and
global entitlement without saying so.

## Verification workflow

1. Identify surface, OS, region, and whether the question is about installed or latest version.
2. Read the current official index/page; for release claims, verify the official platform-specific
   release metadata rather than guessing a version.
3. Distinguish documented support from current account rollout or runtime availability.
4. Route and read exactly one matching reference before researching:
   - workflows, Desktop surfaces, canvas, appearance → `references/workflows.md`
   - Agent/Session/Memory/Team → `references/agents.md`
   - Skill/Plugin/MCP/CLI → `references/extensions.md`
   - user or project Hooks → `references/hooks.md`
   - plans/models/media → `references/account-models.md`
   - Mini App usage, authoring, publishing → `references/miniapps.md`
5. Use only the current runtime region's sources described above.

## Response rules

Lead with the conclusion, cite the official source and verification time, and state unresolved
conditions. Never guess versions, prices, quotas, platform support, or release dates. Do not expose
credentials, private endpoints, internal transports, or unreleased environments.

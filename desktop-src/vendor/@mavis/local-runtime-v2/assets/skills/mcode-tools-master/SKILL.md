---
name: mcode-tools-master
description: >-
  You must load this skill before running any `mcode-tools` Bash command. The `mcode-tools` CLI is
  available on PATH and serves two purposes: (1) multimodal generation and understanding, including
  images/photos, video, audio, music, and documents; (2) discovering, inspecting, and calling all
  App/Connector tools (App = Connector), including ordinary connected App requests, scripts, and
  batch automation. For multimodal generation or understanding requests, load this skill and use
  mcode-tools through Bash. App tools are not injected into the model tool list. Ordinary MCP and
  Plugin-owned MCP tools already in the model tool list can still be called directly.
  Load this skill when the user asks to use a named App/service, or specialized external or
  connected-account data may require App discovery before general web search.
requiresBeta: mcodeTools
descriptions:
  zh-Hans: >-
    调用任何 mcode-tools Bash 命令前必须先加载本 skill。mcode-tools CLI 已在 PATH 中，通过 Bash 调用，
    有两种用途：1）图片/照片、视频、音频、音乐和文档等多模态生成与理解；2）发现、查看和调用所有
    App/Connector 工具（App = Connector，指同一种已连接的应用集成），包括普通 App 请求、脚本和批处理。
    遇到多模态生成或理解请求，应先加载本 skill，再通过 Bash 使用 mcode-tools。
    App 工具不直接注入模型工具列表；普通 MCP 和 Plugin 自带 MCP 仍使用各自的直接工具。
    用户点名使用某个 App/服务，或需要专业外部数据、账户内数据时，应先加载本 skill 发现合适的 App 工具，
    再考虑通用网页搜索。
displayNames:
  zh-Hans: 'mcode-tools Connector'
---

# mcode-tools Master

App = Connector: both names refer to the same connected integration. An App in the product UI is a
Connector in the CLI; use `mcode-tools connector` to discover and call its tools.

Use the `mcode-tools connector` subcommands through the `bash` tool. The launcher is already on the
current runtime process PATH when this skill is available.

For every multimodal generation or understanding request, search Connector tools before saying the
capability is unavailable. Useful discovery keywords include `image`, `photo`, `video`, `audio`,
`music`, `document`, `generate`, `understand`, and `analyze`.

Use this skill for every App/Connector request, including an ordinary single call. The absence of
App schemas from the model tool list does not mean the user has no connected Apps. Ordinary MCP and
Plugin-owned MCP tools in that list remain directly callable.

Use the available Bash and Skill permissions. If Bash, this Skill, or the CLI is unavailable, report
that App access is unavailable in this Agent; do not assume an inline fallback or bypass
restrictions.

## When to Discover App Tools

- If the user asks to use a named App/service, including a natural-language name without `@`,
  discover its tools before substituting `web_search` or a browser. A request to use a named
  integration should be fulfilled through that integration; searching the web for its name and
  the task does not satisfy that source choice. A question about the service itself is not a
  request to use it.
- For company records, legal cases, financial datasets, workspace documents, or other tasks requiring
  specialized external or connected-account data, look for a suitable App when no relevant dedicated
  tool is already known. App tools invoked through Bash count as dedicated tools. Ordinary knowledge
  questions, local-file tasks, and explicitly requested web searches do not require this discovery.
- A Plugin can bundle Apps, MCP tools, and Skills. An App can also be connected independently of a
  Plugin. Neither a missing Plugin declaration nor an empty direct tool list proves an App is absent.
- Start with the requested service name or the task capability as a discovery keyword. Names may
  use another language or spelling: if the filtered list has no match, broaden the keyword or run
  `mcode-tools connector tools` without a filter once before deciding there is no suitable tool. Never
  guess a provider identifier or tool name from the user's wording; use the returned catalog.
- Prefer a suitable App tool when available. Web search may supplement it or be a clearly identified
  fallback consistent with the user request. If a specifically requested App is unavailable or
  discovery fails, explain that limitation; do not silently present web results as App results.
  A partial catalog or error does not prove the user has not connected the App. Do not request a new
  connection merely because a keyword search missed it.
- Do not rediscover all Apps on every turn. Reuse a known suitable tool and its inspected schema when
  appropriate; each CLI command still checks the current remote catalog.

## Get a Drive Asset URL

When you have a Matrix Drive `node_id` and need a fresh download URL, use the top-level command:

```bash
mcode-tools get_asset_url <node_id>
# Equivalent kebab-case spelling:
mcode-tools get-asset-url <node_id>
```

The command returns JSON such as:

```json
{
  "node_id": "429422773780544",
  "download_url": "https://example.invalid/short-lived-url"
}
```

In a Cloud sandbox conversation, deliver an unmodified original image/video using the exact Matrix
Drive `node_id` confirmed by a successful generation or query result in this turn:
`<deliver-assets><media type="image" src="commit-id-NODE_ID" /></deliver-assets>` outside a code block. Replace
`NODE_ID` with the confirmed ID; use `type="video"` for video. Delivery alone needs no URL lookup, download, copy, or node-map
write. Never infer an ID from user text, examples, filenames, task/folder IDs, or failed/pending
results. Edited, extracted, or transcoded files must be delivered as new workspace files, not as the
original node.

For Desktop/local or SSH conversations, unless the user instructs otherwise, download into the
current working directory and deliver the saved file using that runtime's media format. Do not use
an upstream Cloud node ID as a substitute for a saved local file.

On storage quota/space errors (`EDQUOT`, `ENOSPC`, `Disk quota exceeded`, or a node-map filesystem
error `-122`), stop repeating the failed command. Do not regenerate successful media, sleep/poll for
space, change `HOME`, write outside the workspace, or use symlinks/mounts to bypass it. Do not
delete user files to make room. In Cloud, deliver the already confirmed original node as above;
otherwise report the storage blocker and end the turn. A failed node-map write does not mean
generation failed, but it does not prove a download or local save succeeded either.

## Upload a Local File

Upload a local file and get a temporary URL with the top-level command:

```bash
mcode-tools upload_temp_url <file_path>
# Equivalent kebab-case spelling:
mcode-tools upload-temp-url <file_path>
# Optional MIME type override:
mcode-tools upload-temp-url <file_path> --mime-type <type>
```

Use the returned `temp_url`.

## Bash Tool Timeout

For generation commands—such as image, video, audio, music, or document generation—invoke `bash`
with `timeout: 600` (10 minutes). In the Bash tool input, `command` and `timeout` are sibling
fields:

```json
{
  "command": "mcode-tools connector call <tool_name> --args-file <path>",
  "timeout": 600
}
```

`timeout` is a top-level `bash` tool input field outside the command string. Never put `--timeout`,
`timeout=600`, or any other timeout argument in the command string: `mcode-tools connector call` has
no timeout option. Discovery and schema inspection commands can use the normal Bash timeout.

## Workflow

1. Discover candidate tools. Start with a keyword for a focused request; list all tools when the task
   is broad or filtered discovery cannot identify the requested App:

   ```bash
   mcode-tools connector tools
   mcode-tools connector tools --keyword <text>
   ```

   Do not run `mcode-tools list` or `mcode-tools connector list`; those are not valid discovery
   commands.

2. Inspect the selected tool before calling it. Use the returned `input_schema` to construct the
   arguments and `output_schema` to interpret a successful result; never guess field names or types:

   ```bash
   mcode-tools connector tool <tool_name>
   ```

3. Call the tool with exactly one JSON object. Use inline JSON for small arguments and a file for
   complex, generated, or cross-platform arguments:

   ```bash
   mcode-tools connector call <tool_name> --args '{"key":"value"}'
   mcode-tools connector call <tool_name> --args-file <path>
   mcode-tools connector call <tool_name> --args-file -
   ```

   `--args` and `--args-file` are mutually exclusive. Omitting both sends `{}`. Arrays, scalars, and
   `null` are not valid top-level arguments.

4. A successful `mcode-tools connector call` directly writes the top-level JSON value described by
   the inspected `output_schema` to stdout. Parse that value and return the useful output. Do not
   look for or unwrap `content` or `structuredContent` unless the `output_schema` declares those
   fields. If the command exits non-zero, surface its error code and message. Do not silently switch
   tools or repeatedly retry authentication errors.

## Selection Rules

- Tool names are returned as `tool_name`; pass that exact value to `tool` and `call`.
- Prefer `--keyword` before scanning a large tool catalog. It searches names and descriptions.
- Inspect `input_schema` again when validation fails instead of inventing extra arguments.
- Prefer `--args-file` when shell quoting would be fragile, especially on Windows.

## Current Availability and Failures

- Each `tools`, `tool`, and `call` command requests the current remote catalog. Known tools with
  already inspected arguments may be called again directly; no separate full list is required.
- Names in the form `connector__<provider>__<tool>` are CLI arguments, not direct model tool names.
- `partial` or `provider_failures` means discovery was incomplete. Do not claim that missing tools
  prove the user has not connected an App. Explain the failure and retry discovery when appropriate.
- A past schema does not grant access after disconnect or credential changes. Treat the current
  CLI/server response as authoritative; do not repeatedly retry authentication failures.

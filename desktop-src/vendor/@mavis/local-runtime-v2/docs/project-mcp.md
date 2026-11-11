# 项目级 MCP 配置

本地 Runtime 按当前 session 的主工作目录读取 `.mcp.json`，Desktop、MCode 交互式 TUI、`mcode exec`、`mcode acp` 和使用同一 Runtime 的 CLI 共用这一能力。无需导入，也不设置 MCP 专属批准或配置摘要授权。

```json
{
  "mcpServers": {
    "repo-tools": {
      "command": "node",
      "args": ["./tools/mcp-server.js"],
      "env": { "API_TOKEN": "${REPO_API_TOKEN}" }
    },
    "docs": {
      "type": "http",
      "url": "${DOCS_MCP_URL:-https://example.com/mcp}",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }
    }
  }
}
```

## 自动加载与连接

- Runtime 从 session 的 canonical `workspaceDir` 读取配置。不会因为客户端类型不同而跳过项目文件；项目路径不依赖启动 Runtime 进程时的 cwd。
- 读取配置或展示列表不会启动 MCP。实际 turn 工具发现或调用时，Runtime 自动连接有效且未禁用的 server。
- stdio 连接会执行项目配置里的命令，远程连接会访问配置的 URL；这是项目配置自动加载的产品约定。工具调用仍走原有权限策略，但工具权限确认发生在连接之后，不替代进程启动控制。
- 工具发现和调用前重新读取配置。文件内容或展开后的环境变量变化时，中止旧 project 调用、关闭旧连接，后续请求自动使用新配置，不再弹出批准窗口。
- 可以在 `.mcp.json` 中设置 `enabled: false` 停用条目。删除文件或整份文件无效时，移除项目层并恢复同名 profile 配置。
- 文件始终只读，不会导入或写回 profile 的 `mcp.json`，不持久化项目配置授权。

## 项目边界与格式

- 只读取主工作目录的 `.mcp.json`，不向上搜索、不扫描 `/add-dir`。从子目录启动且 session 主目录就是该子目录时，只读取子目录内的文件。
- 支持 stdio、`http`、`streamable-http`、`sse`；不支持的 transport 显示错误。
- `command`、`args`、`env`、`url`、`headers` 支持 `${VAR}`、`${VAR:-default}`。变量缺失时停用该 server 并显示变量名，不回显变量值。
- 支持正整数 `timeout`（毫秒）。Runtime 内部字段（builtin、tools、metadata 等）不会从项目文件加载。
- stdio cwd 与 MCP `roots/list` 都使用 canonical 主项目目录。远程 MCP 也收到该 root；HTTP 凭据禁止跨 origin 重定向携带。
- 文件最大 1 MiB，必须为项目内普通文件；允许指向项目内文件的 symlink。坏 JSON、读失败或名字归一化冲突使整份文件失效；单个 server 的错误不会阻止其他有效 server。项目目录已删除时，profile 和 builtin 仍可使用。

## 同名规则与状态

普通配置同名按 **ACP session > project > profile** 整条替换，不跨来源拼接 URL、command、env 或 headers。禁用或错误的 project entry 仍遮蔽同名 profile entry，避免悄悄连接另一个目标；保留的 builtin 名称不能被项目配置覆盖。插件仍由插件 Runtime 独立管理。

配置、连接与错误状态按 session、canonical 项目目录和配置版本隔离；清除 ACP 客户端注入不会清除项目文件配置。会话删除通过公共 Runtime 生命周期清理项目及客户端连接。

- TUI `/mcp`：显示当前 session 的 Built-in、User-configured、Project、Client session 配置和状态。
- TUI `/mcp reload`：重新读取并展示；`/mcp <filter>` 按 server 名过滤。没有 `approve` / `deny` 操作，它们可作为普通过滤词。
- ACP `/mcp <filter>`：列出当前 ACP session 的有效配置。
- 检查接口不回显 args、env、headers、URL query。全局 MCP 管理继续操作 profile 文件；项目文件的变更直接在项目中进行。

连接成功后状态为 `available`；未连接为 `configured`；禁用或无效时为 `disabled` / `error`。没有 `pending_approval` 状态。

## 带认证的远程 MCP 操作示例

在准备启动 MCode 的主项目目录创建 `.mcp.json`，将服务商提供的完整 MCP endpoint 写入 `url`，包括路径：

```json
{
  "mcpServers": {
    "research": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${RESEARCH_MCP_API_KEY}" }
    }
  }
}
```

`${RESEARCH_MCP_API_KEY}` 保持为字面环境变量引用，不把密钥写进文件或 URL。先在启动 MCode 的 shell 中设置该环境变量；其他 shell 后续修改的环境变量不能通过 `/mcp reload` 导入，需要从新环境重启 MCode。

1. 只配置可信服务。启用后，工具发现或调用会自动连接；远程服务也能通过 `roots/list` 得到主项目路径，工具权限确认发生在连接之后。
2. 输入 `/mcp research`，确认 **Project · .mcp.json** 条目为 `configured`。这只证明配置可读取，不证明认证或连接成功。
3. 按 `Esc` 关闭面板，以少量非敏感输入请求使用该服务的工具，通过 `Ctrl+O` 核对实际工具调用及返回；文字回答本身不能证明工具执行。连接后显示 `available` 也不等于业务任务成功。
4. 缺少环境变量会显示 `error` 并阻止该服务连接。检查 endpoint、环境变量与服务可用性；`error` 不一定代表认证失败。
5. 改文件后可用 `/mcp reload` 重读配置，它不是连接测试。`enabled: false` 停用有效条目；缺少变量或非法字段仍显示 `error`。

公开 CLI 的验证曾发现：已连接的 HTTP 条目变更后热重载可能以 `This operation was aborted.` 退出。当前操作建议是先退出 MCode，再修改已连接条目并重新启动；本次文档同步不包含热重载行为修复。

## OAuth 授权

远程项目 server 不写 `Authorization` 时可以走标准 MCP OAuth（RFC 9728 发现，PKCE S256）：

- 项目文件里的 `oauth` 只允许 `callbackPort`（1024–65535）。`clientId`、`scopes`、`callbackHost`、`authServerMetadataUrl`、`clientSecret` 等字段使该 server 显示配置错误；`oauth` 与 `headers.Authorization`（大小写不敏感）互斥。
- `callbackPort` 固定本机回调端口，CIMD 和动态注册（DCR）都生效，redirect_uri 为 `http://127.0.0.1:<callbackPort>/oauth/mcp/callback…`。端口被占用时报 `MCP_OAUTH_CALLBACK_PORT_IN_USE`，不回退到临时端口。改端口后已有授权继续可用，下次重新授权时按新端口重新注册客户端。
- 凭据按 `project:<工作区 realpath>` 隔离，不与用户 `mcp.json` 或插件共享；只能手动断开。
- 授权前必须确认：Runtime 返回 `requiresConfirmation` 与来源、MCP origin、issuer、client_id，宿主确认后才打开浏览器。授权服务器端点不允许解析到私网、回环或链路本地地址。
- 后台路径（Turn 前发现、懒连接）从不打开浏览器：遇到需要授权时状态为 `error`（`MCP server requires authorization.`），并发出带 sessionId/turnId 的 `mcp.auth_required`；同一 Session 和 server 只发一次，之后后台路径不再连接，直到授权完成、凭据变化，或该 server 的 URL、headers 被修改。工具调用此时返回同样的需要授权提示，不会报工具不存在。
- TUI 通过 `/mcp` 授权面板或 `mcode mcp login <name> --project` 完成授权。

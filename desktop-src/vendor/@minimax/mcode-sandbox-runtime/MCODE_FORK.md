# MCode Sandbox Runtime Fork

本仓库是 Anthropic Sandbox Runtime 的内部可审计 fork。GitHub 上游保留为
`upstream`，内部 GitLab `matrix/mcode-sandbox-runtime` 是评审、构建和发布的
source of truth。任何内部 release 都必须能够追溯到 `upstream.json` 中的上游
tag/SHA、下面列出的内部 delta、验证证据和发布 tarball。

## Source identity

- Upstream: `https://github.com/anthropic-experimental/sandbox-runtime`
- Baseline: `v0.0.74`
- SHA: `e5fb1b93ba61bab8e916bee7541860bbdaa612cf`
- Internal package: `@minimax/mcode-sandbox-runtime`
- Registry: `https://npmmirror.xaminim.com/`

`npm run verify:fork` 会校验上游 tag/SHA、当前 HEAD ancestry、内部包版本前缀、
registry 和 GitLab repository metadata。source identity 校验失败时禁止 pack 或发布。

## Maintained deltas

| ID          | 状态   | 改动与原因                                                                                                                                                  | 验证                                                                                          | 冲突热点                                                                                                         | 删除条件                                                    |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `MCODE-001` | active | 使用 scoped 私有包名、RC 版本、内部 registry 与 GitLab metadata，防止发布到公网并让 consumer 可精确 pin。                                                   | `npm run verify:fork`、package identity unit test、tarball dry-run。                          | `package.json`、`package-lock.json`、README 安装/import 示例、全局 vendor fallback 路径、上游 release workflow。 | 不删除；内部 fork 存续期间这是包身份契约。                  |
| `MCODE-002` | active | 增加机器可读 `upstream.json`、本 manifest 和 GitLab CI，固定 source identity、跨平台 artifact 与受保护发布门禁。                                            | `npm run verify:fork`、GitLab MR/tag pipeline、同一 tarball smoke。                           | 上游 release tag、CI/runtime 版本和 vendor artifact assembly。                                                   | 仅在等价治理迁移到新的内部 source of truth 后删除。         |
| `MCODE-003` | active | 增加 `allowSecurityServer`，默认 `true` 保持上游兼容；restricted policy 可关闭 macOS SecurityServer lookup。                                                | macOS profile 正反测试、Phase 0 Keychain probe。                                              | `sandbox-config.ts`、`sandbox-manager.ts`、`macos-sandbox-utils.ts`。                                            | 上游提供同语义开关后删除。                                  |
| `MCODE-004` | active | 增加 `filesystem.unlinkAllowOnly`，在保留普通写范围的同时将 `file-write-unlink` 收紧到 canonical roots。                                                    | SBPL 顺序/操作结构断言、真实工作面内外删除、mandatory tree 与 full-access probes。            | macOS read/write/move rule ordering。                                                                            | 上游提供 operation-scoped delete 后删除。                   |
| `MCODE-005` | active | 增加 deny-first 的 `network.allowAll`，让未命中 deny 的目标可放行且仍经过 proxy、支持 live update。                                                         | deny 优先、allow-all、live `updateConfig()` 正反测试。                                        | network schema 与 proxy matcher。                                                                                | 上游提供 deny-preserving allow-all 后删除。                 |
| `MCODE-006` | active | `wrapWithSandbox` options 接收 sanitized `baseEnv`；JVM、Git、credential mask 与 POSIX/Windows spawn composition 不再回读 ambient child env。               | 三站点 base-env regression、credential sentinel 与无 manager 持久化断言。                     | wrapper options、platform wrappers、parent-proxy resolver。                                                      | 上游支持 per-call base env 后删除。                         |
| `MCODE-007` | active | 删除上游品牌共享 temp/write defaults，要求新 filesystem-enabled options 显式传 `sandboxTempDir`；同步 MCode socket/port env、JVM namespace 与安全保护目录。 | default/path identity tests、JVM jar build/smoke、seccomp self-bootstrap、tarball whitelist。 | default paths、Linux bootstrap、Java build input、品牌保护清单。                                                 | 上游支持 consumer-owned temp 且分发面不再含产品品牌后缩减。 |
| `MCODE-008` | active | 增加 `network.disabled`（对齐 `filesystem.disabled` 先例）：为 true 时整体跳过网络子系统——initialize 不启动 mux 代理/socat bridge/Java agent，wrap 不注入任何代理/证书/JVM env，macOS profile 输出 `(allow network*)` + `(allow system-socket)`；与 `tlsTerminate`/`mitmProxy`/`parentProxy`/`httpProxyPort`/`socksProxyPort` 互斥（schema superRefine 拒绝）。文件与 credential-env 防护不受影响。 | `network-disabled.test.ts` 正反测试（schema 互斥、无代理启动、profile/env 断言、loopback+Unix socket 真实探针、文件防护回归、未设 `disabled` 时 control 行为不变）。 | network schema、`sandbox-manager.ts` 判定与 initialize、macOS 无限制网络分支。 | 上游提供同语义的网络整体停用开关后删除。 |

本 fork 的安全语义只允许上表列出的增量。每次上游同步必须逐项重放正反测试；
不得把新的产品策略、listener lifecycle 或 domain matcher 顺手下沉进 fork。

### `v0.0.74` candidate audit

| 候选项                           | `v0.0.74` 事实                                                 | 后续门禁                                                                            |
| -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `allowSecurityServer`            | `MCODE-003` 已实现；缺省仍为 `true`。                          | 上游同步时重放 profile 与 Keychain 正反 probe。                                     |
| `network.allowAll`               | `MCODE-005` 已实现；deny 先于 allow-all。                      | 上游同步时重放 live update 与 deny-first probe。                                    |
| `unlinkAllowOnly`                | `MCODE-004` 已实现；缺省不发额外 SBPL。                        | 上游同步时逐段核对 read allow → global deny → roots allow → trailing re-deny 顺序。 |
| `baseEnv`                        | `MCODE-006` 已实现；未传时只为兼容旧调用方回落 `process.env`。 | consumer 必须传 sanitized env；parent proxy 在本期产品 schema 不开放。              |
| `sandboxTempDir`                 | `MCODE-007` 已实现；不再生成品牌共享 fallback。                | 新 filesystem-enabled options 必须显式传 session 私有目录。                         |
| `registerCommandText` 上游不变式 | `id === text` 时不注册，fork 只增加 size probe。               | 每次升级保留 no-registration regression。                                           |

## Branch and release policy

- `upstream/main` 是上游只读镜像，只接受受控同步。
- `main` 是唯一内部集成和 release tag 来源，只通过 MR 更新。
- 内部改造使用 `feat/*`；上游升级使用 `sync/upstream-vX.Y.Z`。
- 上游升级合并完整 release tag，保留 merge commit，不 squash。
- 首次发布必须使用 `0.0.74-mcode.rc.N` 和 `rc` dist-tag；正式版本必须在 RC、
  tarball integrity 和 packaged smoke 全部通过后另发 `0.0.74-mcode.N`。
- 已发布版本不可覆盖或删除；回滚通过新的修复版本和 consumer exact pin 完成。

## Release gates

发布 tag 前必须同时满足：

1. `upstream.json` 校验通过，release commit 位于 `main` ancestry。
2. lint、typecheck、受影响测试和承诺平台的 upstream suite 通过。
3. Linux seccomp、Windows helper 和 JVM proxy agent 已装配到同一个 tarball。
4. tarball 包名、版本、LICENSE、文件清单和 SHA-256 已记录。
5. RC 从 Verdaccio 安装到空目录后完成 import、CLI/API 与真实 Sandbox smoke。
6. GitLab protected tag 发布的就是已经验证的同一个 tarball。

RC 与稳定版只能由 GitLab 受保护 tag 的 manual publish job 发布；MR pipeline 不接触 registry。
发布 job 只消费 package stage 已构建并验证的同一个 tarball，禁止在 publish stage 重建。
CI 显式为 `main` 创建分支 pipeline，不依赖项目的默认分支设置。发布 job 在读取发布凭据前
拉取 `origin/main`，并验证 tag commit 位于其 ancestry；不属于 `main` 的受保护 tag 同样拒绝发布。

Linux suite 使用 `node scripts/run-test-files.mjs`，按文件顺序启动独立进程。CLI /
control-fd 的 `.test.mjs` 使用 Node 原生 test runner 与发行 Node 入口，其余 TypeScript
文件使用 Bun 并设置 `--max-concurrency=1`。Bun `--isolate` 只重建 JavaScript
global object，不能替代进程隔离；完整套件复用进程时曾出现跨文件的子进程等待超时。
启动器默认收集 `test/` 下的 test/spec 文件；可传明确的测试文件，或通过
`--exclude <file>` 划分 hermetic/public-network lane。两条 lane 保留原有代理环境、
安全断言，任一文件失败都会使启动器返回非零退出码。

`control-fd` CLI 测试发送有限输入后关闭 stdin/control pipe，并等待 child `close` 与输出流结束。
超时明确失败，不再把固定等待时间到期当成命令完成；2.3 秒启动延迟用例覆盖旧 2 秒等待的竞态。
CLI 参数套件由 Node 同步等待构建后的 Node 入口，进程安全期限短于测试 runner 期限；5.3 秒命令
回归确保 runner 不会先中止等待并把空输出冒充成完整命令结果。

## Upstream sync

```bash
git fetch upstream --tags
git switch -c sync/upstream-vX.Y.Z origin/main
git merge --no-ff vX.Y.Z
```

同步分支必须更新 `upstream.json`、本 manifest 和 `package.json.version`，并重新执行
全部 release gates。只有尚未进入 release tag 的紧急上游安全修复才允许
`git cherry-pick -x <sha>`；下一个正式 tag 包含该修复后应删除临时 delta。

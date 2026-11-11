# Legacy opencode 迁移验收方案

> 当前 owner：`packages/local-runtime-v2/src/service/session-system/legacy-migration/`
> 负责 metadata / display / pi-history 迁移；历史数据读取与兼容 migrator 位于
> `packages/local-runtime-v2/src/infra/legacy-db/legacy-opencode-migrator.ts`。
> 本方案保留三层 lazy 迁移不变量与历史端到端验收记录，**不是** unit test 的替代。
>
> 当前脚本：`packages/local-runtime-v2/scripts/migrated/legacy-opencode-migration-launcher.mjs`，
> 使用 `createLocalRuntimeHostV2`、`runtimeMode: 'clean'`。旧 `packages/local-runtime/test/scripts/legacy-opencode-migration-launcher.mjs` 已退役。
> 配套观测：`[legacy-opencode-migration]` 日志前缀（`LEGACY_MIGRATION_LOG_PREFIX`）。
>
> 本轮只迁移文档并核对 v2 路径，未执行 launcher、T1–T13 或真实 LLM 验收。
> §3–§6 的 REST 示例、性能、问题状态与 PASS 证据保留历史口径，重新验收时须按当前 v2 API 核对。
> 文中的 rollback / 非 clean daemon 行为仅作历史说明，当前不提供旧 executor 或 daemon fallback。

---

## 1. 目的

`legacy-opencode` 是本地产品链路里把旧 daemon 持久化（`~/.minimax/sqlite.db` + 原生
`opencode.db`）按需读出，挂到 clean local-runtime 的 v2 数据空间。该路径**只读**遗留库，
所以验收必须满足三个不变量：

1. **不写遗留库**：launcher 跑完，用户原始 `~/.minimax/sqlite.db` 和 `~/.local/share/opencode/opencode.db`
   的逻辑内容（行数 / per-SID 字段）零变化。
2. **零消息丢失**：display side `sourceMessageCount == importedMessageCount`。pi-history 由 native
   降级策略决定，丢失视为原生 DB 自身缺失，但仍需 strategy + warningsCount 在日志里可追。
3. **可观测**：每条 lazy 迁移触发一条 start，结束一条 done；每个 import 子阶段一条
   `<phase>-import done`；strategy 与降级原因写到 pi-history 行；幂等命中走 controller 短路（不再
   触发 migrator），仅 debug-jsonl 在 export 时再打一次。

---

## 2. 前置环境

### 2.1 Fixture 隔离（macOS APFS）

```bash
FIXTURE=/tmp/mavis-opencode-pi-test
mkdir -p "$FIXTURE/opencode/data"
cp -c "$HOME/.minimax/sqlite.db"                          "$FIXTURE/sqlite.db"
cp -c "$HOME/.local/share/opencode/opencode.db"         "$FIXTURE/opencode/data/opencode.db"
sha256sum "$HOME/.minimax/sqlite.db" "$FIXTURE/sqlite.db" \
  | tee "$FIXTURE/baseline-sha256.txt"
```

Linux 上把 `cp -c` 换成 `cp --reflink=always`（需 btrfs / xfs）。其他文件系统先 plain `cp`，再
`chmod -w` 保证只读语义。**禁止把 `$HOME/.minimax` 直接当 `MAVIS_DATA_DIR`** — launcher 没有
"假装只读" 模式，写入会真落到用户原始 DB。

### 2.2 Dist 必须 fresh

`pnpm --filter @mavis/local-runtime-v2 build`。

启动 launcher 会 `stat` `src/**` 和 `dist/**` 的最新 mtime，源比 dist 新 1s 以上即 `process.exit(2)`
并打印 rebuild 提示。这是为了防止陈旧 dist 静默吞掉 migrator 发出的 observability 日志。

### 2.3 XDG 隔离防 native DB fallback

```bash
export XDG_DATA_HOME="$FIXTURE/.xdg-data"
export XDG_STATE_HOME="$FIXTURE/.xdg-state"
```

discoverNativeOpencodeDb 的 fallback 链会扫 `sandbox-data` → `sandbox-state` → `xdg-data` →
`xdg-state`，缺失时回退到用户 `~/.local/share/opencode/opencode.db`。XDG 重定向空目录即可断这条
fallback；不设的话 e2e 跑出来的"覆盖结果"是混杂用户真 native DB 的，不能算干净验收（I4）。

### 2.4 启动 launcher

```bash
MAVIS_DATA_DIR="$FIXTURE" \
MAVIS_LAUNCHER_PORT=15324 \
XDG_DATA_HOME="$FIXTURE/.xdg-data" \
XDG_STATE_HOME="$FIXTURE/.xdg-state" \
  node packages/local-runtime-v2/scripts/migrated/legacy-opencode-migration-launcher.mjs \
  | tee /tmp/legacy-launcher.log
```

launcher 应包含以下启动信息（可能夹有配置与 auth 日志，不要求固定为前 4 行）：

```
[legacy-migration-launcher] dist freshness OK (src ..., dist ...).
[legacy-migration-launcher] listening on http://127.0.0.1:15324
[legacy-migration-launcher] dataDir=/tmp/mavis-opencode-pi-test
[legacy-migration-launcher] runtime V2 dist entry=.../dist/index.js (mode=clean, owner=cli)
```

任何一行缺失就停下来排查，不要继续跑 T1-T12。

---

## 3. 历史验收矩阵 T1-T13

以下保留原 REST、日志与 SQL 示例，用于理解迁移不变量。旧表名、ready 字段、controller
短路与 failed 恢复口径不直接等同于当前实现；当前 Session System 维护入口见 §7。
SQL 只用于隔离 fixture，不能作为用户运行目录的恢复命令。

> 所有 `curl` 走 `http://127.0.0.1:15324/mavis/api`；`jq` 用 1.7+；时间统一 ms。

### T1 — Metadata lazy

**触发**：`GET /agent/main/session?limit=2000`

**期望**：返回 `{ sessions: [...] }`，每个 entry 含 `migration.status`。同时 launcher.log 至少
有一批 `[legacy-opencode-migration] start session=<sid> agent=main includeMessages=false includePiHistory=false`
行（每个会话一次，幂等命中也会走 start 行但很快返回 metadata-only）。

**关键断言**：

```bash
curl -sf "http://127.0.0.1:15324/mavis/api/agent/main/session?limit=2000" \
  | jq '.sessions | map(.migration.status) | group_by(.) | map({(.[0]): length}) | add'
```

输出应该是 `{ "metadata": N, "migrated": M, "deleted": K, "failed": F }`，N + M + K + F 等于
列表长度。第一次跑 fixture 时 `metadata` 应等于全列表。

### T2 — Display lazy（含消息）

**触发**：`GET /agent/main/session/<SID>` 或对话首次 open。

**期望**：response 包含 messages 数组；launcher.log 多出
`[legacy-opencode-migration] display-import done session=<SID> messages=<N> elapsedMs=<n>`。
首次后该 SID 的 `migration.displayReadyAtMs` 被持久化。

**关键断言**：每个 SID 的 `messages.length == sourceMessageCount`（display 零丢失）。

### T3 — Pi-history lazy（debug JSONL 导出）

**触发**：`GET /debug/session/<SID>/pi-history.jsonl`

**期望**：HTTP 200，NDJSON：line 1 是 header，之后每行 message。

```bash
SID=<choose-a-metadata-sid>
curl -sf "http://127.0.0.1:15324/mavis/api/debug/session/$SID/pi-history.jsonl" \
  -o /tmp/t3.jsonl
head -1 /tmp/t3.jsonl | jq '.header | {version, kind, source, messageCount}'
# 期望: version=3 kind=pi-agent-session-history source=local-runtime-debug-export
wc -l /tmp/t3.jsonl  # == messageCount + 1
```

launcher.log 期望 5 条事件：`start ... includeMessages=true includePiHistory=true` →
`display-import done` → `pi-history strategy=<S>` → `pi-history-import done strategy=<S>` →
`done status=migrated ... totalElapsedMs=<n>` → 最后 `debug-jsonl session=<SID> messages=<n> bytes=<m>`。

### T4 — 幂等

**触发**：再次 `GET /debug/session/<SID>/pi-history.jsonl` （T3 后）。

**期望**：HTTP 200，elapsed 应该是 T3 的 **<2%**（毫秒级 vs 秒级）。launcher.log **新增** 行
**只有一个** `debug-jsonl`，没有 `start` / `display-import` / `pi-history` / `done` —
controller 层直接短路，根本不再调 migrator。

> Controller 层在 `pi_history_ready_at_ms` 已设时直接短路，根本不再调 migrator，所以
> migrator 内部的 `existing-seed-preserved` 行不会出现。若以后想恢复"幂等也打一条 trace"，
> 参考 §7。

**字节级断言**：

```bash
diff <(jq -S 'del(.header.exportedAtMs)' /tmp/t3.jsonl) \
     <(jq -S 'del(.header.exportedAtMs)' /tmp/t4.jsonl)
# 应该完全无输出 — 仅 exportedAtMs 不同
```

### T5 — No-drop（display 侧）

对每个被迁移的 SID 跑：

```bash
curl -sf "http://127.0.0.1:15324/mavis/api/agent/main/session/$SID" \
  | jq '{src: .migration.sourceMessageCount, imp: .migration.importedMessageCount}'
# 期望: src == imp
```

至少抽 1 个短（<100 msg）、1 个中（500-1000 msg）、1 个长（>3000 msg）SID 验证。

### T6 — Strategy 矩阵

native opencode.db 的完整度决定 strategy 选择：

| Strategy            | 何时选 | log 字段                         |
|---------------------|--------|----------------------------------|
| `native-perfect`    | 原生消息数等于 legacy display 消息数  | `nativeMessages == imported`    |
| `native-degraded`   | 原生 < legacy（最常见）              | `nativeMessages < imported` + warnings |
| `display-seed-full` | 原生缺失或全坏，从 display 重生 seed | `fallbackReason=<reason>`      |

**手动覆盖 `display-seed-full`**：

```bash
mv "$FIXTURE/opencode/data/opencode.db" "$FIXTURE/opencode/data/opencode.db.bak"
# 这样会触发 fallback。配合 XDG_DATA_HOME 隔离防止读取用户真 opencode.db。
# 触发一个未迁移 SID 的 pi-history，期望日志含 strategy=display-seed-full
```

`native-perfect` 在真实用户数据上通常不可触发（legacy 写入比 native 完整），只能 unit test。

### T7 — Failed retry

**触发**：在 migration table 注入合成失败行：

```bash
sqlite3 "$FIXTURE/v2/sqlite/local_runtime.db" <<SQL
INSERT INTO local_runtime_legacy_migrations (legacy_session_id, status, error_json, ...)
VALUES ('<SID>', 'failed', '{"message":"synthetic test failure"}', ...);
SQL
curl -sf "http://127.0.0.1:15324/mavis/api/agent/main/session/<SID>" -w '%{http_code}'
```

**期望**：HTTP 200，response 含 `session.migration.status === "failed"` 与原 error 元数据；
session 仍可走 PATCH/DELETE/archive/POST message。table 行状态保持 `failed`，没有自动 retry
（user 视角不再有"failed legacy"的概念，failure 仅作为元数据透传给 UI 展示错误条幅）。

> 已知：当前无自动恢复路径（I3）。手动恢复：
> `DELETE FROM local_runtime_legacy_migrations WHERE legacy_session_id='<SID>';` 然后重触发。

### T8 — Deleted marker

```bash
curl -X DELETE -w '%{http_code}' "http://127.0.0.1:15324/mavis/api/agent/main/session/<SID>"
# 期望: 200, body {"success":true} —— deleted 之后 GET /session/<SID> 404
```

非 clean mode 返回 501。setStatus='deleted' 是内部 markSessionDeleted（无公开 HTTP route）。
clean mode 下任何 status 的 opencode 源会话都允许 DELETE，详见 T13。

### T9 — 附件规整

挑一个 legacy session 含附件（`session_messages` 里 part 含 attachment URI）：

```bash
SID=$(... pick from legacy DB ...)
curl -sf "http://127.0.0.1:15324/mavis/api/debug/session/$SID/pi-history.jsonl" -o /tmp/t9.jsonl
ls "$FIXTURE/v2/assets/" -R | head    # 期望: 按 YYYY/MM/DD/<asset_id>.* 落盘
cat "$FIXTURE/v2/assets/.../<asset_id>.json" | jq .   # 期望: 含 mime_type / size_bytes
```

`assets.jsonl` 索引每条附件追加一行。

### T10 — 长 session 性能

挑一个 >3000 msg 的 SID 跑 T3，期望 `display-import elapsedMs < 5000` 且
`pi-history-import elapsedMs < 5000`（典型值 1.5-2s）。总 elapsedMs 可以更长（含 warn 排查 +
fixture I/O），关注的是各 import 阶段。

### T11 — JSONL 完整性

```bash
for FILE in /tmp/t*.jsonl; do
  jq -c . "$FILE" >/dev/null && echo "$FILE: OK"
done
```

每个 JSONL 必须每行都是 valid JSON object。同时 `wc -l` 应该等于 header 里的 `messageCount + 1`。

### T12 — No writeback

```bash
sha256sum "$HOME/.minimax/sqlite.db" "$FIXTURE/sqlite.db" \
  | tee "$FIXTURE/post-test-sha256.txt"
diff "$FIXTURE/baseline-sha256.txt" "$FIXTURE/post-test-sha256.txt"
```

**注意**：APFS reflink 下，**SHA 可能漂移**（用户日常 mavis daemon 写入会改变 source 块；fixture
保留原始块通过 copy-on-write）。**逻辑内容**才是 invariant，不是 SHA。逻辑断言：

```bash
sqlite3 "$FIXTURE/sqlite.db" 'SELECT COUNT(*) FROM sessions;'
sqlite3 "$FIXTURE/sqlite.db" 'SELECT COUNT(*) FROM session_messages;'
# 这两个数字应与 reflink 当时的 baseline 完全相同。
```

launcher 在 legacy-opencode-store.ts 用 `readonly: true` 打开 SQLite，写路径不存在。

### T13 — 续聊 + local REST mutation 回归（任意 status 的 opencode 源会话）

兼容后 user 视角不再有 "legacy session" 概念：clean mode 下所有 mutation 路径
（PATCH title/workspaceDir、POST archive/compress/abort、queue/*、POST /message、
DELETE）对任何 `status`（metadata / migrated / failed）都应返回 200。failed status 不再
触发 `409 read_only_legacy_session`，也不再把根接口降级为 500，只是把 `migration` 元数据
和 `errorMessage` 一起暴露给前端展示。

```bash
SID="<已 metadata / migrated / failed 任一 status 的 session id>"
PORT=15324

# 期望:HTTP 200,SSE 流第一帧 type=10 heartbeat,user msg append,assistant 帧 emit
curl -i -N -X POST "http://127.0.0.1:$PORT/mavis/api/session/$SID/message" \
  -H "Content-Type: application/json" \
  -d '{"content":"测试续聊"}' | head -20

# 期望:全部 HTTP 200
curl -i -X PATCH "http://127.0.0.1:$PORT/mavis/api/session/$SID" \
  -H "Content-Type: application/json" -d '{"title":"renamed"}'
curl -i -X POST  "http://127.0.0.1:$PORT/mavis/api/session/$SID/archive" \
  -H "Content-Type: application/json" -d '{"archived":true}'
curl -i -X DELETE "http://127.0.0.1:$PORT/mavis/api/session/$SID"
```

历史实现入口（已退役）：`packages/local-runtime/src/api/host-legacy-helpers.ts`
`isReadOnlyLegacySession(_migrator, sessionOrId)`。以下保留当时的行为说明；当前由 Session System
迁移 readiness 与 Conversation Application / Turn System 协作，不在旧 host helper 继续开发：

- 仅当 `session.runtime === 'opencode'`（rollback mode 仍由 legacy daemon 托管）时返回
  `true`；clean mode 下迁移记录的 `status` 不再决定可写性。
- `failed` 记录不再让 `resolveLocalSessionById` 抛 `LegacyOpencodeMigrationError`：
  `host-support.ts:resolveLocalSessionById` 直接归一化返回本地行，PATCH/DELETE/archive/queue
  全部走原生 controller 路径。
- `openLocalMessageStream` 仍调 `ensureLegacyPiHistoryMigrated` 做尽力补齐，但失败时仅
  在 try/catch 里吞掉 `LegacyOpencodeMigrationError`,允许在缺失 legacy pi-history 的会话上
  继续发新 turn（model 仅看到新 user message,缺失旧上下文已通过 `migration` 元数据透传给前端）。

#### 真 LLM 端到端验证

要在 launcher 里跑通真 LLM 而不是停在 SSE 帧层，需要两件事：

1. **launcher 读 fixture `config.yaml`** ——
   `legacy-opencode-migration-launcher.mjs` 的 `configGetter` 调用
   `@mavis/config.getConfig()`，从 `<MAVIS_DATA_DIR>/config.yaml` 读取实际 provider 块
   （默认硬编码 config 不带任何真 provider）。
2. **fixture `config.yaml` 注入可调通的 provider** —— 比如平台内部 Messages-compatible gateway：
   ```yaml
   provider:
     minimax:
       npm: '@ai-sdk/anthropic'
       options:
         apiKey: <real-key>
         baseURL: https://platform-api.xaminim.com/v1
         headers:
           X-Sub-Module: Mavis                    # 必须在 provider 级 options.headers
       models:
         MiniMax-M3:
           name: MiniMax-M3
           tool_call: true
           limit: { context: 200000, output: 8192 }
   ```
   注意 `X-Sub-Module` header 必须放在 `options.headers` 下，不是 model 级 —— model-resolver
   只读 `provider.options.headers`（见 `runtime/model-resolver.ts:resolveLocalProviderCredentials`）。
   上述 provider/model 仅是可运行的脱敏等价示例，不代表历史实测所用模型。

随后 POST 时用 `model` override 切到该 provider 即可：

```bash
curl -s -X POST "http://127.0.0.1:15324/mavis/api/session/$SID/message" \
  -H "Content-Type: application/json" \
  -d '{
        "content":"基于历史回答一句",
        "model":{"provider_id":"minimax","model_id":"MiniMax-M3"}
      }'
```

历史实测样本（历史外部模型（已脱敏）；mvs_df69 …，190 条迁移历史）：

| 轮次 | elapsed | streaming chunks | finish_reason | total_tokens | input_tokens | output_tokens | cache_write |
|------|---------|------------------|---------------|--------------|--------------|---------------|-------------|
| T1   | 4 992 ms | 9                | stop          | 18 102       | 3 (cache hit)| 99            | 18 000      |
| T2 (follow-up) | 4 097 ms | 9                | stop          | 18 217       | 3 (cache hit)| 72            | 18 142      |

18k input tokens（cache_write）说明 190 条迁移历史真实进入 prompt；turn 2 的 cache_write
增长涵盖了 turn 1 的 user/assistant，说明跨 turn 续聊上下文连续。

---

## 4. 观测字段速查

完整事件清单：

| Event                            | Trigger                                  | 关键字段                                                                |
|----------------------------------|------------------------------------------|-------------------------------------------------------------------------|
| `start`                          | 进入 migrator                            | `session`, `agent`, `includeMessages`, `includePiHistory`                |
| `display-import done`            | display 阶段完成                          | `session`, `messages`, `elapsedMs`                                      |
| `pi-history strategy=<S>`        | 决定 pi-history 来源                     | `session`, `nativeMessages`, `imported` 或 `fallbackReason`              |
| `pi-history-import done`         | pi-history 阶段完成                       | `session`, `strategy`, `messages`, `elapsedMs`                          |
| `done`                           | migrator 整体收尾                         | `session`, `status`, `sourceCount`, `importedCount`, `displayReady`, `piHistoryReady`, `totalElapsedMs`, `warningsCount` |
| `debug-jsonl`                    | `/debug/session/.../pi-history.jsonl` 导出 | `session`, `messages`, `bytes`                                          |
| `failed`                         | migrator 抛错（含 retry-on-failed 拒绝）  | `session`, `error`                                                       |

幂等命中**只**会再打一条 `debug-jsonl`（controller 层短路）。

---

## 5. Invariants 总览

| Invariant                  | 验证方式                                  | T-step          |
|----------------------------|-------------------------------------------|-----------------|
| Lazy: 触发前不动 v2         | T1 list 前 `local_runtime_legacy_migrations` 为空 / 仅前次 run 残留 | T1 |
| display 零丢失              | `sourceMessageCount == importedMessageCount` | T5             |
| pi-history 降级可追         | strategy + warnings 在日志里               | T3 / T6        |
| 幂等只读                    | 重复调 JSONL：内容字节级相同、无 import-done | T4             |
| Failed 不自动 retry         | T7 注入 failed → root 接口 200 + 状态保留 + 自动 retry 不发起 | T7             |
| Read-only legacy            | clean mode 任何 status DELETE/PATCH/archive/message → 200 (T13);rollback 模式仍 409 (T8) | T8 / T13 |
| 附件规整                    | v2/assets/ 落盘 + index 追加               | T9             |
| 长 session 性能             | `<phase>-import elapsedMs < 5000ms`        | T10            |
| JSONL 合法                  | `jq -c` 每行都 parse                       | T11            |
| 用户 DB 逻辑不变            | sessions / session_messages count 等于 baseline | T12         |

---

## 6. 已知 issues 速查

| ID | 严重度 | 现象                                          | 处理状态       |
|----|--------|-----------------------------------------------|----------------|
| I1 | major  | stale dist 静默吞观测日志                     | **已修**（launcher pre-launch dist sanity check） |
| I2 | minor  | T4 幂等命中无 `existing-seed-preserved` 日志   | 未修；本方案 T4 已按 controller 短路口径校准      |
| I3 | minor  | failed 状态无自动恢复路径                      | 未修；§3 T7 给出手动恢复 SQL                       |
| I4 | minor  | 缺 XDG 隔离时回退读用户真 opencode.db          | **已文档化**（§2.3 设 `XDG_DATA_HOME` / `XDG_STATE_HOME`） |
| I5 | minor  | T12 用 SHA256 误报漂移（APFS COW）             | **已文档化**（§3 T12 改用逻辑内容对比）            |

I2 / I3 是后续 follow-up issue 候选，不阻塞主路径。

---

## 7. 当前 v2 维护提示

- **迁移 owner**：维护 `packages/local-runtime-v2/src/service/session-system/legacy-migration/`
  的 importer、conversion 与 pi-seed；旧 source 的只读适配器为
  `packages/local-runtime-v2/src/infra/legacy-db/readonly-source.ts`。目录内的
  [README](../src/service/session-system/legacy-migration/README.md) 说明当前 readiness、恢复与 tombstone 语义。
  旧 `legacy-opencode/strategies/` 与 host helper 不是当前开发入口。
- **兼容与业务边界**：metadata / display 查询走 `ensureDisplayReady()`，Turn 输入准备走
  `ensureExecutionReady()`；迁移不拥有 runtime executor。历史 failed / rollback 行为以档案方式保留，
  当前恢复规则按上述 owner 实现核对，不复活 daemon。
- **改动观测字段**：保留 source 只读、display 不丢、续聊不覆盖与迁移幂等的不变量；
  观测变更同步更新验收断言。§4 的旧日志字段不能代替当前 importer 的真实观测证据。
- **改 dist 构建链**后：使用 §2 的 v2 build / launcher 验证 freshness guard；
  不因旧 host 日志不同而关闭 guard 或切回 legacy launcher。

按改动范围选择相关测试（从仓库根目录执行；本轮文档迁移未运行）：

```bash
node scripts/test/focused-vitest.mjs --package @mavis/local-runtime-v2 test/integration/legacy-opencode-importer.integration.test.ts test/integration/legacy-history-sanitizer.integration.test.ts test/integration/session-system-legacy-migration-repository.integration.test.ts
```

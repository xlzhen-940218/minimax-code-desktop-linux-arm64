# 记忆真实模型验收

## 当前验收状态（2026-09-20）

用户已确认历史内容外推问题解决，MR !6286 的当前合入检查移除该项阻塞。下方 2026-09-10 的单模型与双模型结果保留为当时的原始观察，包含内容范围、搜索键、发布状态与用量。

本次依据用户确认更新状态，未新增真实模型复验记录。目标分支同步与冲突处理的工程验证结果记录于 MR。

## 验收运行方式

直接读取系统主数据目录的 `config.yaml`（默认 `~/.minimax/config.yaml`），复用生产模型解析、认证、推理强度和内置记忆提示词。按本次验收指定，迁移、Stage One 和 Stage Two 均使用 `minimax/MiniMax-M3`；在测试内覆盖 `captureModel` 与 `consolidationModel`，系统配置文件保持原值。OAuth 使用同目录的 `codex-auth.json`，托管登录使用现有登录状态。

## 完整模块的无界面运行入口

指定数据目录直接运行；会话数据库、历史、旧记忆和 V2 产物都在同一目录。配置与认证默认读取系统主目录，可用 `--config-dir` 指定。入口不创建数据副本。

```bash
# 查看候选和输入量估算，不调用生成模型
pnpm --filter @mavis/local-runtime-v2 memory:headless --data-dir /path/to/data --list-candidates --model minimax/MiniMax-M3
# 先迁移旧记忆，再跑两轮，每轮最多抽取两个会话
pnpm --filter @mavis/local-runtime-v2 memory:headless --data-dir /path/to/data --migrate-legacy --capture-limit 2 --rounds 2 --model minimax/MiniMax-M3
# 持续处理当前符合条件的积压
pnpm --filter @mavis/local-runtime-v2 memory:headless --data-dir /path/to/data --all --capture-limit 10 --model minimax/MiniMax-M3
# 单独整理 V2 已有文档
pnpm --filter @mavis/local-runtime-v2 memory:headless --data-dir /path/to/data --maintenance-only --model minimax/MiniMax-M3
```

| 当前证据 | 目标行为与决策归属 | 代码落点 | 验收观察 |
| --- | --- | --- | --- |
| 入口强制复制输入，并要求快照标记 | 入口使用必填 data-dir 原地读写，迁移显式开启；配置默认仍来自系统主目录 | `scripts/memory-headless.mjs` | 既有 DB 与历史直接参与流程，重复执行续用状态；迁移只修改目标目录的旧召回开关 |
| 只有一轮 kick/drain | 入口控制每轮领取量和轮数；all 在固定创建时间边界内运行到待抽取清空，单会话退避后继续其他候选，整理失败或无进展停止 | 同上与脚本运行辅助模块 | 每轮结果、前后候选、停止原因；退避未完成显式呈现 |
| 快速筛选、版本去重、排除和退避由生产服务拥有 | 候选检查共用来源、Capture 准备逻辑和 Reconciler 退避规则；检查不提交记忆状态、不调用生成模型 | `capture-service.ts`、`reconciler.ts`、`initialize.ts` | 候选列出 ready/unchanged/ineligible/deferred/backoff，执行复核当前状态 |
| Stage Two 选集同时受数量与输入预算约束 | 整理服务提供当前选集检查，共用预算裁剪；列出落选文档及原因 | `consolidation-service.ts` | 会话文档与 note 分列，候选进入本轮选集情况可核对 |
| 生产常规整理成功后冷却六小时 | headless 显式覆盖本进程 publicationCooldownMs=0，逐轮执行完整整理；其他生产资格、年龄窗、退避、配额和选集限制保留 | `scripts/memory-headless.mjs` | input.json 记录覆盖，原配置冷却值保留；模型错误不通过循环绕过退避 |
| 原日志已有 llm.response 和重复 llm.usage | 仅累计 llm.response 的 usage，按迁移/抽取/整理分组，失败调用有 usage 也计入 | 脚本统计模块、`turn-system/production-composition.ts` | 输入、输出、缓存读取/写入、总量、缺少 usage 的响应数；逐轮与累计报告 |

`--max-selected-sessions N` 覆盖整理选集总文档数，迁移产物也计入该上限；`--capture-limit N` 只限制本轮历史抽取数量。`--reasoning-effort low|medium|high` 同时覆盖迁移、抽取与整理的推理强度；省略时保留系统配置。`resolved-models.json` 记录实际解析的 provider、id、reasoning、thinkingLevel 与 requestedEffort，便于复核不同模型的真实配置。

每轮领取总量和并发数默认读取生产配置，默认最多抽取 6 个会话、并行 2 个，默认执行 1 轮。`--capture-limit` 与 `--capture-concurrency` 分别覆盖领取数与并发数；本批全部在途抽取结束后再尝试整理。`--rounds N` 与 `--all` 互斥。`--migrate-legacy` 在数据目录的引导记录登记选择迁移（已登记其他选择时报错），随后逐个迁移主 Agent 旧文件与用户资料副本，迁完的用户资料会被清空；`--maintenance-only` 只运行一轮已有记忆整理。`--list-candidates` 输出当前候选、状态、选集与固定 o200k_base 的历史输入估算；初始化数据库和生产历史兼容读取仍按正式流程执行。

“处理完”指固定边界内当前符合生产资格的会话已抽取，最终整理成功；单会话失败进入生产退避后继续其他可处理候选；只剩退避、耗尽、来源变化或出现无进展时留下未完成状态。Stage Two 继续保留 maxSelectedSessions 和输入预算限制，选集外文档通过 selection-limited 状态报告。每轮完整执行维护、抽取、整理和留存，all 也会重复读取已有正式记忆，因此轮数影响模型总消耗。

Stage Two 累计 Token 仅用于用量统计，不设总量停止条件。旧配置 `maxConsolidationAgentTokens` 已退役并忽略；默认轮次调整为 64，整轮超时调整为 1 小时。2026-09-10 双模型报告记录取消上限前的真实结果，MiniMax 的未发布状态保持原记录；本次修改未重跑真实模型。

运行前的估算只覆盖待抽取历史正文；提示词、输出、后续整理的多轮上下文和缓存命中由实际请求决定。报告独立汇总实际 usage，避免把输入估算当成最终账单。完整日志保留在目标目录 `memories/logs/`，每次运行的候选、逐轮记录、累计用量和产物链接保留在 `run-*/`。同一数据目录一次只运行一个入口，验收目录应独立于正在运行的 Desktop。

## 独立执行账本查询

同步 `preview_train` 后，Memory 迁移编号为 37–40，执行账本由 40 创建；查询与模型行为保持原合同。

旧记忆逐文件迁移（`migrate`）、Stage One capture 和 Stage Two rebuild 均保存数据库任务记录。每次模型调用另外保存实际模型、推理强度、输入/输出/缓存与总 Token；详细日志开关关闭时继续记账。领域结果与模型停止状态分开，migrated、published、deferred、空抽取及无模型跳过可逐项核对。查询不会启动模型任务，也不创建详细日志。

```bash
pnpm --filter @mavis/local-runtime-v2 memory:executions --data-dir /path/to/data
pnpm --filter @mavis/local-runtime-v2 memory:executions --data-dir /path/to/data --stage capture --source <sessionId>
pnpm --filter @mavis/local-runtime-v2 memory:executions --data-dir /path/to/data --task <taskId>
```

账本写入 `v2/sqlite/runtime-state.sqlite` 的 `local_runtime_v2_memory_execution_tasks` 与 `local_runtime_v2_memory_execution_calls`。命令只读打开已存在的库，无需模型配置或认证；旧 schema 明确提示先升级 Runtime。任务列表支持有界分页，详情给出逐次调用；总用量按 provider 返回的 totalTokens 相加，缓存明细单列。缺少响应或 usage 时显示不完整记录，不能据此断言消费为零。旧运行的详细日志保持原文件，新增账本不回填历史用量。

账本与并发的本地验收使用真实 SQLite 和生产装配，模型返回使用固定测试响应。已覆盖关闭详细日志后的三阶段记录、并行任务归属、失败用量、缺失 usage、升级保留数据及无配置只读查询。数据库结构检查允许额外记忆表，同时拒绝必需表缺失。该验证覆盖记录与调度机制，真实模型的内容质量沿用下方独立验收记录。

## 实施合同

来源日期由程序在整理完成后统一渲染：模型在来源行保留 `captured_at_ms: <Unix ms>`，完整来源 ID 放在第一个 `·` 前；程序按来源 ID 查本轮选集与 note 的原始时间戳，取最新值，用本机时区转换。INIT 与 INCREMENTAL 共用 `consolidation-service.ts` 的产物处理入口，转换后再检查预算、发布并保存基线。旧格式日期也按来源重算；没有可用时间戳的历史条目与无来源手写内容保持原文。验收覆盖跨日、多来源、note 增量及真实模型输出。

完整模块入口按生产 `readLegacySources` 原地枚举旧记忆输入。逐文件映射与协调器日志分别保留，模型配置沿用系统配置。

| 当前入口 | 验收行为 | 代码落点 | 观察结果 |
| --- | --- | --- | --- |
| `MemoryLegacyMigrationService.listPending/migrate` | 固定用户资料样本调用真实模型，登记迁移后逐文件迁移 | `memory-real-model.integration.test.ts` | 入库文档、资料副本与清空结果、测试目录中的旧版召回关闭记录 |
| `MemoryCaptureService.capture` | 固定会话经生产历史规范化后抽取，重复调用验证无变化 | 同上 | 会话文档、持久状态、`unchanged` |
| `MemoryConsolidationService.rebuild` | 先实际执行迁移和 Stage One，读取二者入库产物首次整理，再添加 note 做增量整理 | 同上 | 前后索引与摘要、note 基线、模型工具调用 |
| 生产配置与模型网关 | 共用生产配置加载器、解析器、模型调用和提示词文件 | `helpers/memory-real-model.ts` | 模型请求与响应、各操作状态 |

测试直接调用领域服务；候选筛选、配额调度与失败重试由既有协调器测试覆盖。推理强度和预算沿用系统配置；在测试内指定模型并启用记忆写入、召回、详细日志。Stage Two 使用可推进时钟跨过生产冷却时间。原始旧记忆和会话使用固定小样本；会话样本为真实用户输入与正常结束回答组成的完整 Turn，有效正文超过 100 token，并由默认运行的准入测试验证；Stage Two 的输入完全来自本轮真实模型执行迁移和 Stage One 后的入库产物，不再预置会话记忆文档。用户历史语料的内容质量可另行验收。

## 运行

仓库根目录执行：

```bash
pnpm --filter @mavis/local-runtime-v2 test:memory:real
# 单独执行一个流程
pnpm --filter @mavis/local-runtime-v2 test:memory:real -- -t migration
pnpm --filter @mavis/local-runtime-v2 test:memory:real -- -t stage-one
pnpm --filter @mavis/local-runtime-v2 test:memory:real -- -t stage-two
```

专用配置显式启用真实模型；普通单元与集成测试会跳过这三个用例。命令会调用 MiniMax-M3 并消耗额度，登录和模型配置失败会直接报错。

每个用例在系统临时目录下创建独立的 `memory-real-<case>-*` 目录，控制台打印绝对路径。成功和失败都保留目录，包含样本输入、`result.json`、SQLite 数据库、`memories/` 产物和 `memories/logs/` 详细日志；Stage Two 额外保留迁移预览、`stage-two-input.json`（实际选集及来源）、首次整理快照。系统配置和现有记忆无需复制；迁移的配置写入仅发生在测试目录，OAuth 刷新沿用生产凭据机制。

验收检查服务返回值、入库内容、摘要和增量基线；产物语义由模型生成，需阅读保留文件判断质量。日志记录请求正文与模型输出，并使用生产日志脱敏；不保存模型密钥或整份系统配置。

迁移提示词要求模型调用一次提交工具 `submit_migrated_memory`，唯一参数 `document` 为带规定二级小节的 Markdown 文档，并保留用户手写内容的归类和引用规则；网关按工具参数 schema 校验，不再解析响应文本中的 JSON。

Stage Two 的 INIT 与 INCREMENTAL 统一运行内部文件编辑 Agent。两种模式的首条简报只传数量、路径与预算，材料通过 list_files/read_file 按窗口读取，write_file 交付两份产物。最终回复正文无格式要求；失败统一 deferred，丢弃工作副本并保留正式产物、完成标记与基线。

整理提示词要求模型逐字保留 captured_at_ms，日期统一由程序根据来源记录换算。模型网关动态注入本机 IANA 时区名称并纳入合同指纹，提示词资产不写死具体时区。每条约定按自身内容判断范围，工作目录与项目标题只提供来源上下文。真实串联用例同时检查本机日期和全局中文文档约定。

Stage One 每个会话调用一次模型，工具列表只有 `submit_memory_extraction`。该工具同时提交 `rollout_summary`、`rollout_slug` 与 `raw_memory`；普通回复正文不承担交付。生产完成层只接收完整、唯一且名称匹配的工具调用，网关严格检查字段类型、必填项、额外字段与空结果语义，随后脱敏并组装为一份文档。三项共同入库、镜像并进入 Stage Two 选集。原始记忆继续遵循既有小节规则，整份文档共用字节上限。抽取合同版本提升为 3，Stage Two 的文件整理合同同为 3，旧迁移保留版本 2。

2026-09-10 的独立 Stage One 小样本已使用真实 MiniMax-M3 验证：一次提交工具调用，三字段保留，同一 revision 再调用返回 unchanged。请求、响应、工具参数、状态提交和镜像日志保存在控制台所示目录下的 `memeory/`（当时的日志目录名，现为 `memories/logs/`）；报告输入 1,759、输出 1,100、缓存读取 146，共 3,005 token。本次只执行 Stage One；Stage Two 统一 Agent 已另行实施，验收结果另行记录。样本覆盖接口与保存链路，抽取语义仍需人工判断：本次原始记忆末条把中文文档约定随其他约定归为项目级，范围归类需要后续内容验收。

## 单次模型调用的取消合同

真实整理在持续返回思考内容时被两层 120 秒计时器中止。单次抽取与旧迁移取消固定墙钟上限；Stage Two 每轮模型调用共享整理 Agent 的整体取消信号；ModelGateway 直接传递调用方 signal，继续响应调用方中止，不再自行创建超时计时器。对应代码为 `capture-service.ts`、`legacy-migration-service.ts`、`consolidation-service.ts` 与 `adapters/model-gateway.ts`。输出 token、文档大小与内容校验继续生效；内部整理 agent 当前使用默认 64 轮与 1 小时整轮上限，工具结果预算保留，累计 token 仅统计。

验收覆盖模型调用持续超过 120 秒后仍可成功返回，以及主动取消继续向模型透传。真实验证在原备份目录执行 maintenance-only，以已入库的同一批文档重试 Stage Two，保留持续时间、响应和产物状态。


## Stage Two 统一文件整理验收

首次执行 maintenance-only 时，产物或基线缺失、完成标记缺失、整理合同升级均进入 INIT；完整当前选集和规则物化到工作目录。成功后再次运行无变化应返回 unchanged。通过正常抽取新增文档或通过记忆工具新增 note 后，下轮进入 INCREMENTAL；旧 note 正文不会每轮自动拼入简报。

详细日志中的 `model.consolidateInPlace` 请求给出 mode 和变化数量；`llm.request` 记录每轮工具列表和完整上下文，`tool.request` / `tool.response` 记录路径、窗口、写入正文和结果；工作目录读取、产物发布与基线提交保留端到端状态。全部 `llm.response` 的输入、输出与缓存用量汇入本轮 Stage Two 统计；失败调用也计入已报告用量。若取消前上游未报告完整 usage，报告值会少计。

验收区分真实历史文档与固定样本：备份目录的 maintenance-only 使用已有真实迁移、历史抽取产物；`test:memory:real -- -t stage-two` 使用固定旧记忆及完整会话样本，经真实模型抽取再串联首次与 note 增量整理。内容验收核对全局中文约定、项目约定、未完成与讨论状态，不能用文件校验通过代替语义判断。当前默认 64 轮与 1 小时整轮上限，累计 token 仅统计，日志用于评估实际容量。


排查 Stage Two 提示词或整理行为时，可复用此前真实模型的 `stage-two-input.json`：

```bash
MAVIS_MEMORY_REAL_STAGE_TWO_INPUT=/path/to/previous/stage-two-input.json pnpm --filter @mavis/local-runtime-v2 test:memory:real -- -t stage-two
```

该测试将已保存的两份实际入库文档通过 Repository 条件提交恢复到新隔离目录，保留正文与来源元数据；本轮跳过迁移和 Stage One 模型调用。`reused-input.json` 记录原始路径，`stage-two-input.json` 记录本轮选集。首次、note 增量与 unchanged 全部执行后，`quality.json` 分别记录全局语言范围、摘要中每个搜索键的索引精确匹配、项目标题与来源 project 的一致性，最后严格断言。语义失败会使测试及 result.json 失败，同时保留完整生命周期证据。


### 2026-09-10 Stage Two 实测结论

功能链路已完成首次文件编辑、note 增量、基线提交和 unchanged 验证，内容验收仍失败。真实调用均使用当前系统配置与 MiniMax-M3；未运行全部历史抽取。

- 真实备份 `run-YpLH3P`：6 份已有文档、0 note，INIT 通过文件工具生成产物，14 轮、219,542 token（输入 45,461，输出 32,463，缓存读取 141,618）。
- 固定样本串联曾通过旧范围断言，根会话独立核对发现项目名由标题误造、摘要搜索键自行拼接。随后提示词限定可信 project/workspace 命名和连续原文搜索键；通用范围规则只要求输入支持的事实。
- 固定输入复用 `memory-real-stage-two-9ZIPFQ`：复用 `wyPdCV/stage-two-input.json` 两份文档，跳过上游模型。首次与 note 增量共 15 轮、83,401 token（输入 8,332，输出 12,017，缓存读取 63,052）。项目名与搜索键检查通过，原会话中文约定仍被缩窄为项目级。该运行框架显示 passed，旧断言仅看全局是否有任意中文条目；`review.json` 记录按 `memory-real-session` 来源复核后的首次/增量范围失败。测试已加强来源检查，保留该失败事实。
- 真实备份最新重跑 `run-tnFlvv`：仍为 6 份文档，INIT 共 7 轮、75,089 token（输入 13,721，输出 6,918，缓存读取 54,450），仅执行读取和列目录，模型选择保留旧产物。两份文件前后 SHA-256 完全相同，发布推进了新合同基线；17 个完整搜索键仍有 5 个不在索引中。所有标注来源均有效，但内容未被纠正，不能据 published 认定重建或内容验收通过。
- 该重跑还定位到程序误报：INIT 的全量 added 清单曾用空基线连带判定“用户权威修改”，误导模型保留原产物。已把全量材料清单与真实基线产物差异分开，缺失基线不宣称手改，并为整理提升 canonicalInputVersion=6；抽取与迁移保持 5。该最后修复通过聚焦测试，随后在下述双模型完整流程中验证 INIT 的 artifactsModified=false。

最新普通验证为 169 项相关聚焦测试；提示词登记、类型检查与依赖边界检查另行执行。验收日志与报告路径以运行输出为准，备份前后合同、工具调用、最终回复和文件指纹对照保存在 `/tmp/memory-stage-two-backup-before.json` 与 `/tmp/memory-stage-two-backup-after.json`。模型范围判断、搜索键遵循以及新合同下是否主动编辑仍属于后续内容验收问题；本次没有机械改写模型产物或增加新校验工具。


### 同源副本双模型完整流程对照

2026-09-10 从当前系统数据目录完整克隆两份，并为三份 SQLite 库制作一致性快照。四张 V2 记忆表原本为空，无需重置。共同代码 `18528fb293`，配置与认证分别读取各自副本；A 使用 `minimax/MiniMax-M3`、medium、reasoning=true，B 使用 `custom_provider:deepseek/deepseek-v4-flash`、low、reasoning=true。

两组均运行 `--migrate-legacy --agent mavis --capture-limit 10 --max-selected-sessions 10 --rounds 1`。16份旧迁移输入完全相同；10个实际 Stage One 请求的 canonicalPayloadJson 哈希逐条相同。迁移均得到2份非空文档，另14份daily共609条状态流水返回空。历史均实际抽取10个会话，9份非空、1份合法空；整理选集为9份历史文档与1份迁移文档，user.md迁移文档因总上限10落选，仍保存在DB与镜像。

| 验收项 | MiniMax-M3 medium | DeepSeek Flash low |
| --- | --- | --- |
| 正确完整流程累计 Token | 890,863 | 754,828 |
| 迁移 / 抽取 / 整理 Token | 53,387 / 435,449 / 402,027 | 50,351 / 443,225 / 261,252 |
| Stage Two 轮次 / 耗时 | 19 / 228.274秒 | 10 / 114.741秒 |
| INIT 手改标记 | false | false |
| 整理结果 | 超过400,000 Token，deferred，未发布 | published |
| 搜索键 | 未发布草稿25项全部匹配 | 正式摘要24项全部匹配 |

A写出索引、重写索引、写出摘要后，在下一轮请求回读时触发累计Token预算；程序丢弃副本，正式产物及完成基线保持空。由工具日志恢复的草稿仅用于内容审阅，未经过发布前日期转换。B通过文件工具发布两份产物，headless的round-limit表示按指定一轮停止，仍有58个待抽取历史会话。

两组仍有内容外推：视频会话仅要求查看下载目录并合并两段视频，抽取却将单次命名和assistant执行方式提升为惯例或用户偏好。B进一步将做完后询问换顺序写入全局偏好，将最多8个子agent扩大为默认用满。A草稿保留最多8个上限，过滤该视频交互偏好，仍把本次编码参数写为统一规格，并收录本会话未发生的编码不一致故障。单轮模型与推理配置对照支持上述观察，语义质量尚未通过。

完整对照为 `/tmp/memory-ab-report.md`、`/tmp/memory-ab-comparison.json`；实际请求哈希为 `/tmp/memory-ab-input-hashes.json`。A运行 `run-uW0cJx`，B运行 `run-QOLxch`，位于各自控制台打印的完整副本目录；A未发布草稿恢复在 `/tmp/memory-ab-a-unpublished/`。此前main来源误启动后中止的已报告65,818 Token独立记账，另有2个在途请求缺最终usage，不计入上述正确流程用量。运行期间保持同一提示词与预算，没有追加模型重跑。

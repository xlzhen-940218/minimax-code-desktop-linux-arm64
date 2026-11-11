# Local Runtime V2 Session Title 测试场景契约

状态：2026-09-23 更新标题来源与 SideChat / Goal 共用命名规则；provider 场景保留原测试记录。

## 用户故事与固定边界

作为 Local Runtime V2 用户，我希望新建的普通 branch Session 在首个 user message durable
accepted 后，异步得到一个安全、简短的标题；标题生成的任何失败都不得改变当前或下一 Turn。

- `CreateSession` 不调用标题模型；普通 branch Session 未显式传 title 时保持 `null` 并写
  `titleSource: default`；用户显式命名为 `manual`，已有系统标题为 `auto`。
- 普通输入、Goal 的可见 objective 和 Queue 输入共用审核通过后的命名入口。仅 `titleSource: default`
  允许自动命名；不再通过标题文字或包含继承正文的 User Message 数量猜测。SideChat 的 query
  placeholder / create-only 占位名均为 `default`，继承正文和隐藏续跑不触发命名。
- AgentHost input review 放行后，composition 通过 `sessionId + turnId` 读取已 durable
  commit 的首条 display User Message，再把文本交给窄 title capability；调用返回
  `void`，读取/生成异常被隔离，异步工作不被 `await`。review 仍检查 canonical execution
  input，内部 prompt 不作为 title source。
- `submit_session_title({ title })` 只是独立 title LLM request 的唯一 structured response
  schema；它不注册到 AgentHost、Agent tool registry 或 agent loop，也不会执行 tool handler。
- response request 不传伪通用的 `toolChoice`；Pi provider 只接收唯一 title tool
  schema 与强 instruction。provider/model 未返回 tool call 时仍由 strict parser 拒绝。
- 正常标题只接受恰好一个名为 `submit_session_title` 的 tool call。raw
  text、XML、无 call、错名或多个 call 均判为无效输出；重试耗尽后复用清洗后用户输入的 fallback。
- TypeBox schema 使用 `additionalProperties: false`；Pi `validateToolArguments`
  通过后再 trim，并执行非空与 50 字符上限校验，超长不截断。
- 复用现有 invalid-output / provider retry 预算、10 秒 timeout、1,000 字符 input limit、injected-tag
  sanitization、per-Session pending 去重与 manual-rename freshness fence。
- 持久化继续走 `SessionRecordService.mutateSession`，复用已有 `titlePolicy.blocks` content-safety
  gate。`content-policy-rejected` 记为
  `blocked`；write 错误隔离，model/parser 重试耗尽后使用既有 fallback。
- 可观测性只提供最小 best-effort outcome
  hook：`success | invalid_output | provider_error | blocked | skipped_race`。不增加
  `mode`，不把 title、sessionId 或用户文本放进 metric label；production
  metrics 注入留给下一个 composition MR。
- 独立 title prompt 只携带当前已清洗的 user
  message；不查询或注入同 Project 的历史 title，也不做跨 Session
  title 去重。不同 Session 允许使用相同标题。
- `extra_data_json.titleSource` 持久化
  `default | auto | manual`，不新增 SQL 列或 migration。自动标题与 `auto`
  同事务提交，校验原文字及来源仍为 `default`。用户手动修改即便文字相同也写
  `manual`，不被迟到结果覆盖。旧记录缺失来源时保守保留，不猜测或回填。
- 升级保留来源；fork 的推荐标题为 `auto`、用户指定标题为 `manual`，复制的历史不重开命名资格。
- 不增加 durable job/outbox。input review 放行后、进程内通知前崩溃时允许缺失标题；duplicate Turn
  repair 和重复提交不得产生第二个 writer。
- title capability 不改 HTTP contract、allowlist、V1 title path 或 canonical history；production
  Message commit 负责独立发布 Session SSE；AgentHost input review 放行后才 best-effort 通知 title
  generation，二者都不参与彼此的交付成败。

## 共同起始条件

- 用户角色：通过 direct send 或 Queue 向普通 branch Session 发送消息的 Local Runtime 用户。
- 自动化角色：SessionSystem、TurnSystem、独立 Pi title completion、真实 SQLite
  repository 与可控/真实 LLM provider。
- 除 E2E-03/04 外，LLM 使用 faux
  provider；integration 使用真实临时 SQLite、真实 repository/lifecycle，外部 provider 与 clock 可控。
- 每个场景都同时断言没有未处理 rejection，且 title failure 不从 detached task 逃逸到 Turn。

## Unit 场景

| ID      | 测试目标与步骤                                                                                            | 预期结果                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| UNIT-01 | 独立 completion 返回一个 `submit_session_title` call，arguments 为 `{ title: "Fix login bug" }`。         | 返回 trim 后标题；request 只携带这一项 response tool schema，未创建或执行 Agent tool。               |
| UNIT-02 | arguments 缺少 `title`。                                                                                  | `validateToolArguments` 拒绝；本次输出为 `invalid_output`，不写库。                                  |
| UNIT-03 | `title` 为 `""` 或仅空白。                                                                                | schema 后领域校验拒绝；不写库。                                                                      |
| UNIT-04 | arguments 含额外字段。                                                                                    | `additionalProperties: false` 生效；不写库。                                                         |
| UNIT-05 | 分别返回 50 与 51 个普通字符的标题。                                                                      | 50 个字符被接受；51 个字符被拒绝且不截断。                                                           |
| UNIT-06 | 返回一个错误 tool name。                                                                                  | 即使 arguments 合法也拒绝；不调用未知 tool。                                                         |
| UNIT-07 | 返回两个或更多 tool calls，包括两个合法 call。                                                            | 整个 response 被拒绝，不选择其中任意一个。                                                           |
| UNIT-08 | 分别返回无 tool call、普通 raw text、完整 `<session-title>` XML。                                         | 三者都为 `invalid_output`；没有 text/XML fallback。                                                  |
| UNIT-09 | 合法 tool call 同时伴随非空 assistant text。                                                              | fail closed，避免模型在结构化 response 外夹带候选标题。                                              |
| UNIT-10 | model provider 连续抛错。                                                                                 | 按现有预算调用两次；最终记录一次 `provider_error` 并跳过标题。                                       |
| UNIT-11 | 第一次输出非法，第二次输出合法 tool call。                                                                | 使用第二次候选写入一次；不会并行发起重试。                                                           |
| UNIT-12 | user text 包含已知 injected wrapper 与 wrapper 内指令。                                                   | wrapper 内容不进入 title system/user prompt；其余文本保留并受 500 字符上限约束。                     |
| UNIT-13 | 同一 Session 在首个 generation pending 时重复通知。                                                       | 只存在一个 model operation 和一个 writer；pending 完成后清理。                                       |
| UNIT-14 | Session 已有稳定标题、标题为可生成 placeholder、Session 为 root、Session 不存在。                 | 只有 titleSource 为 default 的非 Task branch 可生成；manual、auto 与缺失来源均跳过。     |
| UNIT-15 | model 运行期间发生 manual rename。                                                                        | freshness re-read 发现 title 改变，记录 `skipped_race`，不覆盖 manual title。                        |
| UNIT-16 | existing lifecycle mutation 的 `titlePolicy.blocks` 拒绝候选。                                            | mutation 抛出的 `content-policy-rejected` 被吞掉并记为 `blocked`；Session title 不变。               |
| UNIT-17 | session read、model、outcome hook 或 DB mutation 分别抛错。                                               | 错误被隔离；outcome hook 自身抛错也不外泄；敏感值不作为 outcome 字段。                               |
| UNIT-18 | archive-root title 继续使用共享 completion 的文本返回能力。                                               | archive title 既有协议不回归；正常 first-message title 不恢复 XML parser。                           |
| UNIT-19 | 同 Project 其他 Session 已有与 model candidate 相同的标题。                                               | 不查询历史 title，不向 prompt 注入 reference data；合法 candidate 直接写入且不额外重试。             |

## Integration 场景

| ID     | 测试目标与步骤                                                                                 | 预期结果                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| INT-01 | 创建无 title 的普通 branch Session，提交 direct user message；让 input review approved。       | Turn/Message 先 durable accepted；review callback 随后异步触发一次 title generation，CreateSession 与 admission 阶段为零次。 |
| INT-02 | 用 Queue dispatch 提交另一个 Session 的可见 user message，并让 input review degraded-pass。    | 与 INT-01 使用同一 AgentHost callback 路径并触发一次；production code 没有 direct/Queue title 特判。                         |
| INT-03 | 先让首条可见 message 的 input review rejected，再提交第二条 safe message。                     | rejected query 不进入 title model；Session 保持无 title，第二条 approved message 仍可触发 title generation。                 |
| INT-04 | 先执行 hidden continuation，再接受可见 user message。                                          | hidden Turn 不发起 input review、不触发 title；可见 message review 放行后触发一次。                                          |
| INT-05 | title model promise 保持 pending，同时让 AgentHost Turn 完成。                                 | Turn terminal、exact settle、lease release 与 stream completion 均先完成；title 不延长 Turn。                                |
| INT-06 | 让 title model、解析、content safety、Session read/write 分别失败，然后 admission 下一 Turn。  | 原 Turn outcome 不变、lease 已释放，下一 Turn 可正常 admission；没有 title write。                                           |
| INT-07 | 捕获 AgentHost submission、canonical history projection 与 Pi JSONL，在 title 成功后比较前后。 | 三处都不包含 title prompt、`submit_session_title` call 或生成标题；正常 Agent messages/context 不变。                        |
| INT-08 | 对同一 stable Turn / review callback 执行 duplicate request 与进程内 retry。                   | pending/freshness fence 保证同一 Session 最多一个 title writer。                                                             |
| INT-09 | 模拟 Turn 已 accepted、Message 尚未提交时收到 duplicate request。                              | duplicate repair 复用稳定 Message identity，只提交一条 Message；仅实际 Host review 放行后通知 title。                        |
| INT-10 | 在 title LLM 执行期间通过真实 lifecycle manual rename。                                        | 最终 DB 保存 manual title；自动 title 不产生 `title-updated` fact。                                                          |
| INT-11 | 使用真实 lifecycle/titlePolicy 阻止候选。                                                      | safety 在 DB update 前执行，DB 无自动 title，Turn 已独立完成。                                                               |
| INT-12 | model 返回合法 title，但 repository update 失败。                                              | writer 失败被记录并结束；Turn outcome/lease/下一 Turn admission 不变。                                                       |
| INT-13 | 创建 root、rotation、internal Session 及普通无 title branch Session。                          | 既有显式 title 保持原语义；普通 branch 初始 title 为 `null`，不在 create 时调用 LLM。                                        |
| INT-14 | 记录 outcome hook 的所有调用。                                                                 | 只出现允许的低基数 outcome；payload 不含 title、sessionId、user text，也没有恒定 `mode=tool` label。                         |
| INT-15 | 在真实 SQLite 中为同一 Project 的其他 Session 写入相同 title，再触发 generation。              | Session repository 不暴露 title-context query；独立 prompt 只含当前消息，合法同名 candidate 正常写入。                       |
| INT-16 | hidden execution prompt 携带不同的非空 `displayContent`，input review approved。               | review 检查 canonical execution prompt；title generation 只读取 committed display text，空 display/attachment 不解除 hidden。 |

### Review closure evidence

- **INT-07 — PASS**：`turn-execution.service.test.ts` 捕获并验证 AgentHost request 不含 title
  prompt、`submit_session_title` 或候选；`session-title-generation.e2e.integration.test.ts`
  在独立 title Pi call 前后验证 canonical JSONL 与 display
  projection 完全不变；`production-composition.test.ts` 验证 production 使用独立 title
  model，未把 title schema 注入 AgentHost owner。
- **INT-09 — PASS**：`user-message-commit.integration.test.ts` 使用真实 SQLite，重复执行同一 stable
  Message identity；只生成一条 display Message，并最多通知一次 title capability。

## LLM E2E 场景

| ID     | Provider                            | 步骤                                                                          | 预期结果                                                                                | Status / Evidence                                                                            |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| E2E-01 | faux managed                        | 运行完整 resolver → Pi stream → tool-call validation → lifecycle write 链路。 | request 带唯一 title response tool schema，合法 call 写入一次安全标题。                 | PASS：`pnpm --filter @mavis/local-runtime-v2 test:e2e:session-title-faux`                    |
| E2E-02 | faux invalid                        | 依次返回 raw text、XML、错名、多 call 或非法 arguments。                      | 每种输出在重试预算后都不成为 Session title。                                            | PASS：同 E2E-01，6 个 faux 场景全部通过                                                      |
| E2E-03 | 真实 managed provider               | 使用仓库规定的真实 E2E credential/env 运行独立 title completion。             | provider 实际返回合法 `submit_session_title` call，Session title 成功持久化。           | FAIL：当前 managed test route 对 M2.7/M3 均连续返回 provider error；不计 PASS，MR 保持 draft |
| E2E-04 | 真实 BYOK / tool-calling 不可用模型 | 使用真实 BYOK 路由请求同一 schema。                                           | provider error 或非 tool response 被严格拒绝；重试后无 title，不回退到 XML/raw text。   | PASS：真实 API-key 路由两次 fail closed，无 title write                                      |
| E2E-05 | 本机缺少真实凭据或 provider 环境    | 分别执行两个 real selector 的 E2E preflight。                                 | 完整报告缺少的 env/credential，两个命令均以 1 退出；real E2E 不标 PASS，MR 保持 draft。 | PASS（preflight only）：本机已验证两个 `[NOT RUN]` 分支                                      |

## RED → GREEN 与验证证据

1. 第一笔代码 commit 只加入/更新上述自动化测试并保留预期失败，commit
   message/trailer 记录 RED 命令和失败原因。
2. 第二笔及后续 commit 才实现最小代码，使同一组测试 GREEN；不新增第三方 dependency、migration、job/outbox 或通用 structured-output
   abstraction。
3. 受影响验证至少包括 title unit、Message commit/repository unit、Turn
   unit、上述 integration、`typecheck`、`lint`、`test:architecture`、`check:dead-code` 与新增 title
   E2E。
4. 真实 E2E 证据必须对应 MR 最新 commit；凭据缺失时按 E2E-05 保持 draft，不能用 faux
   provider 冒充真实 PASS。

## 真实 LLM selector 与 env

- managed：`test:e2e:session-title-real-managed`；需要
  `MAVIS_E2E_LLM_BASE_URL`、`MAVIS_E2E_LLM_MODEL=provider/model`（或 `MAVIS_E2E_LLM_PROVIDER_ID` +
  `MAVIS_E2E_LLM_MODEL_ID`）及 `MAVIS_E2E_AUTH_ACCESS_TOKEN`。该 selector 不读取
  `MAVIS_E2E_LLM_API_KEY` 作为成功凭据。
- BYOK unsupported：`test:e2e:session-title-real-byok-unsupported`；使用同一 model/base
  selector，并需要 `MAVIS_E2E_LLM_API_KEY`。环境必须选择真实不支持 tool
  calling 的 model；若实际产生 title，runner 反而失败，避免把支持 structured
  output 的 BYOK 模型误算成 unsupported coverage。
- `MAVIS_E2E_LLM_API` 可显式选择 Pi API，默认 `anthropic-messages`。任一 required
  env 缺失时 runner 输出 `[NOT RUN]`、列全缺失变量并以 1 退出。

# Prompt V2 组织与热更新

主 Agent 按模式选择一个完整模板：

```text
assets/agents/_v2/
├── coding/SYSTEM.md.hbs
├── work/SYSTEM.md.hbs
├── tui/SYSTEM.md.hbs
├── explore.md.hbs
├── worker.md.hbs
├── verifier.md.hbs
└── AGENT_CONTEXT.md.hbs
```

每种模式在自身文件中维护身份、规则、Memory 条件段和交付格式。身份遵循 Persona 能力开关；Memory 写入指导遵循当前 Memory 开关。子 Agent 保留各自的完整角色文件，公共约定由
`AGENT_CONTEXT.md.hbs`
按 base、worker、root、branch 场景渲染。普通主会话的 root 约定已经包含在模式文件中，不再额外注入。

工具定义、Skills 目录、项目指令、实际 Memory 内容、运行环境和其他动态上下文仍归原有模块。模式选择只改变 Prompt，工具可用性和权限仍由当前运行环境决定。可恢复删除、后台任务和平台相关 Shell 规则由 Bash 工具描述提供。

## 内置子 Agent 的过程文本

`explore`、`worker`、`verifier` 共用 worker 层的沟通要求，不依赖 `surface.interactive`、
`features.mavis` 或 Desktop / TUI profile。首次实质工具调用和新的重要阶段开始前，必须输出
简短、非空的普通 assistant 正文；thinking、工具参数和工具结果不算 preamble。同一阶段的相关
工具调用共用说明，重要发现、方案转向和阻塞再补充进展，避免逐条播报。工具已经打印的关键
发现与检查结果也要在普通正文中概括，不能假设调用方能看到或重建工具输出。

子任务的过程文本保留在自身会话中，最终结果仍交给父 Agent；该要求不赋予直接联系用户或其他
Agent 的权限。最终回复须独立包含结果、证据、实际验证和剩余限制；除任务明确要求报告文件外，
研究和审查结果直接以正文交付。Explore 的只读边界、Worker 的文件归属、Verifier 的独立核验
和 `ROLE_MISMATCH` 规则保持。禁止额外汇报文件不等于禁止必要的工具输入文件或明确要求的交付文件，
但仍受角色权限限制：Explore 不得写文件；Verifier 的验证产物只能放在明确指定的临时位置。

角色选择描述与角色正文同时明确分工：Explore 负责定位代码与收集证据；代码审查、审计和验收
交给 Verifier。误派给 Explore 的审查任务通过 `ROLE_MISMATCH` 返回，不把局部检索当成完整审查。
内置描述来自 `explore/PERSONA.md` 与 `verifier/PERSONA.md` 的 frontmatter，写入 canonical
Agent 配置；中文 Persona 同步维护。父 Agent 的 task 工具角色目录另由
`packages/shared/src/subagent-roles.ts` 生成，须与 Persona 和角色正文同步。参考 Claude Code 2.1.278 的角色分工、正文复述工具结果及
工具输入文件例外，保留本项目的强制 preamble；不引入其专用状态前缀或模型参数。

V2 的公共要求维护在 `AGENT_CONTEXT.md.hbs` 的 worker 层；兼容路径同步维护
`_default/prompt-base-worker.md.hbs` 和静态 reader 使用的
`.md`。角色差异分别保留在 V2 与对应的旧版角色模板中。Catalog 测试覆盖最终装配的角色、profile、surface 和能力条件；静态 reader 测试覆盖
`.md`
路径。这些检查只能证明指令进入最终 Prompt，不能证明模型一定遵从。真实模型和 UI 验收需新建三个角色的子任务，检查首个工具前正文、阶段更新、最终交付和历史恢复；已有 Task 的冻结模板不因随包资产或 canonical Builtin `agent.md` 后续编辑而自动更新。普通 profile
capture 才重新读取该文件；Task 创建时保存的 definition 和 `promptSnapshot` 在后续 frozen profile
capture 中保持有效，公共层仍按当前运行时组合。

## 入口与快照

TUI 使用本地 V2。`mcode exec --prompt-mode tui|coding|work` 可以选择三种模式，默认 `tui`。每次
`exec`
固定整套随包 Prompt 字节，包括后续才选中的模式与 Workflow；当前能力开关仍在渲染时生效。所选模板缺失或语法错误会失败，不借用其他模式或 V1 模板。

溯源关闭时，TUI 的三种模式在模板渲染及 Task 快照恢复后统一移除受控溯源协议，保留普通来源链接和
`file_path:line_number` 引用。

Task 创建时在既有定义中保存可选 `promptSnapshot`：模式、模板、当前渲染结果及可用的包版本。创建时 canonical
Builtin 的 runtime profile view 用当时的 `agent.md` 正文生成模板和渲染结果；`version`
表示运行包版本，不是文件内容版本。恢复时保留保存的 Task definition、owner、模型和 capability
ceiling，并按当前能力组合公共层，不重新读取 `agent.md`。历史 Task 没有 `promptSnapshot` 时同样使用保存的
`systemPrompt`；自定义 Agent 也保留自身定义。模式与已保存快照不匹配时要求新建 Session。

现有 LLM 调用快照增加模式、版本、模板和渲染内容摘要，最终 Prompt 仍在调用边界记录。评测使用新会话，固定模型、工具、权限、数据集与开关后比较模式；单元测试不代表模型效果评估。

## 启动级 System Prompt 覆盖

TUI 交互、`exec`、`exec review` 与 `acp` 接受 `--system-prompt[-file]` 和
`--append-system-prompt[-file]`。写在子命令前面同样生效，例如
`mcode --system-prompt-file ./identity.md acp`；替换和追加分别取离子命令最近的一处（内联与文件算同一项），不接受这些参数的子命令直接报错。宿主在启动时读取一次，作为 `systemPromptOverrides` 只保存在进程内存，
不写入 Session、Task 快照、配置或 dataDir；进程重启（登录切区、前缀更新）通过同一组参数重新传入。

- replace 替换整段身份层：persona、`agent.md` 当前模式正文与 basePrompt。运行时规则（Harness、语言、
  Preamble）仍由 `addRuntimeRules` 按标题插入；用户文本没有对应标题时追加为独立段落。
- append 原样放在身份层之后、项目指令导言之前。
- Global/Project 指令、Environment、Memory 与 Skills 目录保持不变，range 偏移随最终文本重新计算。
- 覆盖作用于除隐藏 `task-child` 以外的主 Agent 表面（root、fork、`/btw`、exec、ACP）；Task 子 Agent
  继续使用冻结定义。压缩摘要器、标题生成等独立调用不受影响。
- 没有有效覆盖（未传或只含空白）时，最终 Prompt 与未接入前逐字节一致。

## Desktop 本地 Prompt 与历史版本兼容

新版 Desktop 按 Session `appMode` 选择 canonical Builtin `agent.md` 中的 V2 Coding /
Work 条件段；三个内置子 Agent 也从各自文件正文渲染，公共上下文仍使用随包 V2。6 个文件继续登记在
`managed-prompts.json.desktop_agent`，与 44 个 V1 文件一起保留在受控清单中。随包 V2 资产为 canonical
Builtin `agent.md`
提供出厂内容，并提供公共层；Mavis 的单一文件模板包含 Coding、Work、TUI 条件段。

运行时以本地 canonical Builtin `agent.md` 为准，运行中的编辑从下一轮渲染生效。每次启动把有效文件重载为当前版本的出厂内容：正文换成原始 V2 模板，名称、描述、显示名、工具、skills 和 capability policy
按受管定义重写，只保留模型配置（`model`、`effort`、`x-mavis.contextWindow`、`x-mavis.maxOutputTokens`），因为界面上内置 Agent 只允许改模型。重载直接覆盖、不归档，生成内容与现有字节相同时不写，按读到的 revision 做 CAS。缺失文件按出厂模板生成；损坏文件先归档原始字节再按出厂模板重写，归档前在锁内按同样的完整校验复查，期间已被修好或删除的文件保持原样；运行中文件被删除时，下一次使用先按出厂模板补回。

当前 hotfix 在运行时装配入口强制关闭远端 Prompt 能力，包括配置显式设置
`promptConfig.autoUpdate: true`
的 profile。不初始化远端服务、不启动拉取、不选择历史下发缓存或缓存中的 builtin 副本；随包资产只用于 Builtin 出厂内容和公共层。已有缓存文件保留；普通 profile 或新建 Task capture 时 canonical
Builtin 文件缺失会先补回，补回失败或文件非法会 fail closed，不会回退到内存中的 bundled 正文或旧 Task 快照；已有 frozen Task 继续使用保存的 definition。

本次只改变安装该 hotfix 的客户端，不修改服务端或 Apollo；历史客户端继续沿用原来的远端配置。发布新客户端无需为 V2 模板更新旧版共用的 Apollo Stable。后续恢复热更新前，必须先完成新旧客户端的兼容隔离，再按
[Prompt 路径生命周期](../../../.agents/skills/prompt-release-prep/references/prompt-path-lifecycle.md)
准备发布。

TUI 与 `mcode exec --prompt-mode tui|coding|work` 继续读取本地 V2 文件，`exec` 仍固定整套随包资产；`_v2/tui/SYSTEM.md.hbs` 保持豁免。

维护 Prompt 资产后运行 `pnpm check:prompt-asset-registry`。当前 hotfix 验证重点是显式开启配置仍不拉取或绑定缓存、Desktop 随包模板渲染及本地快照保留；确定性测试不代表模型行为效果评估。

## PTC 段落与旧客户端兼容

PTC 真正生效的轮次（会话 `toolCallMode` 为 `ptc`，判断见 `@mavis/config` 的 `isPtcTurnEnabled`，与工具目录共用；子 Agent、Explore、Peek 等各层都按会话模式渲染），运行时渲染本地文件 `_v2/PTC_TOOL_CALLS.md.hbs`，经渲染上下文的 `ptc.section` 插到三份主模板和 `AGENT_CONTEXT.md.hbs` base 层的 `# Harness` 之前，并把 `# Harness` 里推荐直调 `grep`、`read`、`bash` 和“并行发多个工具调用”的几句换成指向这一节的说明。该文件登记在 `prompt-exemptions.json`，只读随包资产，不进 `desktop_agent` 远端下发。

在线提示词由所有客户端版本共用，新模板发布后，未升级的客户端也会用它渲染；老客户端的上下文没有 `ptc` 字段，Handlebars strict 模式下直接引用 `ptc.enabled` 会报错。因此模板只能用 `lookup` 读取 `ptc`，且 PTC 未生效的分支不能有新文字：没有 `ptc` 字段或 PTC 关闭时，输出必须与改动前逐字节一致。`test/unit/agent/builtin/prompt-renderer.test.ts` 对每份引用 `ptc` 的模板检查这一点；以后给模板引用新的上下文字段，也要按同样方式防护并补测试。主 Agent 正文来自 `agent.md`，已有安装不会因为随包模板更新而出现这一节，Reset 后才会采用。

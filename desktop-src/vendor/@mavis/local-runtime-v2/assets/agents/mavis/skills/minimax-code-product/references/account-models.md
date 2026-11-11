# MiniMax account, models, and media reference

Use this reference for MiniMax Code or MiniMax Open Platform accounts, M Plan, legacy Token Plan, subscription keys, credits/points/Credit, plans, usage, quotas, API keys, BYOK, providers, model catalogs and access, context windows, image/audio/music/video or multimodal entitlements including H3 Max video generation, and why a model or media task is unavailable.

## Stable boundaries

- An M Plan (or legacy Token Plan) subscription resource and pay-as-you-go API balance/API key are different resource paths; never assume their keys, quotas, or model access are interchangeable.
- Model availability depends on product surface, key/provider type, account, region, plan, version, and current service rollout—not the model name alone.
- Media support and credit eligibility are separate questions: a model may exist in the catalog without being enabled for the user's product, plan, or requested operation.
- The Agent cannot change balance, entitlement, quota, permissions, or server-side validation.

## M Plan and legacy Token Plan

- Use M Plan by default for current subscription questions, and discover its overview, usage, and FAQ
  through the current-region official index. If the user asks about Token Plan or their account still
  shows a legacy plan, read the corresponding legacy-subscriber and migration guidance.
- Do not treat M Plan as a pure rename of Token Plan or assume existing subscribers migrated
  automatically. Verify renewal, upgrade, quota, multimodal support, and historical entitlements
  separately against the latest official guidance for the current region.

## BYOK 环境变量凭据

用户希望通过环境变量提供 API Key 时，定位当前客户端或运行时使用的
`config.yaml`，把已有供应商的密钥字段改为完整的 `${NAME}` 引用。保留协议、地址、模型列表和其他配置：

```yaml
custom_provider:
  work:
    options:
      apiKey: '${WORK_API_KEY}'

minimax_api:
  apiKey: '${MINIMAX_API_KEY}'
```

- 支持 `custom_provider.<供应商 ID>.options.apiKey` 和
  `minimax_api.apiKey`。这两个字段分别供自定义供应商和 MiniMax API 使用。
- 变量名以字母或下划线开头，后续可含字母、数字和下划线。`$NAME`、`Bearer ${NAME}` 和
  `prefix-${NAME}` 按原文处理；`{env: NAME}` 会触发类型错误。
- 由用户在本地启动环境中设置密钥，运行时从自身进程环境读取。改变终端或启动器的环境后，重新启动对应客户端或运行时，使新进程继承变量；已经运行的桌面应用保持原进程环境。
- 变量缺失或去除首尾空格后为空时，请求报错会指出供应商、字段和变量名。排查时只确认变量是否存在且非空，不回显变量值，不要求用户把密钥贴进对话。
- 配置文件保留引用文本，模型请求、模型发现和已保存配置的连通性测试使用解析后的密钥。保存其他设置时保留引用文本。
- 引导用户编辑 `config.yaml`；桌面表单没有专门的环境变量配置入口。自定义请求头和 Base
  URL 的变量展开需要单独核对支持范围。

## Official source discovery

Use only the current region's sources:

- `region: cn` → MiniMax Code `https://agent.minimax.cn/docs/llms.txt`; Open Platform `https://platform.minimax.cn/docs/llms.txt`
- `region: en` → MiniMax Code `https://agent.minimax.io/docs/llms.txt`; Open Platform `https://platform.minimax.io/docs/llms.txt`

MiniMax Code docs are authoritative for product-surface behavior. Open Platform docs are authoritative for API models and underlying billing rules. Prefer `.md` pages discovered from the matching index. Never query both regional indexes for an ordinary current-region question.

MiniMax Code pages that often decide an in-product answer:

- `/docs/code/account/usage.md` for M Plan, credit balance, and quota presentation
- `/docs/code/account/minimax-api.md` and `/docs/code/account/byok.md` for keys and custom providers
- `/docs/code/account/byok-agent-setup.md` when the user wants an Agent to configure a custom model and verify a real reply
- `/docs/code/agents/h3-max.md` for in-product video generation with sound

Video generation needs its own check: a media model being reachable does not mean the current plan includes it, that credits cover it, or that the user's surface exposes it.

## Verification workflow

1. Identify resource: M Plan subscription, legacy Token Plan subscription, purchased credits, pay-as-you-go balance, or BYOK provider; do not infer the plan type from "subscription" alone.
2. Identify surface, region, model, media type, and requested operation.
3. Read the current regional official pages and specific model/API documentation; do not rely on historical model names, prices, quotas, or UI paths.
4. For account-specific state, tell the user where to inspect the console and mark balance/entitlement as unverified unless runtime/account evidence exists.
5. For “can credits generate video?” or similar, verify model operation support, product/plan eligibility, and current billing/credit rule.
6. Report the conclusion first, source links next, and unresolved account or rollout conditions last.

## Safety

Never expose or ask the user to paste API keys, subscription keys, passwords, OAuth secrets, or verification codes. Never promise that every model/media operation is covered by credits, or that a plan bypasses API billing. Do not bypass region, plan, account, or permission restrictions.

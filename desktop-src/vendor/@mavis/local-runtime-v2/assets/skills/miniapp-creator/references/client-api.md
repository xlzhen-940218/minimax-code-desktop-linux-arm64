# Mini App Client API

The Host injects `window.mcode` into the managed Mini App's main page through Electron preload.
Check that the required method exists before calling it: older Hosts, ordinary Browser tabs, and
standalone browsers do not provide this bridge. Client APIs are separate from Node's
`start(context)`; see [runtime-api.md](runtime-api.md) for that context.

No npm SDK, HTTP bridge, Session ID, or plugin ID is needed, and a model is optional. A declaration file only
describes the injected values; it does not create the bridge or grant permissions.

## Type-checking setup

For TypeScript or checked JavaScript, copy [client-api.ts](client-api.ts) beside the Client source,
for example at `miniapp/client/client-api.ts`. Include it in the Client's TypeScript configuration;
its `Window` declaration makes the optional `window.mcode` property known to the compiler. Plain
HTML/JavaScript pages that do not use type checking can call the bridge without copying this file.

TypeScript may also load the declarations with a type-only import:

```ts
import type { McodeClientAPI } from './client-api.js';

const host: McodeClientAPI | undefined = window.mcode;
```

Checked JavaScript can use a JSDoc type reference:

```js
/** @typedef {import('./client-api.js').McodeClientAPI} McodeClientAPI */
```

Both references are for type checking only. Do not load `client-api.ts` with a script tag or add a
runtime import of `client-api.js`. Keep the `.ts` filename because Electron dependency packaging
filters out `.d.ts` assets. Node code continues to use `miniapp-api.ts`, not the Client
declarations.

## `miniapp.host`：感知 Host 与打开入口

`window.mcode.miniapp.host` 提供五个页面 API。先检测 namespace，旧 Host 或独立浏览器缺少它时，Mini
App 使用自己的默认明暗与翻译。Host 不会替 Mini App 应用样式或翻译用户内容。

| API                                             | 入参                 | 返回或通知                                                         | 条件                                                      |
| ----------------------------------------------- | -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `host.ui.getState()`                            | 无                   | `Promise<{ theme, language }>`                                     | 基础只读                                                  |
| `host.ui.subscribe(listener, options?)`         | 回调；可选 `onError` | 首次完整快照与变化；`Disposable`                                   | 基础只读                                                  |
| `host.navigation.getState()`                    | 无                   | `Promise<{ key, view, overlay }>`                                  | `hostAccess: ["navigation.read"]`、开关开启且页面逻辑可见 |
| `host.navigation.subscribe(listener, options?)` | 回调；可选 `onError` | 首次完整快照与变化；`Disposable`                                   | 同上；隐藏时暂停，恢复只发最新状态                        |
| `host.navigation.open(target)`                  | 公开入口目标         | `Promise<MiniAppHostOpenResult>` | 页面具有短时用户激活、目标和访问检查、已有离开与保存保护    |

`theme` 只返回实际生效的 `light` / `dark`，跟随系统的设置也先由 Host 解析。`language`
是已生效界面语言，首期为 `en` /
`zh-Hans`。Desktop 语言设置保存后需要重启才生效，保存时不会提前通知。这些字段不包含 IP、定位、账号或完整设置。

导航的 `view` 为 `home` / `conversation` / `plugins` / `schedule` / `other`，`overlay` 为
`{ type: "settings" }` 或 `null`，不含具体设置页签。`key`
在有效导航上下文提交后变化，A→B→A 也会产生新值；重复读取同一状态保持一致。它是当前页面和授权代次内的不透明短期标记，不包含 session
ID 或 URL，不能跨插件关联，也不能传给 `open`。从 A 导航到 B 不改变 Mini
App 已绑定的 Host 会话；默认 Agent 调用和草稿追加仍以原目标为准。

`open` 调用时 preload 检查 Chromium 的 `navigator.userActivation.isActive`，建议在点击或键盘操作回调中直接调用。
这是近期交互产生的短时激活状态，不与某个导航按钮绑定，也不能区分人工与受信任自动化；有效期间可多次调用。

`open` 接受以下目标，不接受任意 path 或 URL：

```ts
await window.mcode?.miniapp.host?.navigation.open({ id: 'home' });
await window.mcode?.miniapp.host?.navigation.open({ id: 'plugins' });
await window.mcode?.miniapp.host?.navigation.open({ id: 'schedule' });
await window.mcode?.miniapp.host?.navigation.open({ id: 'settings', section: 'language' });
// section 还支持 appearance；省略时打开设置。
await window.mcode?.miniapp.host?.navigation.open({
  id: 'session',
  sessionId: 'already-known-session',
  source: 'local',
});
```

`session` 目标打开固定所属 Host 的主聊天页面。首期仅支持 `source: "local"`；cloud / SSH 返回
`unsupported_source`，不会回退到当前来源或本地同名 ID。打开已合法持有的 session ID 不要求
`session.read`，也不会授予读取正文的权限。不存在与无权访问统一返回 `target_unavailable`。 `opened`
表示目标界面已呈现，不表示其中全部数据已加载。用户取消离开或保存确认返回
`{ status: "cancelled", reason: "user_cancelled" }`；新用户导航取代本次请求返回
`superseded`。弹出 Mini App 仍固定属于原 Host，不会随着系统焦点改绑。
打开设置会保留底层页面和文件草稿；真正关闭或切换设置页时，才检查设置中未保存的内容。
普通 Back/Forward 保留设置弹层与草稿。原所属窗口真正销毁后，旧页的 Host 调用返回 `host_unavailable`，不会自动迁移到另一个窗口。

订阅先建立接收路径再取得基线，无需自行拼接“读取然后监听”。页面初次加载尚未显示时，
已授权的导航订阅保持暂停，首次可见后提供完整基线；隐藏时的单次读取仍被拒绝。卸载时调用
`dispose()`，Host 也会回收失效文档。订阅参数无效、建立失败或终止时，通过
`options.onError({ code, message })` 通知。撤权或 Host owner 失效时旧订阅结束，恢复后由作者重新订阅。隐藏的导航观察不保留轨迹；UI 偏好不因此获得导航权限。
Settings 等原生遮罩临时覆盖内联页面时，页面仍算逻辑可见，可以观察设置 overlay。
权限来源暂时不可达时，以 `host_unavailable` 结束订阅；来源恢复后可重新订阅。实际关闭或未声明权限返回 `not_permitted`。
导航权限关闭请求在途时，新读取与订阅也会被拒绝；请求结束后，新调用重新检查 Runtime 开关，旧订阅不会自动恢复。
新 run 的页面恢复会完整重载文档，即使 URL 带 hash；恢复所需状态应持久化，新文档自行重新订阅。
新文档已经 commit 后，即使资源加载超时或失败，Host 仍保留该文档的运行身份；停止 Runtime 仍会结束其能力。

```js
const miniAppHost = window.mcode?.miniapp?.host;
const displaySubscription = miniAppHost?.ui.subscribe(
  ({ theme, language }) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
    // 在这里选择 Mini App 自己提供的翻译资源。
  },
  { onError: ({ code }) => console.warn('Host preferences unavailable:', code) },
);
window.addEventListener('pagehide', () => displaySubscription?.dispose(), { once: true });
```

失败只公开稳定 `code`：`invalid_request`、`not_permitted`、`host_unavailable`、
`unsupported_source`、`unsupported_target`、`target_unavailable`、`result_unknown`。Promise 使用普通对象
`{ code, message: code }` 拒绝；在 `catch` 中读取这两个字段，不依赖
`instanceof Error`。这样跨 Electron contextBridge 后也能保留稳定 code。订阅通过 `onError`
收到相同结构。`result_unknown` 表示回包无法确认，不要自动重试有界面副作用的
`open`。若导航结束了调用文档，不保证旧 Promise 的后续代码执行；新文档重新读取或订阅当前状态。
Host 等待呈现结果最多 60 秒，超时取消旧请求并报告 `result_unknown`。每页最多保留 64 个 Host
订阅；不需要时及时 `dispose()`，该上限独立于 Agent 配额。

## `miniapp.message.append(text)`

Use `window.mcode.miniapp.message.append(text)` from a user-activated Client button. The Host shows
its own confirmation dialog with the plugin, target conversation, and text. On confirmation, the
text is appended to that conversation's chat input. The user can edit it and must press the chat
input's Send button to start an Agent turn.

This bridge only appends to the unsent draft after confirmation. Mini Apps cannot insert, edit, or
delete sent chat messages or rewrite the Agent's conversation context. The `message` namespace does
not grant access to chat history.

### Button example

```js
/**
 * @param {string} text
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} status
 */
async function askAgent(text, button, status) {
  const message = window.mcode?.miniapp?.message;
  if (!message?.append) {
    status.textContent = 'This Host does not support adding text to the chat input.';
    return;
  }
  button.disabled = true;
  try {
    await message.append(text);
    status.textContent = 'Added to the chat input. Review it there and press Send.';
  } catch (error) {
    const code = error && typeof error === 'object' && 'message' in error ? error.message : '';
    if (code === 'user_cancelled') {
      status.textContent = 'Cancelled. Nothing was added.';
    } else if (code === 'result_unknown') {
      status.textContent =
        'Check the chat input before trying again; the text may already be there.';
    } else {
      status.textContent = 'Could not add the text. Check the conversation and try again.';
    }
  } finally {
    button.disabled = false;
  }
}
```

Localize these example labels for the page. Make the destination clear in the button label, such as
“Ask Agent”; never claim that the Agent has started just because this promise succeeded.

### Behavior and errors

- `text` is a string of plain text, at most 100,000 UTF-16 code units per call. Spaces, tabs, and
  newlines are accepted and appended literally; include any desired separating newline in `text`.
  HTML-looking text stays text. An empty string also requires confirmation and leaves the draft
  unchanged when confirmed.
- The append preserves existing draft text, rich-text nodes, references, and attachments.
- Every call requires confirmation. There is no remembered grant or automatic submission. Valid
  calls are confirmed in order, not rejected merely because another request is pending. Cancelling
  one call does not cancel the next one. The example disables only its initiating button to avoid
  accidental duplicate actions; other calls can still be made.
- Main checks the managed page, main frame, and actual origin when accepting a request. The origin
  comes from Electron, not a field the page supplies. A site loaded after navigating away from the
  Mini App cannot use its identity to request an append.
- A valid Mini App still needs an explicit destination. Without a target conversation or Host
  receiver, the call rejects with `target_unavailable`; the Host does not create a conversation or
  fall back to the current conversation or the home draft. This also applies to a future standalone
  Mini App page without a destination.
- Once accepted, the Host handles the captured text and fixed destination. It does not repeatedly
  check the Mini App's visibility or runtime while waiting for confirmation, and does not perform
  another Main authorization after confirmation.
- The Host updates the draft through its existing draft interface, whether or not the input is
  mounted. Read-only or unavailable conversations cannot be targeted.
- The call ends when the confirmed append completes. Later editing, composition, voice input, undo,
  length handling, sending, and clearing remain the chat input's responsibility; this API does not
  wait for or coordinate those flows.
- The returned `Promise<void>` waits for the user's decision without an automatic confirmation
  timeout and resolves only after the Host completes the confirmed append. It is not an Agent reply,
  a persistent business result, or a guarantee that the draft has reached disk. A missing reply when
  the Host document ends can return `result_unknown`; never automatically repeat the append.

Cancellation or failure rejects with an `Error` whose `message` is one of `user_cancelled`,
`invalid_request`, `text_too_large`, `not_allowed`, `target_unavailable`, or `result_unknown`.
Errors contain no chat history or existing draft content.

### Business results are separate

If the Agent should update a table, card, or other business object, provide the requested MCP tools
as described in [mcp.md](mcp.md). Use stable business IDs in the request and tools; let the page
read the resulting business state through its own Node service. Users may edit, combine, or delete
the appended instructions, so a draft append is not a reliable request-to-turn correlation ID.

The bridge does not expose raw IPC or Node capabilities. Keep third-party scripts out of the trusted
main document: code running there, including a same-origin frame that can reach its parent, shares
the page's trust. Cross-origin frames cannot invoke the Host bridge as themselves.

## `miniapp.agent`

`window.mcode.miniapp.agent` runs Agent turns for the page and returns their final reply; Node code
uses `context.agent` from [runtime-api.md](runtime-api.md) instead. `run`, `reply`, `answer`,
`cancel`, `open`, `models`, `agents` and `create` reject with `not_permitted` unless the manifest
declares `agentAccess: ["session.run"]`, and while the user has switched `session.run` off for this
Mini App (running turns then end as `aborted`); reading and observing sessions follow their own
rule below.
The Host resolves the plugin from the tab, never from the call. A new session uses the agent of the chat session the Mini
App is open in, with its full capabilities (files, shell, Skills, and MCP including this Mini App's
own); Node-initiated runs, and pages not opened from a session, use the primary Agent unless `agent`
is passed (see `agents()` below); continuing a session keeps its agent. The Agent works in the project directory of that chat when the chat has
one; otherwise, and for Node-initiated runs, it works in this Mini App's own Agent directory; a
continued session keeps its directory. A new session takes the model and thinking level of the chat
it was created from (the runtime default when the chat has none or the session is Node-created), and
keeps them. `run` / `answer` may pass `model` to switch the session's model first; the Host
validates it the way the composer validates a new session's model (the model must be one the user can
see in `models()`) and rejects an unusable one with `invalid_request` / `INVALID_ARGUMENTS`. A model
whose BYOK credentials are missing is accepted here, and the turn then ends with `status: 'error'`.
Results and `turn.started` carry the model the turn was dispatched with. Up to `agentConcurrency`
runs (default 4) per Mini App run at once, one per session; further `run` / `answer` calls wait in
order, up to four times that many. A Mini App may also start at most 12 turns per 60-second window,
or 5 × `agentConcurrency` when that is larger; past that, calls reject with `busy` (retryable).
The page only receives `busy`; which limit was hit is reported only to the Node runtime.
Only calls that take a run slot (or join one with `whenBusy`) count, so a full queue always drains
within one window; the count
survives a Mini App restart. Inside a root session the Mini App started, the
Agent cannot control Mini Apps and `@`-mentions do not cold-start others; sessions it delegates to
sub-agents are not covered.

For business prompt construction and per-call UI state, follow
[agent-interaction.md](agent-interaction.md). The methods and events below define the Host contract.

### Interaction

The Mini App renders the Agent's interaction itself, or lets the Host do it with `open`. Two
interactions block a turn, and each maps to one event and one reply:

- `permission.requested` → `reply`: a tool call waits for approval. Decide it with `allowOnce` or
  `deny`; there is no `allowAlways`, because a Mini App does not write the user's global rules.
- `question.requested` → `answer`: the turn paused on a questionnaire (`ask_user`, a feature enable,
  or a Plan review). `request` is the same questionnaire the Host chat renders; the answer starts
  the continuation turn, which you observe like `run`.

A permission request waits only while someone can answer it: (a) the run that owns the session
passed `onEvent` (page or Node), or (b) the session is currently shown in a chat side panel through
`open`. Otherwise it is denied, and the model is told that nobody can
answer it and should continue without the tool. Where the session was created does not count: a
session started from a chat does not wait on its own. Closing the side panel tab ends (b); from then
on the page or Node code must handle `permission.requested` itself or call `open` again. A
questionnaire nobody listens to ends the turn with `result.pendingQuestion`; continue with `answer`.
A page that passes `onEvent` must handle `permission.requested` itself (or `open` the session so the
user can answer in the side panel); an unhandled request waits until `cancel` or the page closes.
A page that passes no `onEvent` is judged by (b) alone. There is no timeout: a waiting run is
released by cancel or abort, process exit, or republish.

```js
/** @typedef {import('./client-api.js').MiniAppAgentQuestionnaire} MiniAppAgentQuestionnaire */
/** @typedef {import('./client-api.js').MiniAppAgentQuestionAnswer} MiniAppAgentQuestionAnswer */

let activeSummaryId = '';

/**
 * @param {string} text
 * @param {HTMLElement} output
 * @param {(request: MiniAppAgentQuestionnaire) => Promise<MiniAppAgentQuestionAnswer[]>} askUser
 *   Renders the questionnaire in this page and resolves with one answer per step.
 * @param {(toolName: string, reason: string) => Promise<boolean>} confirmTool
 *   Asks the user in this page whether the tool may run once.
 */
async function summarizeWithAgent(text, output, askUser, confirmTool) {
  const agent = window.mcode?.miniapp?.agent;
  if (!agent) {
    output.textContent = 'This Host does not support the Agent API.';
    return;
  }
  activeSummaryId = `summary-${Date.now()}`;
  let streamed = '';
  /** @param {import('./client-api.js').MiniAppAgentRunEvent} event */
  const onEvent = (event) => {
    if (event.type === 'permission.requested') {
      // The run waits for this decision; the event names the session even on its first run.
      void confirmTool(event.toolName, event.reason)
        .then((allowed) =>
          agent.reply({
            sessionId: event.sessionId,
            requestId: event.requestId,
            decision: allowed ? 'allowOnce' : 'deny',
          }),
        )
        .catch(() => {}); // request_not_found: the run was cancelled meanwhile.
      return;
    }
    // Show the reply as it streams; ignore event types this page does not use.
    if (event.type !== 'text.delta') return;
    streamed += event.text;
    output.textContent = streamed;
  };
  try {
    let result = await agent.run({ text, requestId: activeSummaryId }, { onEvent });
    // The turn paused on a questionnaire. Answer only after the run resolves: until then it
    // holds the session's single-run slot.
    while (result.pendingQuestion) {
      const answers = await askUser(result.pendingQuestion.request);
      streamed = '';
      result = await agent.answer(
        {
          sessionId: result.sessionId,
          questionId: result.pendingQuestion.requestId,
          answers,
          requestId: activeSummaryId,
        },
        { onEvent },
      );
    }
    output.textContent = result.text ?? `Agent ended: ${result.status}`;
  } catch (error) {
    const code = error && typeof error === 'object' && 'message' in error ? error.message : '';
    output.textContent =
      code === 'result_unknown' ? 'Result unknown; check before asking again.' : `Failed: ${code}`;
  } finally {
    activeSummaryId = '';
  }
}

function stopSummary() {
  if (activeSummaryId) window.mcode?.miniapp?.agent?.cancel(activeSummaryId);
}
```

- `run({ text, sessionId?, model?, agent?, whenBusy?, requestId? }, { onEvent? })` resolves with
  `{ sessionId, turnId, model?, status, text?, error?, pendingQuestion? }` when the turn ends. Pass
  `sessionId` back to continue that conversation. `text` is at most 100,000 UTF-16 code units.
  `model` is `{ providerId, modelId, variant?, thinking?: { effort } }`, taken from `models()`
  (`variant: ''` means thinking is off; it is a real value and is preserved, so pass it back as is);
  `model` in the result is the one the turn was dispatched with. `agent` is accepted only when
  starting a session (see `agents()`).
- `whenBusy` (only with `sessionId`) decides what happens when that session is already running a
  turn, whoever started it; without it the call rejects with `busy` and the text reaches no turn,
  so sending it again later runs it once (`busy` also when the session is compacting or has
  messages queued ahead, such as ones the user stopped). These are the Desktop composer's two
  follow-up behaviours, and on an idle session both just start a turn:
  - `'queue'` — the text waits in the session queue (shown read-only in the chat side panel) and
    runs as its own turn after the turns ahead of it; you get `run.queued` with its queue
    `position`, then the call resolves like any `run`.
  - `'steer'` — the text is handed to the running turn, which reads it at its next input point and
    adjusts its work. You get `message.pending`, then `message.steered`, and the call resolves with
    `status: 'steered'` and no `text`: the reply comes with the running turn's own call. If that turn
    answers before reading the text, the text runs as the next turn and the call follows it; if
    that turn is stopped, the text stays in the conversation and the call still resolves
    `steered`.

  Cancelling a queued call removes its text from the queue (`cancelled`); a steered text cannot be
  withdrawn, so cancelling it before it was read rejects with `result_unknown` without stopping the
  running turn. After the user stopped the session with messages still queued, a `whenBusy` call
  waits behind them until the user resumes the queue or sends from the chat; it keeps its run slot
  meanwhile, so cancel it to free the slot.
- `requestId` is optional; supply one when the page may need `cancel(requestId)`. Reusing an id that
  is still running rejects with `busy`. `cancel` on an unknown or finished id does nothing; a
  cancelled run resolves with `status: 'aborted'` only when the Host confirmed the abort. Otherwise
  it rejects with `cancelled` (nothing ran) or `result_unknown` (the abort was not confirmed).
- `reply({ sessionId, requestId, decision })` decides a `permission.requested` while its run is
  still waiting; `requestId` is the event's and `decision` is `allowOnce` or `deny`.
- `answer({ sessionId, questionId, answers, model?, requestId? }, { onEvent? })` answers the questionnaire
  `questionId` (the `requestId` of `question.requested` or `result.pendingQuestion`; both carry the
  questionnaire as `request`). `answers` holds one
  `{ stepId, selectedOptionIds, selectedOther, otherText?, skipped? }` per step; `requestId` is your
  id for `cancel`, as in `run`. It resolves like `run`; when the answer was recorded but the
  continuation turn was not observed, it rejects with `result_unknown`. Call it after the paused
  `run` resolves: that run still holds the session's single-run slot while `question.requested` is
  delivered, so an earlier `answer` rejects with `busy`. `answer({ model })` switches the session's
  model before the questionnaire lookup, so a `request_not_found` answer still leaves the model
  switched.
- `open(sessionId)` shows that session as a tab in the side panel of the chat the Mini App is open
  in. The user can read the conversation there and answer its permission and question cards, so a
  page may let the Host handle the interaction by opening the tab instead of rendering
  `permission.requested` and `question.requested` itself. Permission requests wait for the tab only
  while it stays open; after the user closes it, handle the events yourself or call `open` again.
  When the Host window reloads or closes, the Host reports its tabs closed for you. The tab is not
  remembered across a runtime restart or the deletion of the host chat; call `open` again then.
  `open` is idempotent, so retrying after `runtime_unavailable` or `result_unknown` is safe. Any
  session this Mini App owns can be opened, whichever chat created it; it rejects with
  `session_not_found` otherwise, and with `not_permitted` when the Mini App is not open inside a
  chat.
- `models()` returns the available model catalog `models[]`, the runtime `default`, and the optional
  `host` selection when opened from a chat (the default when the chat has none). `default` and
  `host` are selections ready to pass as `model` to `run` / `answer`. To select a catalog entry
  `option`, construct `{ providerId: option.providerId, modelId: option.modelId }` and add a
  selected `variant` if needed. If the model supports thinking and the user selects an effort from
  `option.thinking.efforts`, pass `thinking: { effort }`. The catalog's
  `thinking: { efforts, default? }` describes capabilities; the request takes
  `thinking: { effort }`. Preserve `variant: ''`: it explicitly turns thinking off. `models()`
  rejects with `invalid_request` / `INVALID_ARGUMENTS` when the runtime has no usable default model.
- `agents()` lists the agents the user has configured (`name`, `displayName`, `primary`).
  `create({ agent })` or a first `run({ agent })` starts the session as that agent instead of the
  chat's; `name` must come from this list, and the alias `main` is rejected. A session never changes
  its agent, so continuing with `agent` is `invalid_request` — create a new session to hand work to
  another agent. The plugin directory follows the chosen agent; the project directory and model are
  unaffected.
- `create({ agent? })` creates a session bound to this chat when the Mini App is open in a chat
  (agent, project directory, model); from a tab without a host chat it creates with the plugin
  directory and the runtime default model. It runs no turn and returns its `sessionId`; hand it to your Node code to continue the
  session there. It takes no run slot. If the call hits the Host's 60 s deadline it rejects with
  `runtime_unavailable` although the session may already exist.
- `onEvent` receives progress events `{ type, sessionId, turnId, ... }`. Every event except
  `run.queued` names its session, so `reply` works before the `run` that created the session
  returns. Ignore any `type` you do not know; new types may be added.
  - `run.queued` — the call waits; `position` is its 1-based place in line. Sent once per wait,
    before the turn starts: it has no `turnId`. It means all run slots are taken (it carries `sessionId` only
    when the call continues a session), or, with `whenBusy: 'queue'`, that the text waits in the
    session queue. A `whenBusy` call can get it twice: first for a run slot, then for the queue.
  - `message.pending` / `message.steered` — only with `whenBusy: 'steer'`: the text was handed to
    the running turn `turnId`, then read by it. `message.steered` is the call's last event.
  - `turn.started` — the Agent began the turn; `model` is the model it was dispatched with.
  - `text.delta` — `text` is the next piece of the reply as it streams.
  - `message.committed` — `text` is one complete assistant message; a turn can have several.
  - `tool.started` — the Agent called the tool `name`.
  - `tool.finished` — that tool returned; `ok` is `false` when it failed.
  - `permission.requested` — the tool `toolName` waits for `reply`; carries `requestId`, `reason`,
    and `toolInput?`. When the Agent delegated to a child session, the child's asks arrive here with
    the child's own `sessionId` and `turnId`; `reply` with those and do not filter events by the
    root turn, or the run waits forever.
  - `question.requested` — sent just before `turn.finished` when the turn paused; carries
    `requestId`, `mode` (`questionnaire`, `feature-enable`, or `plan`), and `request`, whose `steps`
    each have an `id`, a `question`, `selectionMode`, and `options`; `request.modePayload` holds the
    Plan review Markdown.
  - `turn.finished` — last unless the call ended `steered`; carries the same `status`, `text?`, and
    `error?` as the result.
- Reloading or closing the page cancels its active runs. Too many concurrent runs reject with
  `busy`.
- `observe({ all: true, requestId? }, { onEvent })` watches the user's Agent: `turn.started` /
  `message.committed` (the final reply) / `turn.finished` of every user conversation, each with
  `sessionId` and the conversation's `title` when it has one. `observe({ sessionId, requestId? },
  { onEvent })` reports every progress event of that session, turn after turn. Pass exactly one of
  `sessionId` / `all: true`, or it rejects with `invalid_request`. An observer's `turn.started`
  carries `model` only when the Host could read it. `permission.requested` and
  `question.requested` never reach an observer. The promise resolves when the subscription ends
  (`cancel(requestId)` with the `requestId` you passed, the session was deleted, the page or Mini
  App stopped, `session.read` was switched off) and rejects with the failure code when it could
  not start. Up to 4 observers per Mini App (`busy`); they use no run slots and no start budget.
  `turn.finished` comes without `text` (and with no `message.committed`) when the Host could not
  read the final reply.
- `sessions()` resolves with `{ sessions }`, the 50 most recently updated user conversations
  `{ sessionId, title?, agent, status, workspaceDir, isDefaultWorkspace, createdAtMs, updatedAtMs }`
  (`status`: `idle`, `running`, `error`, `aborted`; `workspaceDir` is the conversation's project
  directory as recorded, `isDefaultWorkspace` is `true` when it has no project); Mini App, scheduled
  and sub-Agent sessions are not listed. `session(sessionId)` adds `model?` (the conversation's
  current model), `error?: { message }` (only while `status` is `error`) and
  `lastAssistantText?`, the final text of the latest reply.
- `session()` without an id reads the chat this page is open in, for example to work in that
  chat's project directory; it resolves with `undefined` when the page is not in a chat tab. That
  chat is the user's conversation, not this Mini App's, so it needs `session.read` like any other
  (`not_permitted` otherwise). Node has no current chat: pass this id to Node code when it needs
  it.
- `observe`, `sessions` and `session` need `agentAccess: ["session.read"]`, except for this Mini
  App's own sessions, which `session.run` also covers; another Mini App's or a sub-Agent session is
  `session_not_found`. They change nothing, so a lost or garbled settlement is
  `runtime_unavailable` and safe to retry, never `result_unknown`. See
  [agent-interaction.md](agent-interaction.md#observing-the-users-sessions).
- Failures reject with an `Error` whose `message` is `invalid_request`, `not_permitted`, `busy`,
  `session_not_found`, `runtime_unavailable`, `cancelled`, `result_unknown`, or `request_not_found`
  (the permission request or questionnaire is unknown or already settled). After `result_unknown`
  the turn may already have run; never repeat it automatically. It also covers a turn that ended
  (its `turn.finished` was delivered) when the Host could not tell whether a question is pending.
  `runtime_unavailable` means nothing was started; retry later. A page left over from a Mini App
  process that has since restarted also gets it.

## `miniapp.capabilities`

`window.mcode.miniapp.capabilities.has(name)` answers synchronously whether this Host version
supports a feature, named by its API path (`message.append`, `agent.run`, `agent.open`,
`agent.models`, `agent.agents`, `agent.create`, `agent.observe`, `agent.sessions`,
`agent.session`, `speech.transcribe`, `window`, `hostConnector`). The list is Host-wide:
it does not distinguish the page from Node, so `has('hostConnector')` is true here although only
Node has `context.hostConnector`. It reflects the Host, not the manifest or grants: `has('agent.run')` is true even
when `agentAccess` was not declared and calls would reject with `not_permitted`. Older Hosts omit
the namespace; write `window.mcode?.miniapp?.capabilities?.has('agent.run')`.

## `miniapp.speech.transcribe(input, options?)`

`window.mcode.miniapp.speech.transcribe({ audio, format }, { onPartial? })` turns one utterance
the page recorded into text with the Host's speech recognition and resolves `{ text }`. The page
owns the microphone and the interaction; the Host only transcribes.

Two declarations are required, or every call rejects with `not_permitted`:

- the manifest declares `deviceAccess: ["microphone"]` (see
  [package-contract.md](package-contract.md)); a Host older than this field refuses to load the
  whole package as `MINIAPP_MANIFEST_FIELD_UNSUPPORTED`;
- the user leaves the plugin's "Use the microphone" switch on. The same switch gates
  `getUserMedia`: when it is off, the page cannot record either (`NotAllowedError`).

### Audio contract

The Host transcribes exactly one PCM format: 16 kHz, mono, signed 16-bit little-endian samples.
Pass `format: { sampleRate: 16000, channelCount: 1, sampleFormat: 's16' }` verbatim on every
call; it is a declaration of what `audio` contains, and any other value is `invalid_request`.
`audio` is an `Int16Array` (or the `ArrayBuffer` / view behind one) with at least one sample and
at most 16,000,000 bytes (500 s, `audio_too_large`). Do not send `MediaRecorder` output or a WAV
you encoded yourself: WAV, WebM, Ogg, FLAC and MP3 are refused by their leading bytes as
`invalid_request`. A page that records at 48 kHz and passes the samples anyway is not detected
and gets garbage text, so create the `AudioContext` with `sampleRate: 16000` and let it resample.

Copy [audio-capture.ts](audio-capture.ts) beside the Client source for a capture helper that
produces this format: `startSpeechCapture()` opens the microphone and `stop()` returns the
`Int16Array` to pass as `audio`.

### Utterance boundary

The Host returns text only after it has the whole utterance; it does not caption while the user
speaks. `onPartial` reports the transcript so far while the Host processes the utterance it
already has, not live speech. Decide in the page when an utterance ends and call once per
utterance. Any interaction works:

```js
import { SPEECH_AUDIO_FORMAT, startSpeechCapture } from './audio-capture.js';

const holdButton = /** @type {HTMLButtonElement} */ (document.querySelector('#hold-to-talk'));
const toggleButton = /** @type {HTMLButtonElement} */ (document.querySelector('#dictate'));
const indicator = /** @type {HTMLElement} */ (document.querySelector('#recording-status'));
const draft = /** @type {HTMLTextAreaElement} */ (document.querySelector('#draft'));

// `getUserMedia` takes a moment (longer on the first grant), so keep the pending start: a
// release or second click that arrives before it resolves must still stop the microphone.
/** @type {Promise<import('./audio-capture.js').SpeechCapture | null> | null} */
let starting = null;

/** @param {HTMLElement} indicator */
async function beginCapture(indicator) {
  if (starting) return;
  starting = startSpeechCapture().catch((error) => {
    starting = null;
    indicator.textContent =
      error.name === 'NotAllowedError'
        ? 'Turn on "Use the microphone" for this Mini App in the plugin details.'
        : 'The microphone could not be opened.';
    return null;
  });
  indicator.textContent = 'Recording…';
}

/**
 * @param {HTMLElement} indicator
 * @param {HTMLTextAreaElement} field
 */
async function endCapture(indicator, field) {
  const pending = starting;
  starting = null;
  const capture = pending ? await pending : null;
  indicator.textContent = '';
  if (!capture) return;
  const audio = capture.stop();
  if (audio.length) await transcribeInto(audio, field);
}

// Push to talk: hold to record, release to transcribe. Capturing the pointer keeps its events on
// this button even after the finger or mouse drifts off it; without the capture a release outside
// the button would never reach `pointerup` here and the microphone would stay open.
// `lostpointercapture` fires for a release anywhere, a cancelled gesture, or the button leaving
// the DOM, so it is the single place the capture ends.
holdButton.addEventListener('pointerdown', (event) => {
  holdButton.setPointerCapture(event.pointerId);
  beginCapture(indicator);
});
holdButton.addEventListener('lostpointercapture', () => endCapture(indicator, draft));

// Toggle: click to start, click again to finish.
toggleButton.addEventListener('click', () =>
  starting ? endCapture(indicator, draft) : beginCapture(indicator),
);

/**
 * @param {Int16Array} audio
 * @param {HTMLTextAreaElement} field
 */
async function transcribeInto(audio, field) {
  const speech = window.mcode?.miniapp?.speech;
  if (!speech) {
    field.placeholder = 'This Host does not support speech recognition.';
    return;
  }
  try {
    const { text } = await speech.transcribe(
      { audio, format: SPEECH_AUDIO_FORMAT },
      { onPartial: (partial) => (field.value = partial) },
    );
    field.value = text;
  } catch (error) {
    // `error.message` is one of the codes listed under "Behavior and errors".
    field.placeholder =
      error instanceof Error && error.message === 'not_permitted'
        ? 'Turn on "Use the microphone" for this Mini App in the plugin details.'
        : 'Speech recognition failed; type your message instead.';
  }
}
```

A dictation mode that keeps the microphone open splits the recording itself (for example on a
silence threshold or a fixed length under 500 s) and calls `transcribe` once per segment,
appending the results.

### Behavior and errors

- One `transcribe` per Mini App runs at a time; a second call while one is pending rejects with
  `busy`. Disable the control until the promise settles.
- Closing or reloading the page drops a pending transcription; nothing is retried.
- `runtime_unavailable`: the Host's speech recognition is turned off or the user is signed out.
  Nothing was started; offer typing instead.
- `transcription_failed`: the speech service failed or did not answer within the Host's deadline.
  The same audio may be sent again.
- `result_unknown`: the Host could not deliver an answer. Treat it like `transcription_failed`.
- `invalid_request`, `not_permitted`, `audio_too_large`: see above. Fix the page or the manifest;
  retrying the same call will not help.
- Feature-detect with `window.mcode?.miniapp?.speech` or `capabilities.has('speech.transcribe')`;
  older Hosts omit the namespace.

The Host does not show that a Mini App is recording. Show your own recording indicator while a
capture is open, and stop the microphone as soon as the utterance ends. Make the stop path
independent of where the pointer is released and of whether `getUserMedia` has resolved yet (the
example above does both); a stop that can be skipped leaves the microphone open with nothing to
tell the user.

## Camera and system notifications

These are standard Web APIs; the Host adds no namespace for them. Each needs its `deviceAccess`
value in the manifest (see [package-contract.md](package-contract.md)) and the user's switch for
it left on. Switches start on and the Host never shows a permission prompt.

- **Camera:** `navigator.mediaDevices.getUserMedia({ video: true })` with
  `deviceAccess: ["camera"]` ("Use the camera"). A request for audio and video together needs both
  `microphone` and `camera` declared and on; when either is off the whole request fails with
  `NotAllowedError`, so request them separately when the page can work with one. The operating
  system may also ask once whether the Host app may use the camera, and a refusal there makes
  `getUserMedia` fail as well. The Host shows no camera indicator: show your own while the stream
  is open and stop its tracks as soon as the page is done.
- **Notifications:** `new Notification(title, { body })` with `deviceAccess: ["notifications"]`
  ("Send system notifications"). They appear as the Host app's notifications.
  `Notification.permission` already reads `granted` when the value is declared and its switch is
  on, and `denied` otherwise; it is never `default`, and `Notification.requestPermission()`
  resolves at once without a prompt. After the user turns the switch off, notifications are not
  shown; listen for `error` if the page needs to know.

A click on a notification counts as a user gesture in its `click` handler, so the page can bring
itself back with [`window.focus()`](#miniappwindow-proposed):

```js
const notice = new Notification('Build finished', { body: 'All 42 checks passed.' });
notice.addEventListener('click', () => {
  window.mcode?.miniapp?.window?.focus().catch(() => {});
});
```

A popped-out page shows and focuses its window; an inline page restores the Host window and
selects its tab. This works only while the page that created the notification is still open: a
notification left in the system's notification center after the page closed or reloaded does
nothing when clicked, and a click cannot open another page.

## `miniapp.window` (proposed)

**Proposed:** this namespace's shape may still change. Feature-detect with
`window.mcode?.miniapp?.window` before use; do not assume it is present or stable long-term.

`window.mcode.miniapp.window` is a handle for this Mini App's own window: whether it is inline in
the File Panel or popped out, and — only when popped out — its position, size, and a few Electron
window flags. It is a separate namespace from `message`; both are injected together.

```ts
const handle = window.mcode?.miniapp?.window;
if (handle) {
  const state = await handle.getState();
  console.log(handle.id, state.mode); // 'inline' | 'window'
  handle.onDidChangeState((next) => console.log(next.mode));
  // Invoke from a user gesture; do not depend on continuation after a rebuilding transfer.
  void handle.update({ mode: 'window', width: 900, height: 650 });
}
```

### Behavior and errors

- `getState().modeChangeReloadsPage === true` means changing `mode` rebuilds the page (the webview backend).
  The logical window `id` and Node runtime stay the same, but the old document, JavaScript state, streams,
  and pending page Promises do not survive. Do not put required work after `await update({ mode })`;
  persist necessary app state first and read the mode again when the destination document starts.
  主宿主窗口在每次弹出/收回前显示共享前端二次确认，提示页面重新加载、未保存内容、录音/采集/转文字及此页面启动的任务、结果或进度显示可能受影响。点独立窗口关闭按钮时先阻止窗口关闭并等待确认，不会先隐藏或销毁窗口。
  用户取消时页面和请求保持不变，`update` 成功返回当前状态（mode 不一定等于请求的目标）；如果宿主为显示确认而切到前台，会重新显示并聚焦原独立窗口；不要把收到成功回复当作已经切换。
  用户确认后旧页面请求/订阅沿用 page-end 取消/清理，新文档自行恢复已保存内容并重新订阅。不会撤销已执行的操作或自动重放请求。
  活动请求本身不再触发 `busy`；同一目标已有确认、切换或重建进行中，或同一主窗口正在确认另一个 Mini App 时仍拒绝重复操作。
  An absent flag retains the native WebContentsView move behavior; host reload/crash can still end a page.

- `id` is a stable opaque string, unrelated to any Session or launch identifier. It does not change
  when the page pops out or returns to the File Panel.
- `getState()` resolves `{ mode: 'inline' }` while the page sits in the File Panel, or
  `{ mode: 'window', window: {...} }` with the current geometry and flags while popped out.
- `update(patch)` accepts a partial patch of `mode`, `width`, `height`, `x`, `y`, `visible`,
  `resizable`, `alwaysOnTop`, `clickThrough`, and `skipTaskbar`. Every field is optional and omitted
  fields are left unchanged. `frame`, `transparent`, `minWidth`, and `minHeight` can only be
  declared in the manifest's `surface.window`; a runtime patch that includes them always rejects.
  `x`/`y` are screen coordinates of the window's content area, not its outer frame.
- Changing `mode`, or calling `focus()`, requires the call to originate from a user gesture (an
  event handler where `navigator.userActivation.isActive` is still true, such as a synchronous click
  handler, or the `click` handler of a [notification](#camera-and-system-notifications) the page
  created). Without one, both reject with `not_permitted` before any Host round trip.
- Multiple `update()` calls made within the same animation frame are merged (later fields win) into
  a single Host round trip; every caller in that frame shares that frame's single outcome —
  including a shared rejection when the merged patch is rejected. A patch that changes `mode` is
  sent immediately instead, so it does not lose its user-gesture window.
- `x`/`y` are rejected with `not_permitted` when the resulting window would not overlap any current
  display. `width`/`height` are rejected with `not_permitted` when the manifest declared or the
  window is currently `resizable: false`. `alwaysOnTop: true` and `clickThrough: true` are rejected
  with `not_permitted` unless the manifest's `surface.window` already declares that field `true`;
  see [package-contract.md](package-contract.md).
- `onDidChangeState(listener)` calls `listener` with the current state after a successful `update()`
  and periodically while the state changes for another reason (for example, the user dragging or
  closing the popped-out window). It returns `{ dispose() }`; call `dispose()` to stop listening,
  such as on `pagehide`.
- Rejections are an `Error` whose `message` is one of `inline_mode`, `not_permitted`, `busy`,
  `result_unknown`, or `invalid_request`. `inline_mode` means the page is inline and the patch
  included a field other than `mode`. `busy` means a confirmation, mode switch or page rebuild is already in
  flight. `result_unknown` covers a Host-side failure or a missing reply; the actual window state at
  that point is unconfirmed. `invalid_request` covers a non-object patch, an unrecognized field, a
  wrong-typed value, a non-finite number, a `width`/`height` at or below `0` or above `10000`, or an
  `x`/`y` beyond ±100000.

### Pitfalls

| Setting or call              | Pitfall                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frame: false`               | Removes the OS title bar and its built-in drag region; without an app-defined drag region (a CSS `-webkit-app-region: drag` area) the user cannot move the window.                                                                                       |
| `transparent: true`          | Only removes the window's own background; the page's own DOM background must also be transparent (for example, a transparent `<body>`) or it will paint over the transparency.                                                                           |
| `transparent: true` | Host disables the native shadow for transparent windows (`hasShadow: false`) to avoid a gray outline around their rectangular bounds. For shadows, use CSS `box-shadow` and leave transparent padding around the content. |
| Content-driven window size | Window size stays fixed as content grows. Use `html, body { height: 100%; overflow: hidden }` and scroll inside an area such as `main { flex: 1; min-height: 0; overflow: auto }`. For a larger window, use `update({ height })`. |
| `clickThrough: true`         | Turn it on only for the specific state where the page wants to be visible but not intercept clicks (for example, a translucent overlay with margins); leaving it on the rest of the time makes the whole window unclickable, including its own controls. |
| `update({ visible: false })` | Hides the window, but the page's JavaScript keeps running; it is not equivalent to closing the page or pausing timers, network requests, or media. A hidden or minimized window counts as not visible, so the Host may put the page to sleep and reload it when the window is shown again; see [security-and-state.md](security-and-state.md#reclaim-and-restore). |
| Window title                 | Always follows the manifest's `displayName` (or `pluginId`); it cannot be changed at runtime through this handle.                                                                                                                                        |

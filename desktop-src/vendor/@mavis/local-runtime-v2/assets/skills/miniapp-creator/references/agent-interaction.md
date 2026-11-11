# Agent interaction in a Mini App

Use this reference for Page or Node Agent turns; keep other apps on their simpler path. API
signatures and permissions remain in [client-api.md](client-api.md#miniappagent) and
[runtime-api.md](runtime-api.md#agent).

## Choose the call and keep its lifetimes separate

- **Page:** feature-detect `window.mcode?.miniapp?.agent`. Render approvals and questionnaires, or
  offer `open(sessionId)` so the user can interact in the Host chat side panel.
- **Node:** call `context.agent` from a request handler after activation. Implement the page's
  business routes and any progress transport yourself; ordinary HTTP responses or polling are
  sufficient. Use SSE/WebSocket only when the product needs streaming.
- **One call:** `run` or `answer` owns an execution-busy state until its promise settles. A resolved
  `error`/`aborted` result and a rejected promise both release that state in `finally`. A
  questionnaire can remain pending after execution ends; render it as an interaction state and start
  `answer` only after the paused call settles. A `question.requested` callback is not that
  completion point.
- **Connection:** an open SSE connection does not mean an Agent call is running. Closing a local
  subscription ends progress visibility; recover the stored outcome or explicitly cancel execution.
- **Service:** the Node listener stays alive across calls. Its `dispose()` closes all resources
  owned by the app; see [node-entry.mjs](node-entry.mjs). It is not a per-turn completion handler.
- **Delegated work:** a root turn can finish while a background child still runs or waits for
  approval. If this call must return the child's result, put foreground delegation in the actual
  business request (for `task`, request `run_in_background: false`). Do not treat a root turn's
  `finished` status as proof that every child or the whole workflow completed.

Preserve the root `sessionId` from the run result or root `turn.started` event for continuation and
`open`. Keep it when clearing output or starting another turn. A delegated permission request can
name a child session: use that event's IDs only to `reply`, without replacing the root ID or
filtering out the child ask. Creating a new session is an explicit action that omits the root ID.

## Page call state pattern

Copy [client-api.ts](client-api.ts) for type checking; bind `agent` after feature detection. The
declared UI hooks are app code: render questionnaire steps and collect user decisions. Wire New to
`run(text, true)`, Continue to `run(text)`, and Answer to `answer(answers)` from the form.

```ts
import type {
  MiniAppAgentAPI,
  MiniAppAgentRunEvent,
  MiniAppAgentRunResult,
  MiniAppAgentQuestionnaire,
  MiniAppAgentQuestionAnswer,
} from './client-api.js';

declare const agent: MiniAppAgentAPI;
declare const buttons: Record<'new' | 'continue' | 'answer' | 'cancel' | 'open', HTMLButtonElement>;
declare function showEvent(event: MiniAppAgentRunEvent): void;
declare function showResult(result: MiniAppAgentRunResult): void;
declare function showQuestion(request: MiniAppAgentQuestionnaire | undefined): void;
declare function showFailure(error: unknown): void;
declare function choosePermission(
  event: Extract<MiniAppAgentRunEvent, { type: 'permission.requested' }>,
): Promise<'allowOnce' | 'deny'>;

let rootSessionId: string | undefined;
let activeRequestId: string | undefined;
let pending: MiniAppAgentRunResult['pendingQuestion'];

function refreshControls() {
  const busy = activeRequestId !== undefined;
  buttons.new.disabled = busy;
  buttons.continue.disabled = busy || !rootSessionId || !!pending;
  buttons.answer.disabled = busy || !pending;
  buttons.cancel.disabled = !busy;
  buttons.open.disabled = !rootSessionId;
}

async function call(
  invoke: (
    id: string,
    onEvent: (event: MiniAppAgentRunEvent) => void,
  ) => Promise<MiniAppAgentRunResult>,
) {
  if (activeRequestId) return;
  const id = crypto.randomUUID(); // A new cancellation ID for every run or answer.
  activeRequestId = id;
  const onEvent = (event: MiniAppAgentRunEvent) => {
    if (event.type === 'turn.started') {
      rootSessionId = event.sessionId;
      refreshControls(); // Open works during the first run, including an approval wait.
    }
    showEvent(event);
    if (event.type === 'permission.requested') {
      void choosePermission(event)
        .then((decision) =>
          agent.reply({ sessionId: event.sessionId, requestId: event.requestId, decision }),
        )
        .catch((error) => {
          showFailure(error);
          if (activeRequestId === id) agent.cancel(id);
        });
    }
  };
  try {
    refreshControls(); // The cancellation ID exists before Cancel becomes available or dispatch starts.
    const result = await invoke(id, onEvent);
    rootSessionId = result.sessionId;
    pending = result.pendingQuestion;
    showResult(result);
    showQuestion(pending?.request);
  } catch (error) {
    showFailure(error); // result_unknown needs reconciliation, not an automatic retry.
  } finally {
    activeRequestId = undefined;
    refreshControls();
  }
}

function run(text: string, newSession = false) {
  if (activeRequestId || (!newSession && (!rootSessionId || pending))) return;
  if (newSession) {
    rootSessionId = undefined;
    pending = undefined;
    showQuestion(undefined);
  }
  const sessionId = rootSessionId;
  return call((requestId, onEvent) => agent.run({ text, sessionId, requestId }, { onEvent }));
}

function answer(answers: readonly MiniAppAgentQuestionAnswer[]) {
  const question = pending;
  const sessionId = rootSessionId;
  if (!question || !sessionId) return;
  return call((requestId, onEvent) =>
    agent.answer({ sessionId, questionId: question.requestId, answers, requestId }, { onEvent }),
  );
}

buttons.cancel.onclick = () => {
  if (activeRequestId) agent.cancel(activeRequestId);
};
buttons.open.onclick = () => {
  if (rootSessionId) void agent.open(rootSessionId).catch(showFailure);
};
refreshControls();
```

Each answer gets its own cancellation ID. After the call settles, render any pending question,
release execution-busy, and keep unanswered child approvals separate from root execution state.
Remove an approval after its reply succeeds or the Host confirms it is no longer pending; do not
clear all approvals merely because the root call settled. Keep session identity through local UI
resets; reconcile an unknown outcome before asking again.

## Node event, result, and completion pattern

Copy [miniapp-api.ts](miniapp-api.ts) beside Node code. The app owns `conversation`, routes, user
replies, and the optional `publish` transport. Retain a bounded history of settled results for
recovery; use `context.dataDir` if it must survive a process restart.

```ts
import { randomUUID } from 'node:crypto';
import type {
  MiniAppAgentClient,
  MiniAppAgentRunOptions,
  MiniAppAgentRunEvent,
  MiniAppAgentRunResult,
  MiniAppAgentQuestionAnswer,
} from './miniapp-api.js';

type Conversation = {
  rootSessionId?: string;
  busy: boolean;
  pending?: MiniAppAgentRunResult['pendingQuestion'];
};
type Input =
  | { kind: 'run'; text: string }
  | { kind: 'answer'; answers: readonly MiniAppAgentQuestionAnswer[] };
type Update =
  | { kind: 'agent-event'; callId: string; event: MiniAppAgentRunEvent }
  | { kind: 'call-settled'; callId: string };
type CallRecord = {
  controller: AbortController;
  busy: boolean;
  result?: MiniAppAgentRunResult;
  failureCode?: string;
};
const calls = new Map<string, CallRecord>();

function startNodeCall(
  agent: MiniAppAgentClient,
  conversation: Conversation,
  input: Input,
  publish?: (update: Update) => void,
) {
  if (conversation.busy) throw new Error('app_busy');
  const callId = randomUUID(); // Return this app ID to the page; it is not a permission request ID.
  const record: CallRecord = { controller: new AbortController(), busy: true };
  calls.set(callId, record);
  conversation.busy = true;
  const notify = (update: Update) => {
    try {
      publish?.(update);
    } catch {
      /* A transport failure does not change the Agent outcome. */
    }
  };
  const onEvent = (event: MiniAppAgentRunEvent) => {
    if (event.type === 'turn.started') conversation.rootSessionId = event.sessionId;
    notify({ kind: 'agent-event', callId, event }); // Preserve real SDK events and their IDs.
  };
  const options: MiniAppAgentRunOptions = {
    signal: record.controller.signal,
    ...(publish ? { onEvent } : {}),
  };
  void (async () => {
    try {
      let result: MiniAppAgentRunResult;
      if (input.kind === 'run') {
        result = await agent.run(
          { text: input.text, sessionId: conversation.rootSessionId },
          options,
        );
      } else {
        const question = conversation.pending;
        const sessionId = conversation.rootSessionId;
        if (!question || !sessionId) throw new Error('app_no_pending_question');
        result = await agent.answer(
          { sessionId, requestId: question.requestId, answers: input.answers },
          options,
        );
      }
      record.result = result; // Retain finished/error/aborted and pendingQuestion, even without onEvent.
      conversation.rootSessionId = result.sessionId;
      conversation.pending = result.pendingQuestion;
    } catch (error) {
      record.failureCode =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'app_call_failed';
    } finally {
      record.busy = false;
      conversation.busy = false;
      notify({ kind: 'call-settled', callId }); // Local completion; never fabricate turn.finished.
    }
  })();
  return callId;
}

function readCall(callId: string) {
  const record = calls.get(callId);
  return record && { busy: record.busy, result: record.result, failureCode: record.failureCode };
}
function cancelCall(callId: string) {
  calls.get(callId)?.controller.abort();
}
```

Expose snapshots through a narrow route that validates call ownership. On `call-settled` or a
reconnect, read the snapshot and release execution-busy independently of the connection. Process
`result.pendingQuestion` before `answer`, including without `onEvent`. Preserve the root ID on
continuation; start a new conversation only for an explicit New action.

With `publish`, route permission events to user decisions and `context.agent.reply` with the event's
IDs. Omitting it omits `onEvent`; follow [the no-listener rules](runtime-api.md#interaction),
including the host-chat exception. Local subscription closure does not remove a Host observer: show
a connection state, retain recovery, and offer explicit `cancelCall`. A rejection is a local API
failure; reconcile `AGENT_OUTCOME_UNKNOWN`. Forward SDK terminal events unchanged, keep app
notifications separate, and keep the Node service available after each call.

The SDK observer lasts for one `run` or `answer`, not the lifetime of background child tasks. An
already observed child approval can still be replied to with its own IDs after the root settles;
`REQUEST_NOT_FOUND` means that request is no longer pending. Keep that card usable until a reply or
such a reconciliation, without keeping the root execution-busy. There is no general background-task
subscription in these APIs: if the product intentionally uses background delegation, design its
supported follow-up and recovery before promising automatic child results. A local SSE reconnect
cannot restore an SDK observer that ended with the root call. Follow the task tool's completion
and continuation contract; do not invent a terminal event to turn an incomplete workflow into success.

## Follow-up messages while a turn runs

A chat-style app (a bot relaying chat messages, a page with a chat box) receives new text while
its session is still running a turn. Do not serialize those messages yourself; pass `whenBusy` and
let the Host apply the Desktop composer's behaviour:

```ts
// One call per incoming message; several may be in flight for the same session.
async function onChatMessage(sessionId: string, text: string, changesCurrentWork: boolean) {
  const result = await context.agent.run(
    { sessionId, text, whenBusy: changesCurrentWork ? 'steer' : 'queue' },
    { onEvent },
  );
  // A steered text was read by the running turn; that turn's own call posts the reply.
  if (result.status === 'steered') return;
  await postToChat(result.text ?? `Agent ended: ${result.status}`);
}
```

- Default to `'queue'`: every message gets its own turn and its own reply, in order.
- Use `'steer'` for text meant to change the work in progress ("use Chinese", "skip that file").
  Show `message.pending` as "waiting to be read" and `message.steered` as "delivered to the current
  task". If the running turn answers first, the text becomes the next turn and the call returns its
  reply like `'queue'`.
- A steered text cannot be withdrawn. Cancelling a queued one removes it from the queue.
- Each call keeps its own execution-busy state; the session-level state is "a turn is running" until
  the last call settles. Permission and question events of the running turn go to the call that
  started it, so keep handling them there.
- If the user stopped the session while messages were queued, new `whenBusy` calls wait behind them
  until the user resumes the queue or sends from the chat, and each keeps its run slot meanwhile;
  cancel them to free the slots.

## Pass the complete business request

Put the task, data scope, required interaction, success criteria, and stop conditions in `text`.
Labels, form state, comments, and the surrounding Host chat are not automatically copied into the
request. Continuation retains its own conversation; send new constraints explicitly. Prompts
describe intent; manifest grants and Host permissions remain the authority for data/tool access.

For a stop-on-denial workflow, send “If that read is denied, report the denial and end this
workflow.” `reply(..., decision: 'deny')` settles that tool request, not every future access to the
file. Render later requests honestly; use enforceable Host permission or Hook rules for boundaries
that must hold across calls. One denied card proves neither a file-wide policy nor model compliance.

## Observing the user's sessions

`agent.observe`, `agent.sessions` and `agent.session` let a board follow the user's own
conversations, for example a status wall of running tasks or a digest of finished replies. This is
sensitive: with `agentAccess: ["session.read"]` the Mini App reads the final reply of every turn in
every user conversation, and list titles and statuses. Declare it only when that is the board's
purpose, say so in the package description, and keep what you read out of logs and remote services
unless the user asked for it. The user can switch `session.read` off in the plugin details: running
observers end at once, and reads and new observers answer `NOT_PERMITTED` (`not_permitted` on the
page) until it is switched back on. The Mini App keeps running, so show an in-board explanation
instead of failing.

- **Discover, then watch:** `sessions()` resolves with `{ sessions }`, the 50 most recently updated
  conversations (scheduled runs, other Mini Apps' sessions and sub-Agent sessions are left out),
  each with its project directory (`workspaceDir`, `isDefaultWorkspace`) for grouping by project;
  `session(sessionId)` adds the model, a failed session's error and the latest reply. On the page,
  `session()` without an id reads the chat the page is open in (`undefined` outside a chat); Node
  needs the id, so a page hands it over. `observe({ all: true }, { onEvent })` reports
  `turn.started` / `message.committed` / `turn.finished` of every user conversation, each with
  `sessionId` and the conversation's `title` when it has one. `observe({ sessionId }, { onEvent })`
  reports one conversation in full, turn after turn. Pass exactly one target, on the page and in
  Node alike; anything else is `INVALID_ARGUMENTS` (`invalid_request` on the page).
- **Model:** an observer's `turn.started` carries `model` when the Host could read it; unlike a
  run's, it may be absent.
- **Delivery:** every observed turn gets its `turn.started` and `turn.finished`. When Node falls
  behind, `text.delta` and `tool.*` events may be dropped, never the start, the final reply or the
  finish; the one exception is an event over the 8 MiB frame limit, which is dropped and logged on
  the Host. A `turn.finished` without `text` means the Host could not read the final reply; read
  `session()` if you need it.
- **Read-only:** an observer never receives asks and never answers them; it cannot reply, answer
  or continue the user's conversation. `session.read` does not grant `session.run`.
- **Own sessions:** a Mini App's own sessions are not in the list, but `session.run` alone may
  `session()` or `observe({ sessionId })` them, for example to follow a turn started by another page.
- **Lifetime:** `observe` resolves when the subscription ends: you stopped it (Node: abort its
  `signal`; page: `cancel(requestId)` with the `requestId` you passed), the session was deleted,
  the Mini App stopped, or `session.read` was switched off. It rejects when it could not start
  (`BUSY` past 4 observers per Mini App, `NOT_PERMITTED`, `SESSION_NOT_FOUND`). Keep it in the
  component or service that renders it and stop it when that goes away. Re-subscribe after a
  reload; missed events are not replayed, so refresh with `session()` first.
- **Older Hosts:** check `capabilities?.has('agent.observe')` before calling. A Host that predates
  `session.read` rejects the whole package when the manifest declares it, so declare it together
  with an `engines` bound when the package must say why it does not load there (see
  [package-contract.md](package-contract.md)).

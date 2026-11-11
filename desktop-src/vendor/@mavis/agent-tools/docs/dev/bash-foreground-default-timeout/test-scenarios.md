# Test Scenarios — Foreground local bash default timeout

Run slug: `bash-foreground-default-timeout`
Owning package: `@mavis/agent-tools` (`packages/agent-tools`)
Base: `origin/preview_train` · Branch: `hotfix/bash-foreground-default-timeout`

## Context

Foreground local bash commands run **unbounded** when the model omits `timeout`.
`LocalBashToolDef` advertises `timeout` default as "host-defined"
(`packages/agent-tools/src/desktop/builtin-defs.ts:98`) but no host default is
supplied — `LocalBashTool` calls `createBashTool(workspaceRoot)` with no options
and the vendored executor only arms a timer when a `timeout` is passed. Result:
interactive/blocking commands (e.g. `lark-cli auth login`) hang forever in
"运行中". main's old executor defaulted to 120s.

## Approved decisions (Step 1)

1. Inject the default at the wiring layer (`LocalBashTool.execute`), vendored
   `third_party/.../bash.ts` untouched.
2. Default `120` seconds when `timeout` omitted; explicit `timeout` passed
   through **uncapped**.
3. Foreground local only (`run_in_background !== true`); background + cloud
   unchanged.
4. Reuse the vendored timeout path → `killProcessTree` + error
   `"Command timed out after N seconds"`.
5. (amendment) Update the desktop `LocalBashToolDef` `timeout` description so it
   no longer says "host-defined"; cloud/agent-core defs keep "host-defined".

## Design / testability note

`LocalBashTool` builds its inner tool via `createBashTool(workspaceRoot)`, whose
operations spawn a real child process. Asserting "the default that reaches the
operations layer" through that seam would require spawning real sleep processes
(slow, timing-flaky at 120s). To keep the interface the test surface without a
120s real wait, implementation SHOULD make the injected default value assertable
without executing a long real command — e.g. extract the coalescing into a small
pure helper (`resolveForegroundTimeout(input)`) that the test can call directly,
**or** make `LocalBashTool` accept an injectable operations/tool factory so a
fake can capture the forwarded `timeout`. Prefer the pure-helper seam: smallest
surface, no new constructor param. The named constant
`DEFAULT_FOREGROUND_BASH_TIMEOUT_SECONDS = 120` must be exported or reachable for
assertion.

## Scenarios

| ID | Scenario | Given / When / Then | Type | Priority | Status | Evidence |
|---|---|---|---|---|---|---|
| TS-1 | Omitted timeout → 120s default | Given foreground input with no `timeout` / When timeout is resolved / Then it equals `DEFAULT_FOREGROUND_BASH_TIMEOUT_SECONDS` (120) | unit | P0 | covered | `local-bash-timeout.test.ts` › `resolveForegroundTimeout` › defaults to 120 seconds when timeout is omitted / when explicitly undefined |
| TS-2 | Explicit timeout honored, uncapped | Given foreground input `timeout: 5` (and separately `timeout: 100000`) / When resolved / Then the exact value is used, no 120 substitution and no cap | unit | P0 | covered | `local-bash-timeout.test.ts` › `resolveForegroundTimeout` › honors an explicit timeout exactly (+ preserves explicit `0` via `??`) |
| TS-3 | Background path not defaulted | Given input `run_in_background: true` (no `timeout`) / When executed / Then the 120s default is NOT applied and it dispatches to the background adapter | unit | P0 | covered | `local-bash-timeout.test.ts` › background path › dispatches to the background adapter without injecting the 120s default |
| TS-4 | run_in_background not leaked forward | Given foreground input that had `run_in_background` stripped / When forwarded to the inner tool / Then forwarded input carries resolved `timeout` and NO `run_in_background` key | unit | P1 | covered | `local-bash-timeout.test.ts` › foreground path forwarding (TS-4) › forwards resolved timeout / forwards explicit timeout, both strip `run_in_background` |
| TS-5 | Fast foreground command unaffected | Given a foreground command that exits well under 120s and no `timeout` / When executed against real ops / Then it completes normally with real output (no timeout error) | integration | P1 | covered | `local-bash-timeout.test.ts` › real foreground ops › runs a fast foreground command with no timeout (`echo hi` in temp workspace) |
| TS-6 | Timeout-hit error text reused | Given the vendored executor throws `timeout:120` / When surfaced by the wiring layer / Then the error reads `Command timed out after N seconds` (no custom wording) | unit | P1 | covered | `local-bash-timeout.test.ts` › real foreground ops › surfaces the vendored "Command timed out after N seconds" (fast `sleep 5` + `timeout: 1` to stay non-flaky) |
| TS-7 | Def description updated | Given `LocalBashToolDef.schema` / When inspecting the `timeout` description / Then it states the 120s foreground default and no longer says "host-defined"; cloud + agent-core defs still say "host-defined" | unit | P2 | covered | `local-bash-timeout.test.ts` › `LocalBashToolDef timeout description (TS-7)` › local no longer says host-defined & mentions 120/foreground; cloud + agent-core still say host-defined |
| TS-8 | Vendored bash.ts zero diff | Given the branch diff / When inspecting `third_party/pi-mono/.../tools/bash.ts` / Then there is no change | guard | P2 | covered | `local-bash-timeout.test.ts` › vendored bash.ts untouched (TS-8) via `git diff`; also `git diff --stat -- third_party/.../bash.ts` empty |

## Out of scope

Cloud/sandbox timeout; `local-runtime/bash-runner.ts` background path; PTY /
interactive-stdin support (the deeper "can't run interactive commands" issue).

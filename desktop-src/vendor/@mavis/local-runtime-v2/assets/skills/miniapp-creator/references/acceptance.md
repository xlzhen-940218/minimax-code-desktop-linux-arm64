# Lightweight Mini App acceptance

This is a delivery gate for the Mini App Client. It supplements rather than replaces Host package
contracts, runtime readiness, publication transactions, and security boundaries. It does not change
the repository's UI standards or require a new E2E framework or screenshot baseline.

## 1. Entry conditions and evidence

Begin only after successful `publish`, then `inspect`, then `open`. `miniapp.inspect` provides a
lifecycle summary, not page inspection; page evidence must come from the opened Browser surface.

First load the complete current Browser Skill through the
[Browser page operations entry](../SKILL.md#browser-page-operations). Then use the `mcp_browser` tool
exposed in this turn to perform `inspect`, necessary `query` calls, one visual screenshot, and a
representative interaction in the current Mini App Browser tab provided by the runtime. Screenshots
are acceptance evidence; they do not change Browser action success semantics or automatically
become user-deliverable attachments.

If `open` returns `OPEN_UNAVAILABLE`, or the required Skill, `mcp_browser` tool, or Browser surface
is missing, complete available candidate checks and mark Client UI acceptance `UNVERIFIED`.
Do not fabricate screenshots or report PASS.

## 2. Required checks

### A. Initial view and structure (must PASS)

- The page is not blank, an error page, or indefinitely loading. Its title, core content, and main
  actions are visible in the initial view.
- `inspect` finds meaningful landmarks, headings, operable controls, and readable names. Use
  semantic elements for tables, forms, and state areas instead of presentation-only markup.
- Avoid meaningless horizontal page overflow. Content remains readable in a narrow viewport;
  tables may scroll within their own container or switch to cards when necessary.

### B. Visual baseline (must PASS)

- Use `minimax-code-visual-ui.md` as the default baseline. An explicitly requested style overrides
  only directly conflicting visual decisions.
- Use one `screenshot` to inspect initial hierarchy, spacing, surfaces, buttons, labels, icons, and
  theme contrast. If an action already provides `visualObservation.available: true` covering the
  target state, use that image rather than taking another screenshot.
- No blank page, missing icons, meaningless black blocks, excessive gradients or shadows, or
  controls disappearing into their background. Judge against the current page and baseline;
  pixel-level screenshot diffs are not required.

### C. States and interaction (must PASS where applicable)

- Where the page has `loading`, `working`, `empty`, or `error` states, check the initial state and
  at least one other safely reachable state. Preserve the page structure and provide understandable
  text or ARIA semantics.
- For theme switching, filters, overlays, forms, or primary actions, perform a representative
  interaction and repeat `inspect` or `query` to verify a visible change. If theme switching exists,
  check text, controls, and boundaries in both light and dark themes.
- Controls are keyboard-accessible, have visible focus and an `aria-label` or visible name.
  State must not be conveyed by color alone.

### D. Runtime diagnostics (must PASS where applicable)

- For external data, exercise a business read from the page to verify access from the actual Node
  service. This applies to CLIs, APIs, SDKs, files, and Connectors. Follow
  [data-access.md](data-access.md) to distinguish Agent probes from runtime evidence; startup success
  alone does not prove data availability. Mark writes not authorized for live testing `UNVERIFIED`.
- Query the current page's `console` for errors and uncaught exceptions. Errors affecting the
  initial view or interaction are FAIL.
- If the page depends on requests or shows an empty/error state, query `network` for failed, 4xx,
  and 5xx requests. Unexplained critical failures are FAIL. A valid empty business result is not
  a network failure.

### E. Agent interactions (must PASS for the paths the product uses)

For a product using `context.agent` or `window.mcode.miniapp.agent`, follow
[agent-interaction.md](agent-interaction.md) and check the applicable rows below. Use synthetic
inputs and files for local checks. Exercise only business actions authorized by the user; keep
questionnaire choices and permission decisions with the user when the workflow requires them. If the
user defers these interactions to manual testing, mark those rows `UNVERIFIED` and hand over the
opened page with the pending checks.

| Implemented path                   | Observable evidence                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run and completion                 | On the first call, cancel becomes usable once its request ID exists and open becomes usable once the root session ID arrives. After success, error, or abort, busy clears and another call can start. The result and event history remain readable.                                                                                        |
| Cancel                             | Cancel targets the current run or answer, including after questionnaire continuation. The call settles, its real terminal event remains last when events are observed, and the session can run again.                                                                                                                                      |
| New, continue, and open            | New omits the old root session ID and produces a different root. Continue sends the stored root session ID and gets a new turn ID in that same session. Open displays the root shown for the active mode, including a Node-created root if the product offers it.                                                                            |
| Questionnaire                      | Show the actual request. Submit after the paused run returns; answer starts a new turn, displays its result, and restores controls when it settles.                                                                                                                                                                                        |
| Permissions and delegated children | Show the actual tool and reason, and send the selected decision with the event's session ID and request ID. A child approval keeps its child IDs while root open and continuation keep the root ID.                                                                                                                                        |
| Delegated completion               | A result-dependent task requests foreground delegation and returns the child's actual result. If background delegation is implemented, delay a child approval past root completion: the unresolved card stays usable, root busy clears, and the UI does not claim child success or recover a terminated SDK observer by reconnecting local SSE. |
| Node events or no-event mode       | Event mode forwards real events and also delivers the settled result. No-event mode omits `onEvent` and handles `result.pendingQuestion`. The completed UI does not depend on the Node service or a persistent transport connection ending.                                                                                                |
| Local subscription loss            | The page reports loss of observation separately from Agent outcome. It can recover the stored result or offer an authorized cancel; it records SDK terminal events only when actually received.                                                                                                                                            |
| Business instructions and refusal  | Inspect the text actually passed to `run`, including scope, allowed actions, refusal behavior, and expected output. If the product requires stopping after denial, verify that condition was sent and that the observed tool sequence satisfies it. A denied tool call alone does not prove that every alternative access path is blocked. |

For a live Agent check, record the actual session/turn IDs, returned status, relevant event
sequence, and control state. Source inspection can verify prompt construction and declared transport
behavior, but cannot establish real model behavior. Keep checks not exercised as `UNVERIFIED`.

## 3. Results and recovery

Record each item as `PASS`, `FAIL`, or `UNVERIFIED`, keeping minimal evidence: page structure,
representative interaction results, relevant console/network summaries, and screenshot availability.

- If a required check fails, edit only the workspace package returned by the current `miniapp.init`,
  publish again, then repeat `inspect`, `open`, and this acceptance flow. Do not edit private copies
  of the accepted package to bypass acceptance.
- If only the Browser surface or an external dependency is unavailable, mark `UNVERIFIED` and
  report the blocker and uncovered risk. Do not repeatedly retry calls whose prerequisites remain
  unmet.
- Claim Mini App UI acceptance only after all required checks PASS. Continue reporting unverified
  data access, external dependencies on the local machine, or user manual-test paths.

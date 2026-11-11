# Creator GenUI enhancement decision

Use this recipe to ask whether an already business-ready local Plugin should receive a derived
GenUI Visualizer. This is a Creator-owned conversation surface, not a Skill or component installed
into the user's Plugin.

## Preconditions

Render the decision only after the base Plugin is valid, text-capable, and recognized by Desktop,
and only when the user has not already selected or declined an enhancement path. Finish every file,
tool, validation, and refresh operation before emitting the decision because the complete Widget
must be in the final assistant message and no tool may be called after it.

This built-in Creator runs in MiniMax Code Desktop. Treat `mavis.widget.v1` rendering and
`sendPrompt` as available by default and use the Widget path. Before composing CSS, read
`references/genui-widget/references/color-system.md` completely and read the sibling
`genui-widget/SKILL.md` through its `Theme safety gate`. If a read result reports more lines, continue
from the next offset until the complete required section or file has been loaded. Do not infer that
the Host is unavailable merely because the Agent describes its own execution environment as CLI,
shell, Mavis, or another internal runtime label. Only an explicit negative capability in the current
`agent-context` permits direct text fallback. The Widget still embeds the text fallback so the Host
can degrade safely if rendering fails.

The model remains free to generate the layout, visual hierarchy, component composition, and
interaction presentation from the inspected business flow. Theme safety is a semantic contract, not
a reusable HTML or CSS decision template.

## Decision data

Ground the Widget in one object with this conceptual shape:

```json
{
  "plugin": { "name": "daily-review", "displayName": "每日复盘", "version": "0.1.0" },
  "recommendation": "recommended",
  "reason": "The result has repeated structured records and a clear follow-up action.",
  "businessFlow": ["collect events", "classify", "summarize", "suggest next action"],
  "ownership": { "mode": "in-place", "destination": "{{DATA_DIR}}/plugins/daily-review" },
  "opportunities": [
    {
      "id": "weekly-patterns",
      "businessStep": "summarize",
      "widgetKind": "dashboard",
      "decisionValue": "See repeated themes and choose the next action",
      "sourceFields": ["category", "frequency", "impact", "suggestion"],
      "interaction": "Select a theme for a focused follow-up",
      "textFallback": "Ranked themes and next actions"
    }
  ]
}
```

Use truthful values from the completed Plugin analysis. Do not invent data sources or preview
metrics. Apply these two mutually exclusive branches:

- `recommended`: render one to three opportunity cards and all three actions.
- `not recommended`: render zero opportunity cards, omit `Implement now`, explain why text is the
  better result surface, make `Keep the current Plugin` primary, and retain `Review the design` only
  for a user who wants to inspect the trade-off.

Do not ask an unrelated follow-up question in this turn. Questions about sharing, publishing,
branding, or another feature wait until this decision is resolved.

## Widget contract

Emit exactly one final Widget with these opening-tag semantics:

```text
version="mavis.widget.v1"
kind="form"
capabilities="resize,sendPrompt"
streaming="html-first"
theme="app"
token-set="mavis.semantic.v1"
```

Use a compact decision-card layout in this order:

1. A ready-state header with Plugin display name and version.
2. A `recommended` or `not recommended` badge and one-sentence reason.
3. A compact business-flow summary and ownership destination.
4. For `recommended` only, one to three radio-style opportunity cards showing business step,
   Widget kind, decision value, and required source fields.
5. A visible action row with the branch-specific actions.

The closing `</mavis-widget>` is the end of the response. Do not append status prose, a code
fence, another Widget, or a tool call after it.

No choice is selected by default. Keep `Implement now` disabled until the user selects one
opportunity. `Review the design` uses the currently selected opportunity when present, or asks the
Creator to review all candidates only when none is selected. Use accessible labels, keyboard-focus
styles, and a live selection summary. Local selection changes remain inside the iframe and never
send a message.

The Widget `<mavis-meta>` must declare the visible interactions, their `sendPrompt` capability, the
Plugin identity, recommendation, ownership, and conversation language. Keep all user-visible copy,
`sendPrompt` text, and `metadata.userIntent` in the conversation language.

## Actions and authorization

Bind buttons with `addEventListener`; never use inline handlers or `window.mavis.submitForm`.
Each click calls `window.mavis.sendPrompt(text, metadata)` exactly once:

- action: `implement-now`
  - Visible only for `recommended` and only enabled with a selected opportunity.
  - Text meaning: explicitly confirm GenUI implementation for the named Plugin and selected
    opportunity now.
  - `selectedData`: Plugin identity, version, ownership, and the selected opportunity object.
  - `userIntent`: explicit current authorization to implement the selected GenUI enhancement.
- action: `review-design`
  - Text meaning: request a design review for the selected opportunity, or all candidates when none
    is selected, without writing files.
  - `selectedData`: Plugin identity plus the selected opportunity or candidate list.
  - `userIntent`: review GenUI design without modifying the Plugin.
  - When `selectedData` includes one selected opportunity, review exactly that opportunity and do
    not expand unselected candidates. Use the all-candidates scope only when the payload explicitly
    carries that scope.
  - Keep a selected-opportunity design review compact: cover its data contract, visible components,
    interactions, normal/loading/empty/error states, and implementation boundary. Do not emit a
    second decision Widget from the design-review turn; the original decision Widget remains the
    place to choose `Implement now` or `Keep the current Plugin`.
- action: `keep-current-plugin`
  - Text meaning: keep the current text-capable Plugin and do not create GenUI files.
  - `selectedData`: Plugin identity and recommendation.
  - `userIntent`: decline the current GenUI enhancement.

A radio selection, button hover, or other iframe-local state does not become authorization until
its `sendPrompt` produces a new user message in the conversation. The Creator must re-read that
message before taking the selected branch. Never auto-send, synthesize a user click, or treat
Widget rendering itself as consent.

## Text fallback

Put a complete localized fallback inside `<mavis-fallback>`. When the Host cannot render the Widget,
use the same text as the assistant response.

For `recommended`:

```text
### Optional GenUI enhancement
Recommendation: recommended — <reason>
Business flow: <inspected result-producing steps>
Ownership: in-place | local fork — <destination>
Opportunities:
1. <business step> -> <Widget kind>: <decision value>; source: <fields and provenance>
Choose:
- Implement now — implement the selected opportunity after explicit confirmation.
- Review the design — review components, data, states, and interactions without files.
- Keep the current Plugin — keep the valid text-capable Plugin.
```

For `not recommended`:

```text
### Optional GenUI enhancement
Recommendation: not recommended — <why text is clearer>
Business flow: <inspected result-producing steps>
Ownership: in-place | local fork — <destination>
Opportunities: none
Choose:
- Keep the current Plugin — recommended; keep the valid text-capable Plugin.
- Review the design — inspect the trade-off without writing files.
```

Do not duplicate this fallback as a second long Markdown analysis when the Widget renders. Outside
the Widget, use at most one short sentence saying that the Plugin is ready and the decision is
available below.

## Acceptance checks

Before emitting the final Widget, verify:

- the recommendation and opportunity count use one valid branch;
- every displayed source field exists in the business flow;
- every `--mw-*` reference belongs to the host-defined token list in the `Theme safety gate`;
- no `var(--mw-*)` call has a fallback value and no theme-sensitive background, text, border, SVG,
  chart, hover, focus, selected, or disabled state uses a fixed light or dark palette;
- `Implement now` has no default opportunity and cannot fire without an explicit selection;
- all visible actions have matching `mavis-meta` interactions and one `sendPrompt` handler;
- action text and `userIntent` match the conversation language;
- there is no `submitForm`, hidden auto-send, unrelated question, Plugin file write, or duplicated
  Markdown analysis;
- the fallback preserves the same actions and authorization boundary.

# Business-specific GenUI Visualizer workflow

Use this workflow only as an optional post-creation enhancement. It turns an already working
business Plugin into a self-contained Plugin that can also render business results with the
`mavis.widget.v1` contract.

## Business-ready checkpoint

Reach this checkpoint before creating any visualization files:

1. The base local Plugin manifest and all declared MCP, Skill, and Hook capabilities are complete.
2. The business flow can obtain and explain its result without GenUI.
3. The local Plugin manifest and every referenced MCP/Skill/Hook file pass the Creator's local
   validation, and MiniMax Code Desktop recognizes the package without scan diagnostics.

Offer the enhancement when the user requests it or when the completed flow returns structured data
that is materially clearer as a chart, dashboard, map, diagram, interactive control, form, or
mockup. Do not add a widget merely to decorate prose. If the user declines, required business
semantics are missing, or Widget authoring fails, keep and report the business-ready Plugin; GenUI
must not become a blocker for the base capability.

Do not leave a partial Visualizer enabled. If enhancement work has made the package invalid, restore
the base-only manifest and business-Skill composition, then rerun local Plugin validation and verify
Desktop recognition before reporting the valid business Plugin and the unfinished enhancement
separately.

Do not register the bundled `genui-widget` foundation as a generic local Plugin capability. It is
authoring material used to create a user-owned business Visualizer.

## Apply the post-creation decision contract

Use the completed business Plugin as the unit of analysis, whether it was created in the current
conversation or already existed. A request for a text-only first version means that the base result
must stay independent and no Widget files should be authored yet; it does not remove the optional
post-creation decision.

Build a short candidate matrix before proposing an enhancement:

| Candidate         | Record                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Business position | Trigger, result-producing step, and decision or action supported                           |
| Data contract     | Required fields, identifiers, units, provenance, and missing-data behavior                 |
| Visual form       | Smallest useful Widget kind and why text alone is harder to use                            |
| Behavior          | Local interactions, optional reasoning follow-up, and text fallback                        |
| Boundaries        | Auth, permission, loading, empty, error, sensitivity, and Host limitations                 |
| Ownership         | In-place for a user-owned writable local Plugin; local fork for official/read-only content |

Recommend at most three high-value candidates. Use `not recommended` when the result is mostly
narrative, too small, too uncertain, too sensitive, or already clearer as text. State the evidence
for that conclusion instead of manufacturing a visualization opportunity.

Do not create GenUI files merely because the audit found a candidate. Present the candidate and wait
until the user explicitly selects one of the three semantic paths from the Creator: `Implement now`,
`Review the design`, or `Keep the current Plugin`. `Review the design` returns the proposed source
schema, component recipe, states, interactions, ownership, and validation plan without editing the
Plugin. Only `Implement now` or a current, explicit request to implement GenUI now authorizes the
derived-Skill files. Merely mentioning GenUI, choosing text-only output, asking for design review,
or deferring implementation does not count as implementation authorization; the latest and most
specific constraint wins. For `Keep the current Plugin`, leave the valid business package unchanged.

## Resolve the writable destination

Resolve the ownership decision before copying or editing files:

- For `in-place`, verify that the target is a user-owned local Plugin under `{{DATA_DIR}}/plugins/`
  and is writable, then keep changes scoped to that Plugin.
- For `local fork`, create or choose a user-owned local Plugin under `{{DATA_DIR}}/plugins/` with a
  non-conflicting identity. Copy the required business capability into that writable destination and
  record the source Plugin name and version in the fork's authoring references. Create the
  Visualizer and update composition only inside the fork.

Never modify the official, installed, or read-only source Plugin. If the active Desktop data
directory, machine-readable fork name, or other required fork metadata is unavailable, stop and
request it. Do not invent a writable location or silently turn the installed source package into the
fork.

## Read the complete foundation

Before designing the Visualizer, read all of:

- `genui-widget/SKILL.md`
- `genui-widget/references/color-system.md`
- `genui-widget/references/visual-rules.md`
- `genui-widget/references/widget-patterns.md`
- `genui-widget/references/widget-recipes.md`

Treat the foundation's DSL, theme, security, data, fallback, and interaction rules as a single
contract. Do not copy only a sample Widget or silently weaken its constraints.

## Model the business flow first

Inspect the target business Skill and every App, MCP server, or tool it uses. Record the following
in `references/data-schema.json`, `references/components.md`, or `references/examples.md` as
appropriate:

- user trigger, business question, and expected business outcome;
- tool inputs, tool result shape, and data provenance shown to the user;
- dimensions, measures, identifiers, units, locale, time zone, and derived-value formulas;
- the normal working state plus loading, empty, error, permission, and authentication states;
- which interactions are local display changes and which are reasoning follow-ups;
- the text-only fallback and the conditions where visualization adds no value.

Never let the Visualizer fetch data, repeat an authenticated business call, or invent missing rows,
metrics, provenance, or conclusions. It transforms the result already produced by the business flow.
Preserve stable identifiers in Widget data so user actions can refer to the exact source row without
placing secrets or credentials in the Widget.

Choose the smallest useful Widget kind. For example, use `chart` for a single comparison or trend,
`dashboard` for several related decisions, `diagram` for a process, and `interactive` for local
parameter exploration. Keep a text-only answer when the data is too small, too uncertain, too
sensitive, or not structurally visual.

## Generate a self-contained derived Skill

Use this package shape, replacing placeholders with raw package Skill names:

```text
skills/<business-skill>-visualizer/
  SKILL.md
  genui.json
  references/
    genui-widget/
      SKILL.md
      references/
        color-system.md
        visual-rules.md
        widget-patterns.md
        widget-recipes.md
    components.md
    data-schema.json
    examples.md
```

Copy the complete `references/genui-widget/` foundation from the Creator into the derived Skill.
Plugin V1 has no cross-Plugin dependency or foundation version lock, so the generated Skill must be
self-contained. These files are authoring instructions and component recipes, not a React package or
executable Widget bundle.

Add both Skills to the target local Plugin's `.minimax-plugin/plugin.json`:

```json
{
  "skills": ["skills/<business-skill>/SKILL.md", "skills/<business-skill>-visualizer/SKILL.md"]
}
```

Keep the raw Skill names in directories, frontmatter, and `plugin.json`. Use the runtime-qualified
names `<plugin-name>:<business-skill>` and `<plugin-name>:<business-skill>-visualizer` only in Skill
composition instructions or user-facing runtime documentation.

## Make ownership and provenance explicit

Write `genui.json` as metadata inside the derived Skill:

```json
{
  "protocol": "mavis.widget.v1",
  "mode": "forked",
  "forkedFrom": "minimax/genui-widget@mavis.widget.v1"
}
```

The derived Visualizer and its copied foundation are user-owned. Users may change its components,
rules, and business behavior or publish it in a new Plugin. Updates to the Creator's foundation do
not silently modify an existing generated Skill. If an exact digest of the copied foundation is
calculated, record it as `sourceDigest: "sha256:<actual-digest>"`; never use a placeholder digest.

Forked instructions cannot relax Host enforcement such as iframe sandboxing, CSP, allowed
capabilities, output-size limits, or protocol validation. A new protocol or Host capability needs a
separate product/runtime change; editing the Skill alone does not create that capability.

For an existing local Plugin, bump its SemVer version because the new Skill and business-Skill
composition instructions change package contents.

## Author the Visualizer Skill

The derived `SKILL.md` must:

1. Have frontmatter name `<business-skill>-visualizer` and describe the specific business result it
   renders, not generic data visualization.
2. Tell the Agent to consume only the structured result and provenance from the original business
   flow, then read its local `references/genui-widget/SKILL.md` and linked references.
3. Define when to render, which component recipe to choose, and when to keep the business Skill's
   text response.
4. Require exactly one final `<mavis-widget>` by default, including valid meta, data, script,
   fallback, and theme-token usage from the foundation.
5. Cover working/loading, empty, error, permission/auth, and non-visual fallback behavior without
   exposing credentials or raw internal errors.

Both the `text` and `userIntent` values must match the conversation language for every `sendPrompt`
interaction. `userIntent` is user-intent context, not an English-only internal metadata label, and
has no language exemption. When `conversationLanguage=zh`, both values must be Chinese.

The Widget is a user-visible result, not progress narration. Put the complete `<mavis-widget>` in
the final assistant message after every retrieval, file, validation, and todo tool has finished. Do
not call any tool after emitting the Widget; a Widget written in an intermediate assistant message
that also requests another tool may be absent from the completed conversation UI. If a short
explanation is useful, include it in the same final message before or after the Widget.

Update the original business Skill so it reaches the business result first and composes with the
runtime-qualified Visualizer only when visualization is selected. The original Skill must remain a
complete text-capable business workflow, not become a thin redirect to GenUI.

`references/components.md` must define at least one domain-specific component recipe. For every
recipe, specify:

- business question and selection rule;
- required input fields, units, null policy, and provenance;
- Widget kind, layout, and semantic hierarchy;
- local interactions such as filter, sort, toggle, tooltip, or parameter recomputation;
- optional reasoning follow-ups and their safe selected-data payload;
- loading, empty, error, auth, and text-fallback presentation.

`references/data-schema.json` must contain a concrete schema or representative shape for the
business result. `references/examples.md` must include at least one representative, complete, valid
`<mavis-widget>` grounded in that shape. Do not leave placeholder labels, invented values, or
production secrets in the example.

The representative example must use the renderer required by its actual sample row count. Its sample
data, component selection rule, and implementation must agree: use CSS/SVG and no `new Chart(...)`
call for 5 or fewer comparable data points; use Chart.js for a standard analytical chart with 6 or
more data points. Do not describe a fallback that the example itself violates.

## Bound interactions to verified Host capabilities

Keep filtering, sorting, view toggles, tooltips, and deterministic calculations local to the Widget.
Use `window.mavis.sendPrompt()` only for a meaningful reasoning follow-up and only when the target
MiniMax Code Desktop Host is verified to support `sendPrompt`. Include only minimal selected data
and stable identifiers; do not forge a user click or a data source.

Do not generate or advertise `submitForm`. It is outside the current approved foundation until its
Host wiring, permission model, and end-to-end behavior are separately implemented and accepted.

If `sendPrompt` support is not verified, remove it from `capabilities`, do not emit its handlers,
and choose a Widget design that remains useful with local interactions and `resize` alone. Do not
claim an unsupported dashboard interaction contract; use a `chart`, `diagram`, `interactive`,
`form`, or `mockup` kind that satisfies the verified environment and foundation rules.

## Validate in layers

After generating the Visualizer, run the complete local Plugin validation again and review these
layers separately:

1. **Package validation:** manifest references both Skills and preserves every existing MCP/Hook
   reference, all copied files are packaged, the version is correct, paths stay inside the Plugin
   root, package limits pass, and Desktop recognizes the local Plugin without scan diagnostics.
2. **Static Widget review:** the example uses `mavis.widget.v1`, valid envelope order, JSON data,
   theme tokens, security constraints, deterministic formatting, a useful fallback, matching
   renderer/sample cardinality, and conversation-language `text` plus `userIntent` values. Review
   layout in light and dark themes when a renderer is available.
3. **Business behavior:** normal, loading, empty, error, and auth paths preserve truthful data and
   text fallback; local interactions remain local; follow-ups contain the correct selected row.
4. **Actual runtime acceptance:** render in the target MiniMax Code Desktop environment and verify
   streaming, resize, theme sync, CSP/sandbox behavior, fallback, and any `sendPrompt` action.

Static inspection and local Plugin validation are not actual runtime acceptance. Report any Host,
account, environment, or end-to-end path that was not exercised instead of presenting it as
verified.

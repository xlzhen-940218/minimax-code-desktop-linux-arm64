# Mini App MiniMax Code visual UI guidelines

This is the default visual baseline for Mini Apps. Generated Client pages must follow it unless
the user explicitly requests a special style. Such a request overrides only directly conflicting
visual decisions; runtime, security, accessibility, and data semantics remain mandatory.

## 1. Purpose and scope

A Mini App should feel like a natural workspace within MiniMax Code: clear information density,
explicit action feedback, restrained decoration, and an initial view that explains the core task.
Do not default to a marketing page, poster, or standalone wall display.

This document covers only Client visuals, layout, component behavior, and accessibility. Node
runtime, Connectors, persistence, routing, publication, and permission boundaries remain governed
by `miniapp-creator/SKILL.md` and its runtime references.

## 2. Visual principles

- Tone: a professional tool, restrained expression, clear hierarchy.
- Focus: content and state first; reserve accent colors for primary actions, selection, and
  semantic states.
- Surfaces: neutral grays, flat containers, light borders. Avoid glass effects, neon, strong
  gradients, and excessive shadows.
- Density: use progressively scaled spacing for pages, sections, components, and elements. Do not
  hide insufficient information behind large empty areas.
- Copy: short sentences and sentence case. Use natural Chinese on Chinese pages rather than
  turning every label into uppercase.

Do not adopt `visual-page` defaults such as Outfit / DM Serif Display, fixed marketing palettes,
purple-blue gradients, or a hero section with excessive whitespace. Bold decoration encouraged by
a generic `frontend-design` skill does not override this product baseline.

## 3. Semantic color variables

A Mini App is an independent HTML page and does not currently inherit Host Tailwind variables or
`WidgetThemeBridge`. Define local variables at the Client root and reference them in component
styles instead of scattering hex values.

Prefer `--mcode-*` names. Do not read Host variables such as `--bg_*` or `--text_*` directly.
If the Host injects tokens in the future, map them in a single adapter layer.

### 3.1 Roles

| Variable | Purpose |
| --- | --- |
| `--mcode-bg` | Page and base canvas background |
| `--mcode-bg-secondary` | Section separation and secondary backgrounds |
| `--mcode-surface` | Cards, panels, and modal content |
| `--mcode-surface-muted` | Table headers, inputs, secondary containers, and hover backgrounds |
| `--mcode-text` | Headings, body copy, and key values |
| `--mcode-text-muted` | Descriptions, supporting information, and axis labels |
| `--mcode-text-subtle` | Placeholders, disabled states, and low-priority metadata |
| `--mcode-border` | Default borders, dividers, and table row lines |
| `--mcode-border-strong` | Focused or emphasized borders |
| `--mcode-accent` | Primary interactions, selection, links, and emphasized icons |
| `--mcode-success` | Success, healthy states, and positive trends |
| `--mcode-warning` | Waiting, risk, and approaching a threshold |
| `--mcode-danger` | Errors, failures, and destructive actions |
| `--mcode-primary-action-bg` | Primary button background |
| `--mcode-primary-action-text` | Primary button text |

### 3.2 Reference theme mapping

These values reflect the primitive/semantic relationships in MiniMax Code `colorPlugin.ts` and
initialize variables in the independent Client. Components must still reference variables rather
than use these values directly.

```css
:root,
[data-theme='light'] {
  --mcode-bg: #ffffff;
  --mcode-bg-secondary: #f5f5f5;
  --mcode-surface: #ffffff;
  --mcode-surface-muted: #fafafa;
  --mcode-text: #171717;
  --mcode-text-muted: #666666;
  --mcode-text-subtle: #adadad;
  --mcode-border: #0a0a0a14;
  --mcode-border-strong: #0a0a0af2;
  --mcode-accent: #0094fc;
  --mcode-success: #04b54b;
  --mcode-warning: #f56811;
  --mcode-danger: #f73646;
  --mcode-primary-action-bg: #171717;
  --mcode-primary-action-text: #ffffff;
}

[data-theme='dark'] {
  --mcode-bg: #171717;
  --mcode-bg-secondary: #1c1c1c;
  --mcode-surface: #262626;
  --mcode-surface-muted: #262626;
  --mcode-text: #ededed;
  --mcode-text-muted: #949494;
  --mcode-text-subtle: #666666;
  --mcode-border: #ffffff14;
  --mcode-border-strong: #fffffff2;
  --mcode-accent: #0077d9;
  --mcode-success: #009c3d;
  --mcode-warning: #e25507;
  --mcode-danger: #e31937;
  --mcode-primary-action-bg: #ffffff;
  --mcode-primary-action-text: #171717;
}
```

Without a Host theme bridge, support at least `prefers-color-scheme` to map system preferences to
`data-theme`; do not force light or dark mode. Concrete color values belong in variable declarations,
not directly in business component styles.

## 4. Typography

```css
font-family:
  ui-sans-serif,
  -apple-system,
  system-ui,
  'Segoe UI',
  Helvetica,
  Arial,
  sans-serif;
```

For code, logs, technical identifiers, and monospaced data, use:

```css
font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

Recommended hierarchy:

| Level | Size / line height / weight | Purpose |
| --- | --- | --- |
| Page title | 18px / 28px / 500–600 | The single main heading at the top |
| Section title | 16px / 24px / 500 | Card and section headings |
| Body | 14px / 20–22px / 400 | Main content and control labels |
| Supporting text | 12px / 16px / 400 | Times, sources, and metadata |
| Key value | 24–28px / 500–600 | KPIs or core results, never hidden only in tooltips |

Keep Chinese content compact: 14–15px body text, 1.5–1.65 line height, section spacing within
40–56px adjusted to content, and 16–22px card padding. Avoid serif display fonts, purely decorative
large headings, and bolding entire paragraphs.

## 5. Spacing, corners, and surfaces

- Use stable spacing increments such as 4 / 8 / 12 / 16 / 20 / 24 / 32px. Prefer 24px page margins,
  reduced to 16px on mobile when needed.
- Typical gaps: 24px between main page sections, 16px within sections, 8–12px within control groups,
  and 4–8px between icons and text.
- Use 12px corner radii for cards, modals, and overlays; 8px for buttons, inputs, and dropdown items;
  pill shapes for status labels.
- Default to 1px `var(--mcode-border)`. Increase contrast only for focus, danger, or explicit grouping.
- Use shadows only to express layering; prefer `0 0 20px rgb(10 10 10 / 8%)`. Avoid glow, heavy
  shadows, and continuously pulsing shadows.
- Do not add a separate gradient, texture, illustration, or decorative background to every section.

## 6. Page layout

Prefer this starting structure over a blank canvas:

```text
Page container
├─ Page title + description + one primary action
├─ Toolbar (search, filters, view switching)
└─ Content (list / detail / dashboard / form)
```

- If navigation is needed, use a 200–240px sidebar and `flex: 1` for main content. Otherwise keep
  a single content column.
- Place title and description on the left and the primary action on the right. Do not stack several
  equally prominent calls to action at the top.
- Dashboards may use around three KPI cards, but do not mechanically divide all content into equal
  cards. Use unequal grid columns or lists below according to importance.
- Prioritize readable text widths in lists and details. On narrow screens, make tables scroll
  within their container or switch to cards, avoiding meaningless horizontal page scrolling.
- Below 768px, switch to one column, tighten spacing, and allow actions to wrap.
- Do not conceal content with a fixed `h-screen`. Let the page grow naturally and constrain scrolling
  only where the content requires it.

## 7. Component behavior

### Buttons

- Primary: `--mcode-primary-action-bg` background and `--mcode-primary-action-text` text.
- Secondary: `--mcode-surface-muted` or transparent background with `--mcode-border`.
- Text/link action: transparent background with `--mcode-accent`.
- Destructive: `--mcode-danger`, reserved for actual destructive actions such as delete, stop, or undo.
- Default height 32–40px with 8px corners. Hover and press change color or opacity, without noticeable
  movement, scaling, or glow.
- In irreversible-action confirmations, put Cancel/secondary on the left and Confirm/primary on
  the right.

### Inputs, selection, and forms

- Inputs: 36–40px height, 8px corners, and a default 1px border.
- Focus: `--mcode-border-strong` or `--mcode-accent`, with a clear keyboard focus ring.
- Placeholders: `--mcode-text-subtle`. Validation errors need explanatory text and a
  `--mcode-danger` border or icon.
- Stack form fields vertically with 4–12px spacing between labels, controls, and errors. Do not
  identify required fields by color alone.

### Tabs, segmented controls, and status labels

- Inactive tabs use muted text. Selected tabs use primary text with a 2px indicator or a light
  `surface-muted` background.
- Segmented controls use a muted container surface with 8px corners and an elevated selected
  surface. Avoid highly saturated fills.
- Status labels combine semantic color and text such as Running / Failed / Completed; never
  communicate state through color alone.

### Lists, tables, and cards

- List rows are typically 32–40px tall and use business IDs as stable identifiers. Hover uses
  `surface-muted` without changing layout dimensions.
- Table headers and supporting fields use muted text; key fields use primary text. Provide
  accessible full content when truncating long text.
- Each card contains one clear unit of information or action, with a distinct title, description,
  and metadata hierarchy. Avoid meaningless badges.
- Actions may appear on hover, but must remain visible and reachable for keyboard and assistive
  technology users.

### Modals, popovers, and dropdowns

- Use an elevated surface, 1px border, 12px corners, and a light shadow.
- Keep content compact and give close buttons readable `aria-label` values. Implement Escape,
  focus restoration, and Tab containment as appropriate.
- Dropdown items use 8px corners and 32–38px row heights. Destructive item text and icons share
  the danger token.
- Use popovers for brief explanations or lightweight selection, not long workflows. Use modals
  for confirmation, error recovery, or multiple input fields.

## 8. Data visualization

- Choose the chart that communicates the conclusion fastest; do not chart for decoration.
- Use accent for one series. For multiple series, prefer two or three chart ramps, with at most
  six semantic chart tokens.
- Use theme variables for chart colors, or a future mapping to `--mw-chart-1` through
  `--mw-chart-6`; do not hardcode brand colors or gradients.
- Axes, grid lines, and legends use muted/subtle colors. Key values and trend direction are directly
  visible in the layout.
- Prefer CSS/SVG for small datasets. Introduce Chart.js for time series or many-point comparisons,
  ensuring the dependency is bundled locally in the candidate package.
- Charts, KPIs, and lists need understandable working, loading, empty, and error states. Preserve
  the page structure on errors.

## 9. Icons and illustrations

The standalone Mini App Client cannot import React icons from `packages/ui`:

- Prefer locally bundled assets or inline SVG, matching MiniMax Code icon stroke width and visual
  weight. SVG uses `currentColor` or semantic variables.
- Do not use emoji, ASCII box drawing, remote icon CDNs, remote images, or remote fonts.
- Use at most one decorative icon per section title. Icons cannot replace state text or action names.
- Avoid large illustrations in empty states. Use a subdued icon, a short explanation, and an
  optional action.

## 10. Motion and feedback

- Color/opacity transitions take around 150ms; expansion, collapse, and modals around 200–300ms,
  consistently using `ease-out`.
- Loading may use a lightweight spinner or skeleton. Avoid simultaneous rapid flashing across
  multiple areas.
- Hover, press, focus, disabled, loading, success, and error states all need observable feedback.
- Under `prefers-reduced-motion: reduce`, remove movement, scaling, and continuous animation,
  retaining only necessary opacity transitions or immediate state changes.
- Use toasts for lightweight completed outcomes. Confirm irreversible actions first. Show failures
  near their source without exposing internal paths, ports, or credentials.

## 11. Accessibility and content

- Use semantic elements such as `header`, `nav`, `main`, `section`, `form`, and `table`, with a
  continuous heading hierarchy.
- Every interactive element has visible text or an `aria-label`, keyboard access, and clear focus.
  Use `role="status"` or `role="alert"` for status messages.
- Ensure readable text/background contrast. Do not convey success, error, or selection through
  color, position, or icons alone.
- Keep copy concise and tied to user actions. Avoid marketing phrases such as "Elevate" or
  "Seamless", and do not repeat data already visualized.
- Follow the user's requested language. For localization, keep Chinese and English sentence
  structures consistent and do not expose internal field names directly to users.

## 12. Default theme and Host adaptation

The current Electron Mini App surface loads managed pages; no automatic injection path for Mavis
UI theme tokens has been identified. This baseline therefore uses:

1. Client-owned `--mcode-*` variables.
2. `prefers-color-scheme` as the default theme source.
3. Explicit overrides via `data-theme="light|dark"` from the page or a future Host integration.
4. A variable adapter as the only layer to change if a Host theme bridge is added; business component
   class names remain unchanged.

Do not access internal loopback coordinates, Electron objects, or undeclared globals just to make
Client styling resemble the Host.

## 13. Before delivery

- [ ] Follow this baseline unless a special style was requested; no Outfit / DM Serif Display,
  purple-blue gradients, or neon decoration by default.
- [ ] Component styles use `--mcode-*` semantic variables without scattered theme hex values.
- [ ] Both light and dark themes are readable without depending on incidental Host CSS variables.
- [ ] The initial view explains the core content; spacing distinguishes pages, sections, components,
  and elements.
- [ ] Cards/modals use 12px corners, controls 8px, borders 1px, and restrained shadows.
- [ ] One clear primary action; destructive actions have semantic colors and confirmation.
- [ ] Loading, empty, error, and working states preserve the structure and remain accessible.
- [ ] Interactions support keyboard, focus, ARIA, and reduced motion.
- [ ] Icons are local or inline SVG; no emoji, remote fonts, remote images, or remote CDNs.
- [ ] Key visualization values are not confined to tooltips, and chart dependencies are bundled
  locally in the candidate package.

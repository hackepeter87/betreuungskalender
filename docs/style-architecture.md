# Style architecture

The application stylesheet is loaded through `src/styles.css`. The entry file
declares the cascade order and imports each stylesheet into exactly one layer.
It must not contain selectors or declarations of its own. Its order is a
maintenance contract:

1. `tokens` defines root design values.
2. `base` normalizes HTML elements and browser defaults.
3. `shell` owns navigation, session controls, mobile chrome, and install state.
4. `components` owns reusable page, panel, form, action, status, and table rules.
5. `pages` owns feature-specific presentation.
6. `responsive` adapts existing rules to supported viewports.
7. `utilities` contains accessibility, display, animation, and motion helpers.
8. `print` contains print-only report presentation.

## Ownership

New styles belong in the narrowest existing layer:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `tokens` | root design values and semantic roles | component selectors |
| `base` | element defaults, browser normalization, global focus and validation defaults | feature layouts |
| `shell` | desktop and mobile navigation, session controls, install state | page content |
| `components` | reusable page, panel, form, action, status, overlay and table primitives | feature-only variants |
| `pages` | feature-specific presentation | generic controls or shell chrome |
| `responsive` | current viewport adaptations | new base definitions |
| `utilities` | accessibility, display, motion and single-purpose helpers | feature presentation |
| `print` | print-only report output | screen layout |

Shared primitives have one authoritative top-level definition. Add modifiers
beside their owner instead of appending a release-labelled override block. The
guardrail baseline records protected global selectors such as `.page`,
`.panel`, `.sidebar`, and `.calendar-grid`; duplicate or misplaced definitions
fail the standard test workflow.

The `shell`, `components`, `pages`, and `responsive` entry files are ordered import-only
indexes. Their subfiles make selector ownership explicit without changing the
cascade:

- `shell/` separates navigation, session controls, notifications, and runtime
  install or loading states;
- `components/` separates structural primitives, data and feedback,
  dialogs and forms, and reusable compositions;
- `pages/calendar.css` owns the month toolbar, grid, day popover, agenda,
  and calendar-specific status presentation;
- `pages/dashboard.css` owns metrics, upcoming entries, per-child summaries,
  data quality, and dashboard confirmation placement;
- `pages/remaining.css` temporarily retains the other pages for their separate
  consolidation package;
- `responsive/` separates shell and shared-component adaptations from the
  remaining feature-specific rules. Its calendar and dashboard files adapt only
  their respective feature owners, grouped by the existing viewport boundaries.

Declarations that are immediately overwritten in the same rule are rejected
for shared shell, component, calendar, and dashboard ownership. Calendar and
dashboard selectors are forbidden in the remaining catch-all files. Other
feature-specific responsive rules remain a tracked migration boundary for the
remaining-page package.

Calendar exceptions are intentional: the desktop grid retains its minimum cell
size, while the mobile grid uses compact labels and a bottom day-detail drawer.
The mobile dashboard uses its dedicated metric arrangement and agenda instead
of squeezing the desktop calendar. No date range, counting, filtering, or data
loading logic belongs in these stylesheets.

## Color contract

Shared interface styles use semantic custom properties rather than raw colors
or palette names. The current roles cover:

- primary, secondary, subtle, and on-accent text;
- canvas, panel, and subtle surfaces;
- default and strong borders;
- focus indication and primary actions;
- text, surface, and border combinations for information, success, warning,
  and danger states.

The older palette variables remain temporarily available while feature styles
are migrated. Shell styles, shared component styles, and their responsive
adaptations, plus the calendar and dashboard owners, accept no raw colors;
tests require semantic roles in those files. Calendar state roles distinguish
planned, cancelled, partial, holiday, unavailable, and conflicting entries;
their light values remain unchanged during this ownership refactor.
Remaining feature and print colors outside `tokens.css` are an explicit,
counted debt inventory in `scripts/style-guardrails-baseline.ts`. A package may
reduce those counts, but adding another raw color or increasing an existing
count fails tests. Runtime values selected by a user, such as a calendar color,
remain data and are not added to static CSS.

## Responsive contract

A responsive rule adapts an existing owner; it must not introduce a second
base definition. Viewport media queries currently belong to the `responsive`
layer. Approved boundaries are 430, 560, 640, 720, 767, 768, 900, 1050, 1024,
and 1199 CSS pixels in the combinations recorded by the guardrail baseline.
Adding a boundary requires an explicit contract review instead of another
local one-off breakpoint. Print and reduced-motion media queries remain owned
by their dedicated layers.

The supported layout baseline starts at 320 CSS pixels. Mobile behavior applies
below 768 pixels, tablet adaptations cover the intermediate widths already used
by the application, and desktop content remains fluid in the space left by the
sidebar. Reading content may constrain its inner measure; calendar, dashboard,
table, report, settings, and backup page frames remain fluid. Print sizing is
owned exclusively by the `print` layer.

Run `npm run build` after changing imports or layer ownership. Relevant page and
responsive Playwright scenarios must accompany behavioral layout changes.
`npm test` enforces layer order, import-only ownership indexes, raw-color
budgets, token-only shared styles, duplicate declaration removal, approved
breakpoints, and semantic token availability. Invalid fixtures prove that each
guard rejects regressions instead of merely describing the current files.

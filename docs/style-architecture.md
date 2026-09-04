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
  dialogs and forms, and reusable compositions. Summaries, care confirmations,
  conflict review, data migration and period selection each have a named owner;
- `pages/calendar.css` owns the month toolbar, grid, day popover, agenda,
  and calendar-specific status presentation;
- `pages/dashboard.css` owns metrics, upcoming entries, per-child summaries,
  data quality, and dashboard confirmation placement;
- `pages/settings.css` owns settings composition, membership management,
  external calendars and personal feed controls;
- `pages/setup.css` owns the initial setup form and its person/child layout;
- `pages/report.css`, `analytics.css`, `backup.css`, `documentation.css`,
  `entries.css`, `contact.css`, `holidays.css`, `unavailable.css` and `audit.css`
  own the corresponding route layouts and functional variants; backup includes
  portable transfer review, confirmation and actor mapping;
- `responsive/` begins with mobile token values, then shell and shared controls,
  named shared-component owners, and matching feature owners. Each owner has
  one block per media condition, with broader ranges before narrower ranges.

The former `pages/remaining.css` and `responsive/features.css` are removed.
Catch-all replacements named `misc`, `legacy` or `overrides` are forbidden.
Tests reject duplicate imports, orphan files, repeated media blocks and repeated
properties for the same selector/layer/condition across all owners. Browser
fallbacks belong in a narrowly scoped `@supports` condition or use a distinct
vendor-prefixed property, not a blanket duplicate-declaration exemption.

Settings and setup use the same shared field, button, help and status controls
as other pages. Their own files contain layout and functional variants only;
responsive variants live in the matching `responsive/settings.css` and
`responsive/setup.css`, grouped by existing conditions. Setup's compact help
controls and settings' reserved label-row height preserve the established
multi-column form alignment. They are explicit variants, not competing global
baselines. Settings section spacing comes from `.page > .panel`.

Retired invitation-code acceptance styling and unused numbered settings grids
are removed. Shared member-card definitions that were overwritten by page
styles are removed rather than copied into a second layer. Setup card surfaces
share one definition; input heights, disabled actions and labels continue to
come from the common primitives. A structural test prevents feature selectors
from returning to common files and rejects repeated properties in the same
feature/layer/media context.

Supporting routes inherit fluid sizing from `.page`; duplicate route-level
width and maximum-width resets are forbidden. Each route's responsive rules
live under the same owner name, with existing media boundaries preserved.
Report print rules remain exclusively in the print layer; screen layout does
not change the PDF renderer. The former transfer-count tiles and raw metadata
presentation are unused and removed, including their responsive rules.
Cross-route selector groups (for example export actions and informational
banners) remain shared rather than duplicating declarations into each page
owner. Summary variants inherit the base summary strip; their modifiers only
define column counts and the genuinely different final-row arrangement.

The analytics section now uses the same section gap as other top-level panels:
20px on desktop and 14px on mobile, replacing its isolated 18px rule. This is
an intentional spacing normalization. Audit tables inherit the existing 830px
statistics-table minimum; their old 980px declaration was superseded and must
not become active again through ownership reordering.

Calendar exceptions are intentional: the desktop grid retains its minimum cell
size, while the mobile grid uses compact labels and a bottom day-detail drawer.
The mobile dashboard uses its dedicated metric arrangement and agenda instead
of squeezing the desktop calendar. No date range, counting, filtering, or data
loading logic belongs in these stylesheets.

## Standalone public pages

The two public legal documents deliberately retain one small static stylesheet
in `server/routes/legal.ts`. They do not load the authenticated React application
or its font downloads. The optional same-origin appearance
bootstrap applies the locally saved preference; content remains readable with
JavaScript disabled. This is an explicit document owner, not a
destination for application styles. Its CSS is inventoried and included in the
aggregate reduction check, so it cannot conceal relocated style debt.

Legal headings use fixed 40px, 28px and 22px sizes at the existing desktop,
767px and 430px boundaries. This replaces viewport-scaled heading text and fixes
the clipped privacy heading at 320px. Operator content, escaping, links and
no-store responses remain unchanged. Six-viewport tests include long text,
overflow and keyboard focus. This is the only intentional visual adjustment in
the final cleanup; the earlier analytics gap normalization is recorded above.

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
their meaning remains distinct through labels and icons. Appearance work
normalizes equivalent calendar and feedback colors onto the shared success,
warning, information and danger roles rather than maintaining duplicate
calendar-only palettes.
Remaining feature and print colors outside `tokens.css` are an explicit,
counted debt inventory in `scripts/style-guardrails-baseline.ts`. A package may
reduce those counts, but adding another raw color or increasing an existing
count fails tests. Runtime values selected by a user, such as a calendar color,
remain data and are not added to static CSS.

Light/dark pairs belong in `tokens.css`, using `light-dark()` with the root
`color-scheme`. Do not add per-page dark-mode selectors or separate component
palettes. Accent text and filled actions have different contrast requirements:
`--color-action-primary` and `--color-action-danger` remain dark enough for
`--color-text-on-accent`; brighter dark-mode text accents must not replace those
backgrounds. The print layer forces the light scheme. The standalone legal
document owns its small equivalent palette and remains included in aggregate
style budgets. Appearance does not relax the fixed reduction ceilings.

## Responsive contract

A responsive rule adapts an existing owner; it must not introduce a second
base definition. Viewport media queries currently belong to the `responsive`
layer. Approved boundaries are 430, 560, 640, 720, 767, 768, 900, 1050, 1024,
and 1199 CSS pixels in the combinations recorded by the guardrail baseline.
Adding a boundary requires an explicit contract review instead of another
local one-off breakpoint. Print and reduced-motion media queries remain owned
by their dedicated layers. The standalone legal document uses the same 767px
and 430px boundaries without importing the application cascade.

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
`npm run build` also runs `npm run styles:check`, including in the container
builder. The reduction ceilings are explicit in
`scripts/style-reduction-contract.ts`; increasing them requires a new recorded
decision. They are not recalculated from the current working tree.

## Reduction evidence

Use `npm run styles:report` for source measurements and
`npm run styles:report -- --ref <commit>` for a PR's unchanged base. The fixed
consolidation baseline is `5c51f88`: 25 files, 8,717 lines, 159,756 bytes,
4,207 declarations and 1,335 rule blocks. Each source file is counted once,
including layer indexes; imports are not expanded a second time.

After a fresh production build, `npm run styles:report -- --build-dir dist/assets`
also reports each built CSS asset and aggregate raw and gzip sizes. Record the
Node, PostCSS and build-tool versions with the comparison. The baseline build
with Node 24.14.0, PostCSS 8.5.23 and Vite 7.3.6 is 129,651 bytes raw and
23,731 bytes gzip. Do not attribute an old build to changed source.

The report separately measures the standalone legal stylesheet and aggregate
application-plus-document totals. Its original baseline is 1,056 source bytes,
40 declarations, 10 rules and 560 gzip bytes. The original application-only
baseline above remains unchanged. Aggregate gzip adds independently compressed
CSS blocks; it is not a measurement of an entire HTML response.

`--inventory` additionally reports parser-derived selectors, declarations,
layers and enclosing conditions, plus repeated properties in identical
contexts. This is a review inventory, not a cascade simulator: shorthand
interactions, specificity, states and overlapping media queries must be checked
using computed browser styles. Keep temporary inventories outside the repository.

Each package must reduce source bytes, declaration count and rule count;
production raw and gzip sizes must not grow. Report lines and file counts too,
but splitting files or moving CSS into inline styles is not a reduction.
Failure requires more work or an explicit new decision, not a relaxed threshold.

Shared fields and labels are owned by `dialogs-and-forms.css` and
`compositions.css`; disabled actions by `structure.css`; status and readiness
surfaces by `data-and-feedback.css`. `panel-form` and `subsection-heading` live
in `compositions.css`. Single-line control height and multiline textarea height
are separate rules, without overwriting each other. Mobile entry forms retain
their existing compact variant; this functional exception is not a new global
baseline. Responsive tests protect the supported control sizes.

The first reduction removes overwritten mobile dialog geometry, obsolete
two-column mobile form grids and redundant inherited field/label rules. It
preserves effective rendering, rather than changing snapshot expectations to
hide unintended changes. Subsequent page packages must remove their replaced
rules in the same change, and the final package removes both catch-all files.

Retained functional variants include compact mobile entry fields, full-height
mobile dialogs, the collapsed-sidebar offset, odd-length summary strips,
status-specific conflict borders, user-selected calendar colors and separate
print rules. They preserve existing behavior rather than adding alternative
global baselines. Known overwritten widths, mobile navigation shorthands and
repeated summary declarations are removed; structural checks and computed-style
comparisons cover those boundaries.

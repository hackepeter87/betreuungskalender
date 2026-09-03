# Accessibility testing

The accessibility baseline combines automated checks with manual review. It is
a regression gate, not a claim of complete WCAG conformance or certification.

## Automated checks

Playwright runs `@axe-core/playwright` against representative authenticated and
public routes on desktop, iPhone, and iPad projects. Serious and critical WCAG
2.0/2.1 A and AA findings fail the suite. Any rule suppression must identify a
verified false positive, be limited to the smallest affected element, and state
why the underlying user experience remains accessible.

The suite covers the dashboard, calendar, settings, backup and transfer,
reports, the privacy page, the care-entry dialog, responsive navigation, and a
320 CSS-pixel reflow check. Existing visual and interaction tests continue to
cover clipping, horizontal overflow, focus restoration, and Escape behavior.

Run the focused checks with:

```bash
npx playwright test e2e/accessibility.spec.ts
```

## Manual release matrix

Before a frontend release, review these workflows with keyboard-only input and
VoiceOver on an iPhone or iPad and a desktop browser:

| Workflow | Keyboard and focus | Screen reader | Reflow and touch |
| --- | --- | --- | --- |
| Main and responsive navigation | Logical order, visible focus, Escape closes overlays, focus returns to the trigger | Landmarks and current destination are announced | Controls remain reachable without horizontal scrolling |
| Calendar and agenda | Days, entries, overflow actions, and dialogs are operable | Dates, status, child assignment, and warnings have meaningful names | Entries do not overlap controls at narrow widths or 200% zoom |
| Care-entry editing | Required fields and errors are reached in order; modal focus remains contained | Labels, required state, invalid state, and help are associated with their controls | Date/time groups and actions remain usable by touch |
| Settings and transfer review | Toggles, tabs, destructive confirmations, and copy actions are operable | State, warnings, comparison values, and confirmation requirements are announced | Dense grids reflow without clipped content |
| Reports and legal pages | Period controls and actions remain reachable | Headings, tables, status messages, and legal navigation are structured | Screen content reflows; print and PDF are reviewed separately |

Record the browser, device, operating-system version, tested commit, and any
accepted limitation in the release issue. Do not disable broad axe rules to
work around a product defect.

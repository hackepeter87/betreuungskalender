# Style architecture

The application stylesheet is loaded through `src/styles.css`. Its import order
is a maintenance contract:

1. `tokens` defines root design values.
2. `base` normalizes HTML elements and browser defaults.
3. `shell` owns navigation, session controls, mobile chrome, and install state.
4. `components` owns reusable page, panel, form, action, status, and table rules.
5. `pages` owns feature-specific presentation.
6. `responsive` adapts existing rules to supported viewports.
7. `utilities` contains accessibility, display, animation, and motion helpers.
8. `print` contains print-only report presentation.

New styles belong in the narrowest existing layer. Shared primitives must have
one authoritative base definition. Add modifiers beside their owning primitive
instead of appending a release-labelled override block. A responsive rule may
change layout at a breakpoint, but must not duplicate another rule for the same
selector and media condition.

The supported layout baseline starts at 320 CSS pixels. Mobile behavior applies
below 768 pixels, tablet adaptations cover the intermediate widths already used
by the application, and desktop content remains fluid in the space left by the
sidebar. Reading content may constrain its inner measure; calendar, dashboard,
table, report, settings, and backup page frames remain fluid. Print sizing is
owned exclusively by the `print` layer.

Run `npm run build` after changing imports or layer ownership. Relevant page and
responsive Playwright scenarios must accompany behavioral layout changes.

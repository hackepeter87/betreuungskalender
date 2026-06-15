# E2E selector convention

Playwright tests use `data-testid` for controls whose visible labels may be
localized.

- `page-*`: confirms the active application page.
- `nav-*`, `mobile-nav-*`, `mobile-more-*`: navigation targets.
- Domain prefixes such as `entry-*`, `holiday-*`, and `export-*`: form fields
  and actions.
- Dynamic domain data is asserted through fictional test values or neutral
  `data-value` attributes.

Presentation-only copy, help text, table headings, and status descriptions do
not receive test IDs. Tests may still assert fictional user-entered values
because those are test data rather than localized application strings.

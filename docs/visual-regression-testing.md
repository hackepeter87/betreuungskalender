# Visual regression testing

The Playwright visual regression suite protects the shared screen layout at
320, 390, 768, 1280, 1440, and 1920 CSS pixels. It covers the dashboard,
calendar, settings, report, backup, and the navigation states used at each
width. Print output remains covered by separate report tests.

## Test data and deterministic rendering

The suite creates only clearly fictional records in the isolated E2E database.
Run it only in a disposable development checkout without operator `.env` files,
secrets or database connection variables; it replaces test data. Do not run
multiple E2E processes in the same checkout at once.
It fixes browser time, locale, timezone, reduced-motion behavior, animation
timing, runtime metadata, and generated report identifiers. Baselines must not
contain real names, schedules, instance identifiers, URLs, exports, or secrets.

## Mobile layout contract

The mobile contract is structural as well as visual. At 320 and 390 CSS pixels:

- controls, help triggers, labels, values, and borders stay inside their owning
  page, panel, row, or field;
- page-level overflow is not hidden to make a failing component appear valid;
- the application shell reserves the fixed bottom-navigation space once, while
  individual pages retain only their normal closing space;
- compact toolbars keep stable control order and dimensions, while commands
  move to a separate row when they need more room;
- odd summary counts use a deliberate final label/value row instead of a large
  visually empty grid cell;
- long synthetic identifiers and report metadata reflow without obscuring
  labels or adjacent values; and
- the notification layout is tested with every supported channel visible.

`e2e/mobile-layout.spec.ts` checks these contracts in Chromium and WebKit. It
uses real application routes and the disposable E2E database; API interception
is limited to enabling the optional notification-channel capability with
fictional values. Route screenshots remain useful review evidence, but they do
not replace geometric containment and accessibility assertions.

## Reviewing a change

Run the visual suite before updating images:

```bash
npx playwright test e2e/visual-regression.spec.ts
```

Review every reported pixel difference as a product change. Do not update a
baseline merely to make CI pass. Check the matching semantic assertion when a
change affects overflow, overlays, keyboard focus, Escape behavior, or
responsive navigation.

## Updating baselines

Generate canonical baselines with the Playwright runtime and `C.UTF-8` process
locale used by CI. Use the Playwright image matching the version in
`package-lock.json`, mount the repository read-write, and keep container
dependencies in a separate volume:

```bash
mkdir -p /tmp/betreuungskalender-visual-node_modules
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e LANG=C.UTF-8 \
  -e LC_ALL=C.UTF-8 \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD:/work" \
  -v /tmp/betreuungskalender-visual-node_modules:/work/node_modules \
  -w /work \
  mcr.microsoft.com/playwright:v1.65.0-noble \
  bash -lc 'npm ci && npx playwright test e2e/visual-regression.spec.ts --update-snapshots'
```

Inspect the generated PNG files before committing them. Then run the same suite
twice without `--update-snapshots`; both runs must pass unchanged. A reviewer
must approve the image diff together with the code change.

Failure screenshots, traces, reports, downloads, and test databases remain in
ignored output directories and are never committed.

The [documentation screenshot guide](screenshots.md) reuses two reviewed Linux
references. It does not introduce another fixture or capture pipeline.

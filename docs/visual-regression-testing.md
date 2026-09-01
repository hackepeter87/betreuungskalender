# Visual regression testing

The Playwright visual regression suite protects the shared screen layout at
320, 390, 768, 1280, 1440, and 1920 CSS pixels. It covers the dashboard,
calendar, settings, report, backup, and the navigation states used at each
width. Print output remains covered by separate report tests.

## Test data and deterministic rendering

The suite creates only clearly fictional records in the isolated E2E database.
It fixes browser time, locale, timezone, reduced-motion behavior, animation
timing, runtime metadata, and generated report identifiers. Baselines must not
contain real names, schedules, instance identifiers, URLs, exports, or secrets.

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

Generate canonical baselines with the same Linux Playwright runtime used by CI.
Use the Playwright image matching the version in `package-lock.json`, mount the
repository read-write, and keep container dependencies in a separate volume:

```bash
mkdir -p /tmp/betreuungskalender-visual-node_modules
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD:/work" \
  -v /tmp/betreuungskalender-visual-node_modules:/work/node_modules \
  -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble \
  bash -lc 'npm ci && npx playwright test e2e/visual-regression.spec.ts --update-snapshots'
```

Inspect the generated PNG files before committing them. Then run the same suite
twice without `--update-snapshots`; both runs must pass unchanged. A reviewer
must approve the image diff together with the code change.

Failure screenshots, traces, reports, downloads, and test databases remain in
ignored output directories and are never committed.

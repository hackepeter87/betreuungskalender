import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps only dashboard and setup page imports in the eager application graph", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const eagerPageImports = [...source.matchAll(/import \{ (\w+Page) \} from "\.\/pages\//g)]
    .map((match) => match[1]);

  assert.deepEqual(eagerPageImports.sort(), ["DashboardPage", "SetupWizardPage"]);
  assert.match(source, /import\("\.\/pages\/AnalyticsPage"\)/);
  assert.match(source, /import\("\.\/pages\/ReportPage"\)/);
});

test("provides accessible loading, failure, and reload states", async () => {
  const source = await readFile(
    new URL("../src/components/DeferredPage.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /useMemo\(\(\) => lazy\(loader\), \[loader\]\)/);
  assert.match(source, /key=\{`\$\{variant\}:\$\{pageId\}`\}/);
});

test("keeps PDF libraries behind action-level dynamic imports", async () => {
  const source = await readFile(new URL("../src/lib/report.ts", import.meta.url), "utf8");

  assert.match(source, /import\("jspdf"\)/);
  assert.match(source, /import\("jspdf-autotable"\)/);
});

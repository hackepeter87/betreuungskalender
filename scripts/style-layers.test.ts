import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inventoryStyles, repeatedStyleProperties } from "./style-inventory";
import {
  findOverriddenDeclarations,
  findRawColorCounts,
  validateBaselineOwnership,
  validateBreakpointOwnership,
  validateLayerEntry,
  validateRawColorBudget,
  type StyleSource
} from "./style-guardrails";
import {
  approvedViewportQueries,
  baselineOwners,
  rawColorBudget
} from "./style-guardrails-baseline";

const layerNames = [
  "tokens",
  "base",
  "shell",
  "components",
  "pages",
  "responsive",
  "utilities",
  "print"
] as const;

test("inventories CSS with parser contexts and preserves fallback evidence", () => {
  const source = '.field:is(.a, .b) { color: red; color: var(--ink); content: "a;b{}"; }\n' +
    '@media (max-width: 767px) { .field { color: blue !important; } }\n' +
    '@layer forms { @supports (display: grid) { .field { display: grid; } } }\n';
  const inventory = inventoryStyles([{ path: "fixture.css", layer: "components", source }]);
  assert.deepEqual(inventory.metrics, {
    files: 1, lines: 3, bytes: Buffer.byteLength(source), declarations: 5, rules: 3
  });
  assert.deepEqual(inventory.rules[0].selectors, [".field:is(.a, .b)"]);
  assert.deepEqual(inventory.rules[1].conditions, ["@media (max-width: 767px)"]);
  assert.deepEqual(inventory.rules[2].conditions, ["@layer forms", "@supports (display: grid)"]);
  assert.equal(inventory.rules[1].declarations[0].important, true);
  assert.equal(repeatedStyleProperties(inventory.rules).length, 1);
  assert.equal(repeatedStyleProperties(inventory.rules)[0].property, "color");
});

test("distinguishes repeated properties from different layers and conditions", () => {
  const rules = inventoryStyles([
    { path: "a.css", layer: "components", source: ".field { gap: 6px; }" },
    { path: "b.css", layer: "responsive", source: ".field { gap: 8px; } @media (max-width: 767px) { .field { gap: 10px; } }" }
  ]).rules;
  assert.deepEqual(repeatedStyleProperties(rules), []);
});

test("keeps consolidated primitive properties unique within each context", async () => {
  const primitives = new Set([
    ".page", ".field", ".field input", ".field select", ".field textarea",
    ".modal", ".modal__body", ".datetime-grid", ".form-grid", ".status-pill",
    ".panel-form", ".subsection-heading"
  ]);
  const rules = inventoryStyles(await styleSources()).rules;
  assert.deepEqual(repeatedStyleProperties(rules).filter(({ selector }) => primitives.has(selector)), []);
});

async function styleSources(): Promise<StyleSource[]> {
  const stylesRoot = new URL("../src/styles/", import.meta.url);
  const entries = await readdir(stylesRoot, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => path.posix.join(entry.parentPath.replace(stylesRoot.pathname, ""), entry.name))
    .sort();

  return Promise.all(files.map(async (file) => {
    const layer = file.includes("/") ? file.split("/", 1)[0] : file.replace(/\.css$/, "");
    return {
      path: `src/styles/${file}`,
      layer,
      source: await readFile(new URL(`../src/styles/${file}`, import.meta.url), "utf8")
    };
  }));
}

function styleImports(source: string): string[] {
  return [...source.matchAll(/@import\s+"([^"]+)"\s*;/g)].map((match) => match[1]);
}

function topLevelSelectorsForTest(source: string): string[] {
  const remainder = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import\s+[^;]+;/g, "")
    .trim();
  return remainder ? [remainder] : [];
}

function occurrenceCount(source: string, value: string): number {
  return source.split(/\r?\n/).filter((line) => line.trim() === value).length;
}

test("loads application style layers in the documented order", async () => {
  const entry = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const imports = [...entry.matchAll(/@import "\.\/styles\/([^."]+)\.css" layer\(([^)]+)\);/g)]
    .map((match) => ({ file: match[1], layer: match[2] }));

  assert.deepEqual(
    imports,
    layerNames.map((name) => ({ file: name, layer: name }))
  );
  assert.deepEqual(validateLayerEntry(entry, layerNames), []);
});

test("keeps every style layer explicit and free of release-labelled overrides", async () => {
  const sources = await styleSources();
  const sourceForLayer = (name: string) => sources
    .filter(({ layer }) => layer === name)
    .map(({ source }) => source)
    .join("\n");

  for (const name of layerNames) {
    const source = sourceForLayer(name);
    assert.ok(source.trim().length > 0, `${name}.css must not be empty`);
    assert.doesNotMatch(source, /\/\*\s*v\d+\.\d+/i);
  }

  assert.match(sourceForLayer("tokens"), /:root\s*\{/);
  assert.match(sourceForLayer("components"), /\.panel\s*\{/);
  assert.match(sourceForLayer("pages"), /\.calendar-grid\s*\{/);
  assert.match(sourceForLayer("responsive"), /@media\s*\(/);
  assert.match(sourceForLayer("print"), /@media\s+print/);
});

test("keeps shell and shared component ownership in ordered import-only indexes", async () => {
  const shell = await readFile(new URL("../src/styles/shell.css", import.meta.url), "utf8");
  const components = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");

  assert.deepEqual(styleImports(shell), [
    "./shell/navigation.css",
    "./shell/session.css",
    "./shell/notifications.css",
    "./shell/runtime.css"
  ]);
  assert.deepEqual(styleImports(components), [
    "./components/structure.css",
    "./components/data-and-feedback.css",
    "./components/dialogs-and-forms.css",
    "./components/compositions.css"
  ]);
  assert.deepEqual(topLevelSelectorsForTest(shell), []);
  assert.deepEqual(topLevelSelectorsForTest(components), []);
});

const supportingStyleOwners = [
  "report", "analytics", "backup", "documentation", "entries", "contact", "holidays", "unavailable", "audit"
];

test("keeps responsive shell and shared component rules out of the feature catch-all", async () => {
  const responsive = await readFile(new URL("../src/styles/responsive.css", import.meta.url), "utf8");

  assert.deepEqual(styleImports(responsive), [
    "./responsive/shell.css",
    "./responsive/components.css",
    "./responsive/features.css",
    ...supportingStyleOwners.map((owner) => `./responsive/${owner}.css`),
    "./responsive/settings.css",
    "./responsive/setup.css",
    "./responsive/calendar.css",
    "./responsive/dashboard.css"
  ]);
  assert.deepEqual(topLevelSelectorsForTest(responsive), []);
});

test("keeps calendar and dashboard rules in their feature owners", async () => {
  const pages = await readFile(new URL("../src/styles/pages.css", import.meta.url), "utf8");
  assert.deepEqual(styleImports(pages), [
    "./pages/remaining.css", ...supportingStyleOwners.map((owner) => `./pages/${owner}.css`),
    "./pages/settings.css", "./pages/setup.css", "./pages/calendar.css", "./pages/dashboard.css"
  ]);
  assert.deepEqual(topLevelSelectorsForTest(pages), []);

  const sources = await styleSources();
  const featureSelector = /\.(?:calendar-(?!feed)[\w-]+|agenda-[\w-]+|month-toolbar[\w-]*|dashboard-[\w-]+|metric-(?:grid|card)[\w-]*|child-stat[\w-]*|upcoming-list[\w-]*|quality-list)\b/;
  for (const { path: sourcePath, source, layer } of sources) {
    if (layer === "print" || /\/(?:calendar|dashboard)\.css$/.test(sourcePath)) continue;
    assert.doesNotMatch(source, featureSelector, `${sourcePath} must not own calendar/dashboard rules`);
  }
});

test("keeps settings and setup styles in their owners without repeated properties", async () => {
  const sources = await styleSources();
  const inventory = inventoryStyles(sources);
  const settings = /^\.(?:settings-|child-settings-|child-avatar|data-actions|external-calendar-|holiday-derive-|calendar-feed-|instance-readiness-|readiness-pills|notification-preferences-|notification-rules|assignment-|member-|invitation-)/;
  for (const rule of inventory.rules) {
    for (const selector of rule.selectors) {
      if (rule.layer === "print") continue;
      const owner = /^\.setup[-\w]/.test(selector) ? "setup" : settings.test(selector) ? "settings" : undefined;
      if (owner) assert.ok(rule.file.endsWith(`/${owner}.css`), `${selector} belongs to ${owner}, not ${rule.file}`);
      assert.doesNotMatch(selector, /\.member-invite-accept\b|\.settings-form-grid--(?:two|three)\b/);
    }
  }
  const owned = sources.filter(({ path: file }) => /\/(?:settings|setup)\.css$/.test(file));
  assert.deepEqual(repeatedStyleProperties(inventoryStyles(owned).rules), []);
  for (const { source, path: file } of owned) {
    assert.deepEqual(findRawColorCounts(source), {}, `${file} uses existing semantic colors`);
  }
});

test("keeps supporting routes in named owners and removes retired transfer presentation", async () => {
  const sources = await styleSources();
  const owned = sources.filter(({ path: file }) => supportingStyleOwners.some((owner) => file.endsWith(`/${owner}.css`)));
  assert.equal(owned.length, supportingStyleOwners.length * 2);
  assert.deepEqual(repeatedStyleProperties(inventoryStyles(owned).rules), []);
  for (const { source } of sources) {
    assert.doesNotMatch(source, /\.transfer-counts\b|\.transfer-result__meta\b/);
  }
  for (const rule of inventoryStyles(sources).rules) {
    if (rule.layer === "print") continue;
    if (rule.selectors.some((selector) => [".page--settings", ".page--backup", ".report-page", ".documentation-page"].includes(selector))) {
      assert.ok(!rule.declarations.some(({ property }) => property === "width" || property === "max-width"),
        "fluid page sizing belongs to the shared .page primitive");
    }
  }
});

test("keeps shared global primitives authoritative in their owning layer", async () => {
  const shell = await readFile(new URL("../src/styles/shell/navigation.css", import.meta.url), "utf8");
  const components = [
    "structure.css",
    "data-and-feedback.css",
    "dialogs-and-forms.css",
    "compositions.css"
  ].map(async (file) => readFile(new URL(`../src/styles/components/${file}`, import.meta.url), "utf8"));
  const pages = (await styleSources()).filter(({ layer }) => layer === "pages")
    .map(({ source }) => source).join("\n");
  const componentSource = (await Promise.all(components)).join("\n");

  assert.equal(occurrenceCount(shell, ".sidebar {"), 1);
  assert.equal(occurrenceCount(componentSource, ".page {"), 1);
  assert.equal(occurrenceCount(componentSource, ".panel__header {"), 1);
  assert.equal(occurrenceCount(pages, ".calendar-event {"), 1);
  assert.equal(occurrenceCount(pages, ".settings-section {"), 0, "section spacing belongs to .page > .panel");
  assert.equal(occurrenceCount(pages, ".settings-form-grid {"), 1);
  assert.equal(occurrenceCount(pages, ".list-toolbar {"), 1);
});

test("rejects unlayered application rules", () => {
  const entry = [
    "@layer tokens, base;",
    '@import "./styles/tokens.css" layer(tokens);',
    '@import "./styles/base.css" layer(base);',
    "body { color: red; }"
  ].join("\n");

  assert.deepEqual(validateLayerEntry(entry, ["tokens", "base"]), [
    { type: "unlayered-rule", file: "src/styles.css", detail: "body" }
  ]);
});

test("rejects imports that bypass the declared layers", () => {
  const entry = [
    "@layer tokens, base;",
    '@import "./styles/tokens.css" layer(tokens);',
    '@import "./styles/base.css" layer(base);',
    '@import "./styles/rogue.css";'
  ].join("\n");

  assert.deepEqual(validateLayerEntry(entry, ["tokens", "base"]), [
    {
      type: "layer-contract",
      file: "src/styles.css",
      detail: "layer imports do not match the declared order"
    }
  ]);
});

test("rejects raw colors beyond the reviewed debt inventory", () => {
  assert.deepEqual(findRawColorCounts(".notice { color: #FFF; box-shadow: 0 0 rgb(1 2 3 / 20%); border-color: oklch(60% 0.2 30); }"), {
    "#fff": 1,
    "oklch(60% 0.2 30)": 1,
    "rgb(1 2 3 / 20%)": 1
  });
  assert.deepEqual(validateRawColorBudget("fixture.css", ".notice { color: #fff; }", {}), [
    { type: "raw-color", file: "fixture.css", detail: "#fff exceeds reviewed count 0 (found 1)" }
  ]);
});

test("rejects duplicate or misplaced global baseline selectors", () => {
  const sources: StyleSource[] = [
    { path: "base.css", layer: "base", source: ".page { display: block; }" },
    { path: "pages.css", layer: "pages", source: ".page { padding: 1rem; }" }
  ];

  assert.deepEqual(validateBaselineOwnership(sources, { ".page": "base" }), [
    { type: "duplicate-baseline", file: "base.css, pages.css", detail: ".page has 2 top-level definitions" },
    { type: "misowned-baseline", file: "pages.css", detail: ".page belongs to base, not pages" }
  ]);

  assert.deepEqual(
    validateBaselineOwnership(
      [{ path: "base.css", layer: "base", source: ".page { display: block; }\n.page { padding: 1rem; }" }],
      { ".page": "base" }
    ),
    [
      {
        type: "duplicate-baseline",
        file: "base.css, base.css",
        detail: ".page has 2 top-level definitions"
      }
    ]
  );
});

test("rejects declarations that are overwritten inside the same rule", () => {
  assert.deepEqual(findOverriddenDeclarations("fixture.css", ".nav { display: flex; display: grid; }"), [
    {
      type: "duplicate-declaration",
      file: "fixture.css",
      detail: "display is declared more than once in .nav"
    }
  ]);
  assert.equal(findOverriddenDeclarations("fixture.css", ".field { gap: 2px; gap: 4px }").length, 1);
  assert.deepEqual(findOverriddenDeclarations("fixture.css", '.field { content: "color: red; color: blue;"; --Name: 1; --name: 2 }'), []);
});

test("rejects viewport breakpoints outside responsive ownership or the approved set", () => {
  const sources: StyleSource[] = [
    {
      path: "components.css",
      layer: "components",
      source: "@media (max-width: 777px) { .panel { display: block; } }"
    }
  ];

  assert.deepEqual(validateBreakpointOwnership(sources, ["(max-width: 767px)"]), [
    {
      type: "misowned-breakpoint",
      file: "components.css",
      detail: "(max-width: 777px) belongs to responsive"
    },
    {
      type: "unapproved-breakpoint",
      file: "components.css",
      detail: "(max-width: 777px)"
    }
  ]);
});

test("keeps the repository within the reviewed style contracts", async () => {
  const sources = await styleSources();
  const tokenOnlySources = sources.filter(({ layer, path: sourcePath }) =>
    layer === "shell" || layer === "components" ||
    sourcePath.endsWith("responsive/shell.css") || sourcePath.endsWith("responsive/components.css") ||
    /\/(?:calendar|dashboard)\.css$/.test(sourcePath));
  const issues = [
    ...layerNames.filter((layer) => layer !== "tokens").flatMap((layer) => {
      const budgetPath = `src/styles/${layer}.css`;
      const source = sources
        .filter((candidate) => candidate.layer === layer)
        .map((candidate) => candidate.source)
        .join("\n");
      return validateRawColorBudget(budgetPath, source, rawColorBudget[budgetPath] ?? {});
    }),
    ...validateBaselineOwnership(sources, baselineOwners),
    ...validateBreakpointOwnership(sources, approvedViewportQueries),
    ...tokenOnlySources
      .flatMap(({ path: sourcePath, source }) => findOverriddenDeclarations(sourcePath, source))
  ];

  assert.deepEqual(issues, []);
  for (const { path: sourcePath, source } of tokenOnlySources) {
    assert.deepEqual(findRawColorCounts(source), {}, `${sourcePath} must use semantic color roles`);
  }
});

test("defines the semantic color roles required by shared interface styles", async () => {
  const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const requiredTokens = [
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-subtle",
    "--color-text-control",
    "--color-text-navigation",
    "--color-text-emphasis",
    "--color-text-supporting",
    "--color-text-placeholder",
    "--color-text-on-accent",
    "--color-surface-canvas",
    "--color-surface-panel",
    "--color-surface-subtle",
    "--color-surface-raised",
    "--color-surface-overlay",
    "--color-border-default",
    "--color-border-strong",
    "--color-border-hover",
    "--color-border-accent",
    "--color-focus-ring",
    "--color-focus-ring-control",
    "--color-action-primary",
    "--color-action-primary-hover",
    "--color-status-info-text",
    "--color-status-info-surface",
    "--color-status-info-border",
    "--color-status-success-text",
    "--color-status-success-surface",
    "--color-status-success-border",
    "--color-status-warning-text",
    "--color-status-warning-surface",
    "--color-status-warning-border",
    "--color-status-danger-text",
    "--color-status-danger-surface",
    "--color-status-danger-border",
    "--color-status-unavailable-text",
    "--color-status-unavailable-surface",
    "--color-status-unavailable-border",
    "--color-overlay-backdrop",
    "--shadow-action-primary",
    "--shadow-dialog"
  ];

  for (const token of requiredTokens) assert.match(tokens, new RegExp(`${token}:`));
});

test("defines every semantic color and shadow used by calendar and dashboard", async () => {
  const sources = await styleSources();
  const tokens = sources.find(({ layer }) => layer === "tokens")!.source;
  for (const { path: sourcePath, source } of sources.filter(({ path: sourcePath }) =>
    /\/(?:calendar|dashboard)\.css$/.test(sourcePath))) {
    for (const match of source.matchAll(/var\((--(?:color|shadow)-[\w-]+)\)/g)) {
      assert.ok(tokens.includes(`${match[1]}:`), `${sourcePath}: undefined role ${match[1]}`);
    }
  }
});

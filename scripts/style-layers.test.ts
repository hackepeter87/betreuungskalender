import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
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

async function styleSources(): Promise<StyleSource[]> {
  return Promise.all(
    layerNames.map(async (layer) => ({
      path: `src/styles/${layer}.css`,
      layer,
      source: await readFile(new URL(`../src/styles/${layer}.css`, import.meta.url), "utf8")
    }))
  );
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
  const sources = await Promise.all(
    layerNames.map(async (name) => ({
      name,
      source: await readFile(new URL(`../src/styles/${name}.css`, import.meta.url), "utf8")
    }))
  );

  for (const { name, source } of sources) {
    assert.ok(source.trim().length > 0, `${name}.css must not be empty`);
    assert.doesNotMatch(source, /\/\*\s*v\d+\.\d+/i);
  }

  assert.match(sources.find(({ name }) => name === "tokens")!.source, /^\/\*[^]*?:root\s*\{/);
  assert.match(sources.find(({ name }) => name === "components")!.source, /\.panel\s*\{/);
  assert.match(sources.find(({ name }) => name === "pages")!.source, /\.calendar-grid\s*\{/);
  assert.match(sources.find(({ name }) => name === "responsive")!.source, /@media\s*\(/);
  assert.match(sources.find(({ name }) => name === "print")!.source, /@media\s+print/);
});

test("keeps shared global primitives authoritative in their owning layer", async () => {
  const shell = await readFile(new URL("../src/styles/shell.css", import.meta.url), "utf8");
  const components = await readFile(new URL("../src/styles/components.css", import.meta.url), "utf8");
  const pages = await readFile(new URL("../src/styles/pages.css", import.meta.url), "utf8");

  assert.equal(occurrenceCount(shell, ".sidebar {"), 1);
  assert.equal(occurrenceCount(components, ".page {"), 1);
  assert.equal(occurrenceCount(components, ".panel__header {"), 1);
  assert.equal(occurrenceCount(pages, ".calendar-event {"), 1);
  assert.equal(occurrenceCount(pages, ".settings-section {"), 1);
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
  const issues = [
    ...sources
      .filter(({ layer }) => layer !== "tokens")
      .flatMap(({ path, source }) => validateRawColorBudget(path, source, rawColorBudget[path] ?? {})),
    ...validateBaselineOwnership(sources, baselineOwners),
    ...validateBreakpointOwnership(sources, approvedViewportQueries)
  ];

  assert.deepEqual(issues, []);
});

test("defines the semantic color roles required by shared interface styles", async () => {
  const tokens = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const requiredTokens = [
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-subtle",
    "--color-text-on-accent",
    "--color-surface-canvas",
    "--color-surface-panel",
    "--color-surface-subtle",
    "--color-border-default",
    "--color-border-strong",
    "--color-focus-ring",
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
    "--color-status-danger-border"
  ];

  for (const token of requiredTokens) assert.match(tokens, new RegExp(`${token}:`));
});

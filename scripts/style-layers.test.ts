import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

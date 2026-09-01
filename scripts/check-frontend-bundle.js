import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_CHUNK_BYTES = 500_000;
const MANIFEST_PATH = resolve("dist/.vite/manifest.json");

function collectStaticImports(manifest, entryKey) {
  const visited = new Set();
  const pending = [entryKey];

  while (pending.length) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    for (const importedKey of manifest[key]?.imports ?? []) pending.push(importedKey);
  }

  return visited;
}

export async function validateFrontendBundle() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
  assert.ok(entryKey, "Vite manifest does not contain an application entry");

  const initialModules = collectStaticImports(manifest, entryKey);
  for (const deferredSource of [
    "src/pages/AnalyticsPage.tsx",
    "src/pages/ReportPage.tsx"
  ]) {
    assert.ok(manifest[deferredSource]?.isDynamicEntry, `${deferredSource} is not a deferred entry`);
    assert.equal(initialModules.has(deferredSource), false, `${deferredSource} is part of the initial graph`);
  }

  const assetDirectory = resolve("dist/assets");
  const oversizedChunks = [];
  for (const fileName of await readdir(assetDirectory)) {
    if (!fileName.endsWith(".js")) continue;
    const bytes = (await stat(resolve(assetDirectory, fileName))).size;
    if (bytes > MAX_CHUNK_BYTES) oversizedChunks.push({ fileName, bytes });
  }
  assert.deepEqual(
    oversizedChunks,
    [],
    `JavaScript chunks exceed ${MAX_CHUNK_BYTES} bytes: ${JSON.stringify(oversizedChunks)}`
  );

  const initialFiles = [...initialModules]
    .map((key) => manifest[key]?.file)
    .filter(Boolean);
  assert.equal(
    initialFiles.some((fileName) => /jspdf|autotable|html2canvas|purify/i.test(fileName)),
    false,
    "PDF dependencies are part of the initial application graph"
  );
}

await validateFrontendBundle();

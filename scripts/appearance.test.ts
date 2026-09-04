import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/appearance.js", import.meta.url), "utf8");
const storageKey = "betreuungskalender.appearance.v1";

function browser(saved: string | null, dark: boolean, storageDenied = false) {
  const listeners = new Map<string, (event?: Record<string, unknown>) => void>();
  const dataset: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  const storage = new Map(saved === null ? [] : [[storageKey, saved]]);
  let mediaChange: () => void = () => undefined;
  const media = { matches: dark, addEventListener: (_: string, handler: () => void) => { mediaChange = handler; } };
  const window = {
    matchMedia: () => media,
    localStorage: {
      getItem: (key: string) => { if (storageDenied) throw Error("denied"); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (storageDenied) throw Error("denied"); storage.set(key, value); }
    },
    addEventListener: (name: string, handler: (event?: Record<string, unknown>) => void) => listeners.set(name, handler),
    dispatchEvent: (event: { type: string }) => listeners.get(event.type)?.()
  };
  vm.runInNewContext(source, {
    window,
    document: { documentElement: { dataset }, querySelector: (selector: string) => ({ setAttribute: (_: string, value: string) => { metadata[selector] = value; } }) },
    Event: class { constructor(public type: string) {} }
  });
  return {
    dataset, metadata, storage,
    select: (detail: unknown) => listeners.get("appearance-preference-change")?.({ detail }),
    system: (dark: boolean) => { media.matches = dark; mediaChange(); },
    external: (key: string | null, newValue: string | null) => listeners.get("storage")?.({ key, newValue, storageArea: window.localStorage })
  };
}

test("appearance bootstrap resolves the system before app startup without persisting a default", () => {
  const page = browser(null, true);
  assert.equal(page.dataset.appearance, "dark");
  assert.equal(page.dataset.appearancePreference, "system");
  assert.equal(page.storage.size, 0);
  assert.equal(page.metadata['meta[name="theme-color"]'], "#191d20");
  page.system(false);
  assert.equal(page.dataset.appearance, "light");
});

test("explicit preferences survive reload and override later system changes", () => {
  const page = browser("dark", false);
  page.system(false);
  assert.equal(page.dataset.appearance, "dark");
  page.select("light");
  assert.equal(page.storage.get(storageKey), "light");
  page.system(true);
  assert.equal(page.dataset.appearance, "light");
  page.select("system");
  assert.equal(page.dataset.appearance, "dark");
});

test("appearance stays usable when browser storage is unavailable", () => {
  const page = browser(null, false, true);
  page.select("dark");
  assert.equal(page.dataset.appearance, "dark");
  page.system(false);
  assert.equal(page.dataset.appearance, "dark");
  assert.equal(page.storage.size, 0);
});

test("cross-tab changes, reset and invalid preferences are bounded to the appearance key", () => {
  const page = browser("invalid", true);
  assert.equal(page.dataset.appearancePreference, "system");
  page.external("unrelated", "light");
  assert.equal(page.dataset.appearance, "dark");
  page.external(storageKey, "light");
  assert.equal(page.dataset.appearance, "light");
  page.external(null, null);
  assert.equal(page.dataset.appearance, "dark");
  page.select({ malicious: "dark" });
  assert.equal(page.dataset.appearancePreference, "system");
});

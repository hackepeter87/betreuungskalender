import assert from "node:assert/strict";
import test from "node:test";
import {
  isInstallPromptDismissed,
  isIosDevice,
  isStandaloneDisplay
} from "../src/lib/pwaInstall";

test("detects iPhone, iPad and touch-capable iPad desktop user agents", () => {
  assert.equal(isIosDevice("Mozilla/5.0 (iPhone)", "iPhone", 5), true);
  assert.equal(isIosDevice("Mozilla/5.0", "MacIntel", 5), true);
  assert.equal(isIosDevice("Mozilla/5.0", "MacIntel", 0), false);
  assert.equal(isIosDevice("Mozilla/5.0 (Linux; Android 15)", "Linux", 5), false);
});

test("recognizes browser and legacy iOS standalone display modes", () => {
  assert.equal(isStandaloneDisplay(true, false), true);
  assert.equal(isStandaloneDisplay(false, true), true);
  assert.equal(isStandaloneDisplay(false, false), false);
});

test("dismissal expires after the configured cooldown", () => {
  const now = 10_000;
  assert.equal(isInstallPromptDismissed("9000", now, 2000), true);
  assert.equal(isInstallPromptDismissed("7000", now, 2000), false);
  assert.equal(isInstallPromptDismissed("invalid", now, 2000), false);
  assert.equal(isInstallPromptDismissed(null, now, 2000), false);
});

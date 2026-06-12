import assert from "node:assert/strict";
import test from "node:test";
import {
  detectLegacyBrowserData,
  ignoreLegacyFingerprint,
  isLegacyFingerprintIgnored
} from "../src/migration/legacyLocalStorage.js";
import { createEmptyData } from "../src/data/defaults.js";

function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    }
  });
  return values;
}

test("ohne alte localStorage-Fachdaten wird keine Migration erkannt", () => {
  installStorage({
    "betreuungskalender:ui:theme": "dark"
  });
  assert.equal(detectLegacyBrowserData(), null);
});

test("der bekannte Legacy-Key wird nur gelesen und klassifiziert", () => {
  const legacy = {
    ...createEmptyData(),
    children: [{
      id: "fiktives-kind",
      name: "Testkind",
      birthMonth: 5,
      birthYear: 2018,
      color: "#087f7b",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const raw = JSON.stringify(legacy);
  const storage = installStorage({
    "betreuungskalender:data:v1": raw
  });
  const detected = detectLegacyBrowserData();
  assert.equal(detected?.counts.children, 1);
  assert.equal(storage.get("betreuungskalender:data:v1"), raw);
});

test("Ignorieren speichert nur den Fingerabdruck als UI-Präferenz", () => {
  const storage = installStorage({
    "betreuungskalender:data:v1": JSON.stringify(createEmptyData())
  });
  const detected = detectLegacyBrowserData();
  assert.ok(detected);
  ignoreLegacyFingerprint(detected.fingerprint);
  assert.equal(isLegacyFingerprintIgnored(detected.fingerprint), true);
  assert.ok(storage.has("betreuungskalender:data:v1"));
});

test("ungültige Legacy-Struktur wird nicht als importierbarer Teilbestand behandelt", () => {
  installStorage({
    "betreuungskalender:data:v1": JSON.stringify({
      schemaVersion: 4,
      children: "ungültig",
      entries: []
    })
  });
  const detected = detectLegacyBrowserData();
  assert.equal(detected?.data, undefined);
  assert.ok((detected?.invalidRecords ?? 0) > 0);
});

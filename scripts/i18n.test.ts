import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLocale,
  getMissingTranslationKeys,
  localeMetadata,
  supportedLocales,
  translate
} from "../src/i18n/resources";
import { catalog } from "../src/i18n/catalog";

function nestedKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value) || typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    nestedKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

test("uses German as the default locale", () => {
  assert.equal(defaultLocale, "de");
  assert.equal(localeMetadata.de.intlLocale, "de-DE");
});

test("provides the initial German and English language packs", () => {
  assert.deepEqual(supportedLocales, ["de", "en"]);
  assert.equal(translate("de", "nav.dashboard"), "Übersicht");
  assert.equal(translate("en", "nav.dashboard"), "Overview");
});

test("reports missing translations for development checks", () => {
  assert.deepEqual(getMissingTranslationKeys("de"), []);
  assert.deepEqual(getMissingTranslationKeys("en"), []);
});

test("keeps every central catalog resource key aligned across locales", () => {
  assert.deepEqual(nestedKeys(catalog.de).sort(), nestedKeys(catalog.en).sort());
  assert.equal(catalog.de.legacy.title, "Ältere Browserdaten");
  assert.equal(catalog.en.legacy.title, "Older browser data");
  assert.ok(catalog.de.contact.title);
  assert.ok(catalog.de.audit.title);
  assert.ok(catalog.de.documentation.title);
});

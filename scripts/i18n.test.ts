import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLocale,
  getMissingTranslationKeys,
  localeMetadata,
  supportedLocales,
  translate
} from "../src/i18n/resources";

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

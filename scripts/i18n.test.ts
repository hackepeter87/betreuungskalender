import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  defaultLocale,
  getMissingTranslationKeys,
  localeMetadata,
  supportedLocales,
  translate
} from "../src/i18n/resources";
import { catalog } from "../src/i18n/catalog";
import {
  findLocaleSpreadAssignments,
  findUnregisteredDynamicCatalogCalls,
  formatTranslationCoverageIssues,
  validateTranslationCoverage
} from "./i18n-coverage";

function nestedKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value) || typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    nestedKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return /\.tsx?$/.test(entry.name) ? [filePath] : [];
  });
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

test("ships complete catalogs with matching placeholders and value shapes", () => {
  const issues = validateTranslationCoverage("de", catalog.de, { en: catalog.en });
  assert.equal(formatTranslationCoverageIssues(issues), "");
});

test("reports missing, unknown, inherited, and placeholder translation errors deterministically", () => {
  const issues = validateTranslationCoverage(
    "de",
    { common: { greeting: "Hallo {name}", farewell: "Tschüss" } },
    { en: { common: { greeting: "Hello {person}", extra: "Extra" } } },
    { inheritedKeys: { en: ["common.farewell"] } }
  );

  assert.equal(formatTranslationCoverageIssues(issues), [
    "en inherited: common.farewell",
    "en missing: common.farewell",
    "en placeholder: common.greeting (expected {name}, received {person})",
    "en unknown: common.extra"
  ].join("\n"));
});

test("validates dynamic keys and narrowly scoped exemptions", () => {
  const issues = validateTranslationCoverage(
    "de",
    { common: { save: "Speichern", cancel: "Abbrechen" } },
    { en: { common: { save: "Save" } } },
    {
      dynamicKeys: ["common.save", "common.unknown"],
      exemptions: { en: ["common.cancel", "common.unknown"] }
    }
  );

  assert.deepEqual(issues, [
    { locale: "de", key: "common.unknown", type: "invalid-dynamic" },
    { locale: "en", key: "common.unknown", type: "invalid-exemption" }
  ]);
});

test("does not allow translated locale objects to spread the default locale", () => {
  assert.deepEqual(
    findLocaleSpreadAssignments("const en = { ...de, common: { ...de.common } };", "en"),
    ["de", "de.common"]
  );

  const catalogSource = fs.readFileSync(path.resolve("src/i18n/catalog.ts"), "utf8");
  assert.deepEqual(findLocaleSpreadAssignments(catalogSource, "en"), []);
});

test("requires dynamic catalog keys to use the typed catalogKey marker", () => {
  assert.deepEqual(
    findUnregisteredDynamicCatalogCalls('copy(locale, "common", condition ? "save" : "cancel")'),
    ['1:24 condition ? "save" : "cancel"']
  );
  assert.deepEqual(
    findUnregisteredDynamicCatalogCalls('copy(locale, "common", catalogKey("common", condition ? "save" : "cancel"))'),
    []
  );

  const findings = sourceFiles(path.resolve("src")).flatMap((filePath) =>
    findUnregisteredDynamicCatalogCalls(fs.readFileSync(filePath, "utf8"))
      .map((finding) => `${path.relative(process.cwd(), filePath)}:${finding}`)
  );
  assert.deepEqual(findings, []);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { encodeCsvCell, encodeCsvRows } from "../src/lib/export";

test("CSV cells neutralize spreadsheet formulas while preserving typed values", () => {
  const dangerousText = [
    "=SUM(A1:A2)",
    "+cmd",
    "-1+2",
    "@SUM(A1:A2)",
    "  =SUM(A1:A2)",
    "\t=SUM(A1:A2)",
    "\r@SUM(A1:A2)",
    "\n-cmd"
  ];
  for (const value of dangerousText) {
    assert.equal(encodeCsvCell(value), `"'${value.replaceAll('"', '""')}"`);
  }

  assert.equal(encodeCsvCell(-12.5), '"-12.5"');
  assert.equal(encodeCsvCell(true), '"ja"');
  assert.equal(encodeCsvCell(false), '"nein"');
  assert.equal(encodeCsvCell("2026-09-13"), '"2026-09-13"');
  assert.equal(encodeCsvCell("ÄÖÜ;Zeile\n\"Zitat\""), '"ÄÖÜ;Zeile\n""Zitat"""');
  assert.equal(encodeCsvCell("  normaler Text"), '"  normaler Text"');
  assert.equal(encodeCsvCell(undefined), '""');
});

test("CSV row encoding keeps the established delimiter, BOM, and line endings", () => {
  assert.equal(
    encodeCsvRows([["Titel", "=FORMEL"], [1, false]]),
    '\uFEFF"Titel";"\'=FORMEL"\r\n"1";"nein"'
  );
});

test("every current CSV export uses the shared row encoder", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/export.ts"), "utf8");
  const exportFunctions = [
    "exportEntriesCsv",
    "exportTripsCsv",
    "exportCostsCsv",
    "exportHolidaysCsv",
    "exportUnavailablePeriodsCsv"
  ];
  for (const name of exportFunctions) {
    const start = source.indexOf(`export function ${name}`);
    assert.notEqual(start, -1, name);
    const nextExport = source.indexOf("\nexport function ", start + 1);
    const body = source.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.match(body, /downloadText\([^,]+, encodeCsvRows\(rows\)\)/, name);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("operator legal templates stay visibly incomplete", async () => {
  const templates = await Promise.all([
    readFile("docs/examples/legal/impressum.txt.example", "utf8"),
    readFile("docs/examples/legal/datenschutz.txt.example", "utf8")
  ]);
  for (const template of templates) {
    assert.match(template, /^BETREIBERVORLAGE - NICHT VERÖFFENTLICHUNGSFERTIG/);
    assert.match(template, /\[BETREIBER: /);
    assert.match(template, /rechtlich prüfen lassen/);
  }
});

test("privacy and notice examples cover the documented review categories", async () => {
  const [notice, privacy] = await Promise.all([
    readFile("docs/examples/legal/impressum.txt.example", "utf8"),
    readFile("docs/examples/legal/datenschutz.txt.example", "utf8")
  ]);
  for (const heading of ["Pflichtangaben zum Anbieter", "Direkter Kontakt", "Registerangaben", "Aufsichtsbehörde", "Reglementierter Beruf"])
    assert.match(notice, new RegExp(heading));
  for (const heading of ["Verantwortlicher", "betroffene Personen und Datenquellen", "Identitätsverarbeitung", "Familien- und Betreuungsdokumentation", "Cookies und Browser-Speicher", "Empfänger, Auftragsverarbeiter und Drittlandtransfers", "Speicherbegrenzung und Löschung", "Rechte und Beschwerden", "automatisierte Entscheidungen"])
    assert.match(privacy, new RegExp(heading, "i"));
});

test("deployment examples keep legal content mounts read-only", async () => {
  const [guide, values] = await Promise.all([
    readFile("docs/legal-information.md", "utf8"),
    readFile("charts/betreuungskalender/examples/legal-content-values.yaml", "utf8")
  ]);
  assert.match(guide, /\.\/legal:\/run\/config\/legal:ro/);
  assert.match(guide, /dst=\/run\/config\/legal,readonly/);
  assert.match(guide, /dst=\/run\/config\/legal,ro=true/);
  assert.match(values, /mountPath: \/run\/config\/legal\s+readOnly: true/);
});

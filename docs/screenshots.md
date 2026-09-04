# Screenshots

Die Screenshots in `docs/assets/screenshots/` zeigen ausschließlich fiktive
Demonstrationsdaten aus der bestehenden visuellen Testsuite. Das README
verwendet genau diese beiden Bilder:

| Datei | Ansicht | Geprüfte Linux-Referenz |
| --- | --- | --- |
| `dashboard-desktop.png` | Übersicht, 1440 × 900 CSS-Pixel | `e2e/visual-regression.spec.ts-snapshots/dashboard-visual-1440-linux.png` |
| `calendar-mobile.png` | Kalenderagenda, 390 × 844 CSS-Pixel | `e2e/visual-regression.spec.ts-snapshots/calendar-visual-390-linux.png` |

## Reproduzieren

Nur einen separaten Entwicklungs-Checkout ohne `.env`, Betreiber-Secrets oder
produktive Datenbankverbindung verwenden. Die Tests ersetzen ihren
Testdatenbestand. Nie gegen eine bestehende Installation ausführen; auf einem
Checkout nur einen E2E-Lauf gleichzeitig starten.

Die gemeinsame Fixture `e2e/visual-fixture.ts` setzt fiktive Kinder und
Betreuungseinträge, feste Laufzeitmetadaten und die Browserzeit auf
`2026-09-02T10:00:00.000Z`. Die Projekte `visual-1440` und `visual-390` verwenden
Deutsch, `Europe/Berlin`, den hellen Modus und Skalierungsfaktor 1. Vor der
Aufnahme werden Schriftarten geladen und Animationen deaktiviert. Es wird der
Viewport ohne Browser-Rahmen aufgenommen, nicht die gesamte lange Seite.

Die Linux-Laufzeit und Einrichtung sind in
[Visual regression testing](visual-regression-testing.md) dokumentiert. In
dieser Umgebung die vorhandenen Referenzen zunächst unverändert prüfen:

```bash
npx playwright test e2e/visual-regression.spec.ts --project=visual-1440 --project=visual-390 --retries=0
```

Bei einer beabsichtigten UI-Änderung zuerst den Vorher-/Nachher-Vergleich prüfen,
erst dann die betroffenen Testreferenzen nach dem dort beschriebenen Verfahren
aktualisieren. Zwei anschließende Prüfläufe müssen ohne Aktualisierung bestehen.
Für die Dokumentation die freigegebenen Bilder unverändert übernehmen:

```bash
cp e2e/visual-regression.spec.ts-snapshots/dashboard-visual-1440-linux.png docs/assets/screenshots/dashboard-desktop.png
cp e2e/visual-regression.spec.ts-snapshots/calendar-visual-390-linux.png docs/assets/screenshots/calendar-mobile.png
```

Damit bleiben Testansicht und Dokumentation identisch. Keine zweite Fixture,
separaten Screenshot-Generator oder nachträgliche Bildretusche einführen.

## Datenschutzprüfung

Vor dem Hinzufügen neuer Screenshots prüfen:

- keine echten Kindernamen
- keine echten Adressen
- keine echten Belegreferenzen
- keine echten Notizen
- keine echten E-Mail-Adressen
- keine echten Domains
- keine echten Kalenderdaten aus einem privaten Fall
- keine sichtbaren Tokens oder Secrets
- keine Browser-Adressleiste mit interner Domain, falls privat

Vor dem Commit jede sichtbare Beschriftung und den Browser-Rahmen prüfen.
Dokumentationsbilder werden ausschließlich unter `docs/assets/screenshots/`
abgelegt. Testfehlerbilder, Traces und Datenbanken bleiben in ignorierten
Ausgabeverzeichnissen. Im PR den geprüften Commit, die Bildquellen und die
erfolgte Sichtprüfung dokumentieren; keine privaten Aufnahmen anhängen.

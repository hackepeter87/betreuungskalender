# Migration älterer Browserdaten

Frühere Versionen des Betreuungskalenders speicherten fachliche Daten unter
`betreuungskalender:data:v1` im `localStorage` des jeweiligen Browsers. Die
aktuelle App verwendet ausschließlich SQLite über die API. Der
Migrationsassistent übernimmt einen noch vorhandenen Altbestand kontrolliert in
SQLite.

## Wann erscheint der Dialog?

Der Dialog erscheint nach erfolgreicher Verbindung mit dem Backend, wenn der
bekannte Legacy-Schlüssel im aktuellen Browser vorhanden ist. UI-Einstellungen
wie Theme oder letzte Ansicht lösen keine Migration aus. Ohne Legacy-Daten
erscheint kein Hinweis.

Der alte Browserbestand wird nur gelesen. Er wird weder beim Erkennen noch nach
einem Import automatisch verändert oder gelöscht. Die App protokolliert
Erkennung, Vorschau, Import, Überspringen und Fehler ohne vollständige Notizen,
Belegtexte oder andere lange fachliche Inhalte im Audit Log.

## Vorgehen

### Zusätzlich importieren

Neue Datensätze werden in den bestehenden SQLite-Bestand aufgenommen.
Potenzielle Duplikate werden standardmäßig übersprungen. Konflikte werden in der
Vorschau und im Migrationsprotokoll ausgewiesen; vorhandene SQLite-Datensätze
werden nicht überschrieben. Ergänzungen in abgeschlossenen Monaten werden
besonders markiert.

### Nur prüfen

Die App zeigt Anzahl, nicht importierbare Datensätze, Warnungen, potenzielle
Duplikate und Konflikte. SQLite-Fachdaten werden dabei nicht verändert. Bei
Unsicherheit sollte immer zuerst **Nur prüfen** verwendet werden.

### Ersetzen nach Backup

Dieser Modus ersetzt den aktuellen SQLite-Datenstand. Unmittelbar vorher wird
über die SQLite-Backup-API eine Sicherung in `BACKUP_DIR` erstellt. Schlägt die
Sicherung fehl, beginnt der Import nicht. Der eigentliche Ersatz läuft in einer
Datenbanktransaktion und wird bei Fehlern vollständig zurückgerollt.

### Ignorieren

Es werden keine Fachdaten geschrieben. Optional merkt sich der Browser nur den
Fingerabdruck dieses Legacy-Bestands als UI-Präferenz, damit derselbe Hinweis
nicht erneut erscheint. Der Legacy-Schlüssel selbst bleibt bestehen.

## Duplikate und Konflikte

Betreuungseinträge gelten als potenzielle Duplikate, wenn Start und Ende
höchstens 15 Minuten abweichen und Kinder, Status, Betreuungsumfang sowie Ort
übereinstimmen. Fahrten und Kosten werden innerhalb dieses
Betreuungskontexts anhand von Zweck/Kilometern beziehungsweise
Kategorie/Betrag verglichen. Ferien werden anhand von Zeitraum, Kindern und
Zuordnung verglichen.

Als Konflikt gelten insbesondere zeitliche Überschneidungen mit abweichendem
Status, anderen Kindern oder anderem Betreuungsumfang. Auch ein in SQLite
geplanter, im Browserbestand aber durchgeführter Termin sowie betroffene
abgeschlossene Monate werden ausdrücklich angezeigt.

Die Erkennung ist bewusst konservativ. Eine Kennzeichnung ist ein Prüfhinweis,
keine juristische oder inhaltliche Bewertung.

## Nach der Migration

Das Ergebnisprotokoll kann als JSON heruntergeladen werden und enthält Modus,
Zeiten, Summen, übersprungene Duplikate, Konflikte, Warnungen sowie den Namen
der gegebenenfalls erstellten SQLite-Sicherung. Es enthält keine vollständigen
fachlichen Datensätze.

Nach erfolgreicher Migration sollte zusätzlich in der App ein vollständiges
JSON-Backup erstellt und sicher abgelegt werden. Für die betriebliche
Wiederherstellung bleibt ein geprüftes SQLite-Backup maßgeblich.

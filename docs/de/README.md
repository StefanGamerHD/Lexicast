# Lexicast-Dokumentation

Lexicast ist ein selbst hostbarer Server für Übersetzungen. Übersetzer schlagen Texte vor, eine zweite Person gibt sie frei, ein Projekt-Owner veröffentlicht ein Release, und laufende Apps holen sich die neuen Texte innerhalb von Minuten. Jedes Release besteht aus unveränderlichen JSON-Dateien und einem mit Ed25519 signierten Manifest. So können Apps prüfen, dass die Texte wirklich von deinem Server kommen.

> Stand: früh, nicht für den produktiven Einsatz gedacht. Diese Dokumentation beschreibt, was heute im Code existiert, und kennzeichnet, was geplant ist.

English version: [docs/en](../en/README.md)

## Inhalt
| Seite | Für wen | Worum es geht |
|---|---|---|
| [Installation](installation.md) | Betreiber | Docker, Node, erster Start, Reverse Proxy |
| [Konfiguration](configuration.md) | Betreiber | alle Umgebungsvariablen |
| [Bedienung](user-guide.md) | alle | Rollen, Übersetzen, Prüfen, Releases |
| [API-Referenz](api.md) | Entwickler, Betreiber | alle JSON-Endpunkte |
| [Auslieferung und Client](delivery.md) | App-Entwickler | Release-Dateien, Manifest, Signaturprüfung |
| [Sicherheit](security.md) | alle | wie Lexicast Texte, Konten und Schlüssel schützt |
| [Betrieb](operations.md) | Betreiber | Backup, Updates, Mail, Health-Check, Fehlersuche |
| [Entwicklung](development.md) | Mitwirkende | Code-Aufbau, Tests, Mitarbeit |

## Wie alles zusammenspielt
```
Übersetzer ──Vorschlag──▶ Lexicast ◀──Freigabe── Prüfer
                             │
                   Owner: „Release“
                             ▼
        signiertes Manifest + JSON-Dateien (/p/{projekt}/...)
                             ▼
            App mit dem Lexicast-Client (prüft die Signatur)
```
1. Der Owner importiert die Ausgangstexte (Keys) eines Projekts.
2. Übersetzer schreiben Vorschläge für ihre Sprachen.
3. Ein Prüfer dieser Sprache gibt sie frei oder lehnt sie ab. Niemand gibt den eigenen Text frei (Vier-Augen-Prinzip).
4. Der Owner baut ein Release. Lexicast schreibt die Dateien, signiert das Manifest und veröffentlicht es.
5. Apps fragen das Manifest regelmäßig ab, prüfen die Signatur und wechseln auf die neuen Texte. Wenn etwas nicht stimmt, behalten sie die Texte, die sie haben.

## Was es gibt und was geplant ist
| Bereich | Stand |
|---|---|
| Einrichtung, Konten, Einladungen, Passwort-Reset, Mail | fertig (API und Oberfläche) |
| Projekte, Sprachen mit Fallback-Ketten, Mitglieder, Einladungen und Rollen | fertig (API und Oberfläche) |
| Keys und JSON-Import mit Vorschau | fertig (API und Oberfläche) |
| Vorschläge und Prüfung (Vier-Augen-Prinzip, Solo-Modus) | fertig (API und Oberfläche) |
| Releases, Rollback, Verlauf | fertig (API und Oberfläche) |
| Statische Auslieferung, öffentliche Fortschrittsseite | fertig |
| Kontoseite (Profil, Benachrichtigungen, Passwort) | fertig (API und Oberfläche) |
| Instanz-Admin-Bereich (Personen, Instanz-Einladungen, Audit-Log) | geplant (UI-Teil 4b) |
| API-Tokens, Backup/Restore-Befehl, Audit-Log-Ansicht, Schlüsselrotation | geplant |
| Client-Bibliothek (MIT, eigenes Repository) | nur Prototyp, nicht veröffentlicht |

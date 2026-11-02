# Lexicast

Selbst hostbarer Server für Übersetzungen, die von einer zweiten Person geprüft, signiert und live an laufende Apps ausgeliefert werden.

[English](README.md) · **Deutsch**

> Stand: früh, nicht für den produktiven Einsatz gedacht. Die Server-API für Meilenstein 1 ist vollständig; die Weboberfläche umfasst Einrichtung, Konten, Projekte, Übersetzen, Prüfen, Keys mit JSON-Import und Releases mit Rollback. Seiten für Mitglieder, Sprachen, Projekteinstellungen und Verwaltung folgen.

## Wozu
Übersetzer schlagen Texte in einem Web-Editor vor, eine zweite Person gibt sie frei, ein Projekt-Owner drückt „Release“, und Apps holen sich die neuen Texte innerhalb von Minuten. Jedes Release besteht aus unveränderlichen JSON-Dateien und einem mit Ed25519 signierten Manifest; Apps prüfen die Signatur, lehnen ältere Releases ab und fallen auf mitgelieferte Texte zurück. Ein Container, SQLite, kein externer Speicher.

## Funktionen
- Konten nur per Einladung, Passwort-Reset per Mail, Oberfläche auf Deutsch und Englisch, hell und dunkel
- Projekte mit Sprachen und Fallback-Ketten (`de-AT` → `de` → `en`, beim Bauen aufgelöst)
- Rollen pro Projekt und Sprache: Owner, Prüfer, Übersetzer; der Instanz-Admin hat keinen automatischen Projektzugriff
- Keys mit JSON-Import (flach oder verschachtelt, Vorschau, ganz oder gar nicht)
- Übersetzen-Ansicht mit Filtern, Platzhalter-Chips, Regelprüfung beim Tippen, Entwürfen im Browser, Tastenkürzeln
- Prüf-Warteschlange mit Wort-Diff, Warnungen, Ablehnen mit Begründung, Sammelfreigabe; Vier-Augen-Prinzip (Solo-Modus als protokollierte Ausnahme)
- Releases: Vorschau, signierte Veröffentlichung, Verlauf, Rollback als neues Release
- Statische Auslieferung mit ETag, CORS und Ratenbegrenzung; öffentliche Fortschrittsseite (optional, nur Zahlen)
- Signaturschlüssel in eigenem Signer-Prozess; strenge Content-Security-Policy; Audit-Log

## Schnellstart
```bash
git clone https://github.com/StefanGamerHD/Lexicast.git && cd Lexicast
cp .env.example .env            # LEXICAST_BASE_URL auf deine öffentliche https-Adresse setzen
docker compose up -d --build
docker compose logs lexicast    # das einmalige Setup-Token kopieren
```
Stelle einen Reverse Proxy mit TLS davor (der Container-Port ist an localhost gebunden), öffne deine Adresse, gib das Setup-Token ein und lege das Admin-Konto an. Kopiere den öffentlichen Signaturschlüssel, der danach angezeigt wird, in deine Apps.

## Dokumentation
Vollständige Dokumentation in [docs/de](docs/de/README.md) (Englisch: [docs/en](docs/en/README.md)):

[Installation](docs/de/installation.md) · [Konfiguration](docs/de/configuration.md) · [Bedienung](docs/de/user-guide.md) · [API-Referenz](docs/de/api.md) · [Auslieferung und Client](docs/de/delivery.md) · [Sicherheit](docs/de/security.md) · [Betrieb](docs/de/operations.md) · [Entwicklung](docs/de/development.md)

## Entwicklung
```bash
npm ci
npm run typecheck && npm test
npm run build:web && npm run test:e2e   # vorher einmal: npx playwright install chromium
npm start                               # http://127.0.0.1:8787
```
Node 24+, TypeScript direkt von Node ausgeführt, eine Laufzeit-Abhängigkeit (nodemailer). Die Oberfläche ist Svelte + Vite (nur Entwicklungsabhängigkeiten). Siehe [Entwicklung](docs/de/development.md) und [CONTRIBUTING.md](CONTRIBUTING.md); Commits werden nach dem DCO abgezeichnet.

## Sicherheit
Bitte melde Schwachstellen vertraulich, siehe [SECURITY.md](SECURITY.md).

## Lizenz
AGPL-3.0-only für den Server (siehe `LICENSE`). Die Client-Bibliothek wird MIT in einem eigenen Repository.

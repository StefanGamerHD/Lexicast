# Auslieferung und Client

Apps sprechen nie mit der API. Sie lesen statische, öffentliche Dateien, die ein Release schreibt. Keine Anmeldung, keine Cookies.

## Dateien
```
GET /p/{projekt}/manifest.json        das aktuelle Release (ändert sich mit jedem Release)
GET /p/{projekt}/manifest.json.sig    Ed25519-Signatur von manifest.json, base64url
GET /p/{projekt}/r/{n}/{sprache}.json Texte von Release n für eine Sprache (ändern sich nie)
```
- Nur GET und HEAD, nur diese Pfadformen; alles andere ist `404`.
- `ETag` auf jeder Datei; mit `If-None-Match` bekommst du `304 Not Modified`.
- `Cache-Control`: Manifest und Signatur `public, max-age=60`; Release-Dateien `public, max-age=31536000, immutable`.
- CORS: Browser dürfen von den Origins in `LEXICAST_ALLOWED_ORIGINS` laden (Standard: alle).
- Ratenbegrenzung: `LEXICAST_RATE_PER_MINUTE` pro IP (Standard 600); darüber `429` mit `Retry-After: 30`.

## Manifest
```json
{
  "v": 1,
  "project": "shop",
  "release": 7,
  "created": "2026-11-02T10:00:00.000Z",
  "sourceLanguage": "en",
  "languages": {
    "de": { "path": "r/7/de.json", "sha256": "…64 Hex-Zeichen…", "keys": 120 },
    "en": { "path": "r/7/en.json", "sha256": "…", "keys": 120 }
  }
}
```
- `release` wird mit jedem Release größer, auch bei einem Rollback.
- `sha256` ist der Hash der genauen Bytes der Sprachdatei.

## Sprachdateien
Ein flaches JSON-Objekt, Keys sortiert, Werte als reiner Text:
```json
{
  "cart.items": "{count} Artikel im Warenkorb",
  "cart.title": "Warenkorb"
}
```
Fallbacks sind schon aufgelöst: Hat `de-AT` für einen Key keinen eigenen Text, enthält die Datei den Text aus `de` oder `en`, je nach Fallback-Kette des Projekts. Enthalten sind nur aktive Keys und Übersetzungen, die nicht veraltet sind. Texte sind reiner Text; füge sie nie als HTML ein.

## Wie ein Client ein Release prüfen muss
1. `manifest.json` laden (mit `If-None-Match`, wenn du ein ETag hast). Bei `304` hat sich nichts geändert.
2. `manifest.json.sig` laden und mit dem **öffentlichen Schlüssel** der Instanz (Ed25519) über die genauen Bytes des Manifests prüfen. Schlägt das fehl: aktuelle Texte behalten.
3. Prüfen, dass `v === 1` ist und `project` das erwartete Projekt.
4. **Ältere Releases ablehnen:** Ist `release` kleiner als das, was du schon hast, behalte deins (Schutz gegen das Wiedereinspielen eines alten, gültig signierten Manifests).
5. Die Sprachdatei von `path` laden (nur Pfade wie `r/{n}/{sprache}.json` annehmen), SHA-256 berechnen und mit `sha256` vergleichen. Stimmt es nicht: aktuelle Texte behalten.
6. Die Texte verwenden und eine Kopie (mit Release-Nummer) für den nächsten Start lokal speichern.
7. Wenn etwas schiefgeht, auf die letzten guten Texte zurückfallen, danach auf die in der App mitgelieferten Texte. Nie einen leeren Bildschirm zeigen, nur weil der Server nicht erreichbar ist.

Der öffentliche Schlüssel wird bei der Einrichtung einmal angezeigt und steht in der API unter `GET /api/v1/instance`. Baue ihn fest in deine App ein; lade ihn nicht zur Laufzeit vom selben Server (sonst ist die Signatur wertlos).

## Client-Bibliothek
Ein JavaScript-Client (MIT, eigenes Repository) ist geplant. Aus dem ersten Meilenstein gibt es einen funktionierenden Prototyp: Er nutzt `fetch` und WebCrypto Ed25519, speichert das letzte gute Release, lehnt ältere Releases ab und fällt auf mitgelieferte Texte zurück. Er wurde in Chromium gegen einen echten Server durchgetestet. Noch offen: eine klare Fehlermeldung, wenn WebCrypto Ed25519 fehlt (unsicherer Kontext, ältere Browser), Tests in Firefox, Safari und auf Handys, Veröffentlichung auf npm.

## Abfrage-Intervall
Das Manifest alle paar Minuten abzufragen ist günstig (60 Sekunden Browser-Cache, `304`-Antworten). Neue Texte erreichen Apps wenige Minuten nach einem Release.

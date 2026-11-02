# Betrieb

## Health-Check
`GET /healthz` antwortet mit `{"status":"ok","schema":3}` (schema = letzte Datenbank-Migration) oder `503`. Das Docker-Image nutzt ihn als Health-Check.

## Logs
Lexicast schreibt nach stdout/stderr: die Startzeile (Adresse, Schema, Basis-URL, Mail-Modus), vor der Einrichtung das einmalige Setup-Token, fehlgeschlagene Mails und interne Fehler mit kurzer ID (dieselbe ID sieht der Client in `500 internal`). Passwörter, Tokens und Texte werden nicht geloggt.

## Backup
Einen Backup-Befehl gibt es noch nicht (geplant: Datenbank + Konfiguration + verschlüsselter Signaturschlüssel, ohne neuere Daten zu überschreiben). Bis dahin sicherst du den ganzen Datenordner bei gestopptem Server:
```bash
docker compose stop lexicast
docker run --rm -v lexicast_lexicast-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/lexicast-$(date +%F).tar.gz -C /data .
docker compose start lexicast
```
(Das Volume heißt `<compose-projekt>_lexicast-data`; prüfe es mit `docker volume ls`.)

Am wichtigsten:
- `keys/signing.pem`: **der private Signaturschlüssel.** Geht er verloren, muss jede App einen neuen öffentlichen Schlüssel ausliefern. Gelangt er an Dritte, können sie Texte signieren, die deine Apps annehmen. Bewahre Backups offline und verschlüsselt auf.
- `lexicast.sqlite`: Konten, Projekte, Texte, Vorschläge, Verlauf.
- `releases/`: die veröffentlichten Dateien. Sie lassen sich durch ein neues Release neu erzeugen, aber Apps merken sich ihre Release-Nummern, also sichere sie mit.

Wiederherstellen: Server stoppen, Dateien zurück in den Datenordner legen (Eigentümer `lexicast`, Schlüsseldatei mit Rechten 0400), Server starten.

## Updates
```bash
git pull
docker compose up -d --build
```
Datenbank-Migrationen laufen beim Start automatisch und werden in `schema_migrations` festgehalten. Mache vor dem Update ein Backup. Prüfe in den Pull Requests, ob es neue Umgebungsvariablen gibt, und trage sie in `compose.yaml` ein, wenn du sie nutzt.

## Mail
- `LEXICAST_MAIL=off`: Einladungen zeigen den Link der einladenden Person; Passwort-Reset ist nicht verfügbar; keine Benachrichtigungen.
- `LEXICAST_MAIL=file`: Mails werden als JSON in den Outbox-Ordner geschrieben. Damit kannst du ohne Versand testen.
- `LEXICAST_MAIL=smtp`: siehe [Konfiguration](configuration.md#mail). Scheitert eine Einladungsmail, bekommt die einladende Person den Link einmal angezeigt und der Fehler wird geloggt. Fehlgeschlagene Sammel-Mails bleiben in der Warteschlange und werden erneut versucht; Einträge älter als 7 Tage werden verworfen.

## Neustarts
- Das Setup-Token ändert sich bei jedem Neustart, bis die Einrichtung abgeschlossen ist.
- Ein Release, das beim Stoppen gerade gebaut wurde, wird beim nächsten Start als fehlgeschlagen markiert; das Live-Release bleibt, wie es war.
- Die Zähler der Ratenbegrenzung beginnen bei null.

## Fehlersuche
| Symptom | Ursache und Lösung |
|---|---|
| `403 bad_origin` bei jeder Änderung | `LEXICAST_BASE_URL` passt nicht zur Adresse im Browser (Schema, Host und Port müssen genau stimmen). |
| Nach der Anmeldung sofort wieder abgemeldet | `LEXICAST_BASE_URL` beginnt mit `https://`, du öffnest die Seite aber über HTTP, deshalb wird das `Secure`-Cookie nicht gespeichert. |
| Alle bekommen `429` | Alle Anfragen kommen von der Proxy-IP: `LEXICAST_TRUST_PROXY_HEADER` setzen; bei sehr großen Prüf- oder Import-Mengen `LEXICAST_WRITE_RATE_PER_MINUTE` erhöhen. |
| Der Browser zeigt `{"error":{"code":"not_found"...}}` statt der Oberfläche | Oberfläche nicht gebaut oder `LEXICAST_WEB_DIR` falsch; im Start-Log steht „web UI not found“. `npm run build:web` ausführen und neu starten (der Server liest die Oberfläche beim Start). |
| Server stoppt beim Start mit einer Meldung zu einer Variable | der Wert ist ungültig; die Meldung nennt die Variable und die erlaubten Werte. |
| Mail-Einstellungen wirken in Docker nicht | die Variable fehlt unter `environment:` in `compose.yaml`. |
| `ExperimentalWarning: SQLite` im Log | mit Node 24 erwartet; harmlos. |

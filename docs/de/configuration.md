# Konfiguration

Alle Einstellungen sind Umgebungsvariablen. Für einen lokalen Test ist keine nötig; für eine echte Installation setze mindestens `LEXICAST_BASE_URL`. Lexicast hat keine Standardpasswörter oder -schlüssel. Ungültige Werte stoppen den Server beim Start mit einer klaren Meldung.

## Server
| Variable | Standard | Bedeutung |
|---|---|---|
| `LEXICAST_BASE_URL` | `http://127.0.0.1:{port}` | Öffentliche Adresse ohne Pfad, z. B. `https://translate.example.com`. Wird für die Origin-Prüfung, Links in Mails und das Cookie genutzt (`Secure`, wenn sie mit `https://` beginnt). |
| `LEXICAST_HOST` | `127.0.0.1` (Image: `0.0.0.0`) | Adresse, auf der der Server lauscht. |
| `LEXICAST_PORT` | `8787` | Port, auf dem der Server lauscht. |
| `LEXICAST_DATA_DIR` | `./data` (Image: `/data`) | Datenbank (`lexicast.sqlite`), Release-Dateien (`releases/`), Signaturschlüssel (`keys/`), Outbox. |
| `LEXICAST_KEY_DIR` | `{Datenordner}/keys` | Ordner des privaten Signaturschlüssels. Nur der Signer-Prozess liest ihn. |
| `LEXICAST_WEB_DIR` | `dist/web` neben `src/` | Gebaute Oberfläche. Der Server liest sie beim Start. |

## Grenzen und Netzwerk
| Variable | Standard | Bedeutung |
|---|---|---|
| `LEXICAST_RATE_PER_MINUTE` | `600` | Anfragen pro Minute und IP für die Auslieferung (`/p/...`) und die öffentliche Fortschrittsseite. `0` = keine Grenze. |
| `LEXICAST_AUTH_RATE_PER_MINUTE` | `20` | Anmeldung, Einrichtung, Passwort-Reset, Annehmen einer Einladung und Passwortänderung: Anfragen pro Minute und IP. Hält das Erraten von Passwörtern langsam. `0` = keine Grenze. |
| `LEXICAST_WRITE_RATE_PER_MINUTE` | `300` | Alle anderen schreibenden Anfragen (POST, PATCH, PUT) an die JSON-API, pro Minute und **Konto** (ohne Anmeldung pro IP): Vorschläge, Freigaben, Importe, Einstellungen. `0` = keine Grenze. |
| `LEXICAST_TRUST_PROXY_HEADER` | leer | Header mit der echten Client-IP hinter einem vertrauenswürdigen Proxy, z. B. `cf-connecting-ip`. Leer = Adresse der Verbindung. |
| `LEXICAST_ALLOWED_ORIGINS` | `*` | Kommagetrennte Origins, von denen Browser Releases laden dürfen (CORS auf `/p/...`). `*` = alle. |

## Mail
| Variable | Standard | Bedeutung |
|---|---|---|
| `LEXICAST_MAIL` | `off` | `off`: keine Mails; Einladungslinks werden der einladenden Person angezeigt, Passwort-Reset ist nicht verfügbar. `smtp`: Versand über deinen SMTP-Server. `file`: Mails werden als JSON-Dateien in die Outbox geschrieben (nur für Tests). |
| `LEXICAST_MAIL_FROM` | leer | Absender, `noreply@example.com` oder `Lexicast <noreply@example.com>`. Pflicht, außer Mail ist aus. |
| `LEXICAST_SMTP_HOST` | leer | Pflicht bei `smtp`. |
| `LEXICAST_SMTP_PORT` | `587` (`465` bei `tls`) | |
| `LEXICAST_SMTP_SECURITY` | `starttls` | `starttls`, `tls` (direktes TLS) oder `none` (nur für `localhost`, `127.0.0.1`, `::1` erlaubt). |
| `LEXICAST_SMTP_USER` | leer | |
| `LEXICAST_SMTP_PASSWORD` | leer | Besser die Datei-Variante unten nutzen. |
| `LEXICAST_SMTP_PASSWORD_FILE` | leer | Pfad zu einer Datei mit dem Passwort (z. B. ein Docker-Secret). Hat Vorrang vor `LEXICAST_SMTP_PASSWORD`. |
| `LEXICAST_MAIL_OUTBOX` | `{Datenordner}/outbox` | Ordner für den Modus `file`. |
| `LEXICAST_DIGEST_MINUTES` | `15` | Minuten zwischen Sammel-Mails mit Benachrichtigungen. `0` = Benachrichtigungen aus. |
| `LEXICAST_DEFAULT_LOCALE` | `en` | Sprache der Mails (`en` oder `de`) für Personen, deren Sprache noch nicht bekannt ist. |

Beispiel für einen Anbieter mit STARTTLS:
```env
LEXICAST_MAIL=smtp
LEXICAST_MAIL_FROM=Lexicast <noreply@example.com>
LEXICAST_SMTP_HOST=smtp.example.com
LEXICAST_SMTP_USER=noreply@example.com
LEXICAST_SMTP_PASSWORD_FILE=/run/secrets/smtp_password
```
Der Versand über einen echten SMTP-Anbieter wurde vom Projekt noch nicht getestet; der Code-Pfad ist gegen einen lokalen SMTP-Testserver getestet.

## Dateien im Datenordner
```
data/
  lexicast.sqlite        Datenbank (Konten, Projekte, Texte, Vorschläge, Audit-Log)
  keys/signing.pem       privater Ed25519-Schlüssel, Dateirechte 0400
  releases/{projekt}/    veröffentlichte Release-Dateien (siehe Auslieferung)
  outbox/                Mails im Modus file
```

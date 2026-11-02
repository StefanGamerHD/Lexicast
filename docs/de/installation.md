# Installation

Lexicast läuft als ein Prozess mit einer SQLite-Datenbank und einem Ordner mit Release-Dateien. Du kannst es mit Docker (empfohlen) oder direkt mit Node betreiben.

## Voraussetzungen
- Docker mit Compose, **oder** Node.js 24 oder neuer.
- Eine Domain und ein Reverse Proxy mit TLS (zum Beispiel Caddy, nginx, Traefik oder Cloudflare Tunnel). Lexicast selbst spricht nur HTTP und darf nicht direkt erreichbar sein.
- Optional: ein SMTP-Konto für Einladungen, Passwort-Reset und Benachrichtigungen.

## Mit Docker Compose
```bash
git clone https://github.com/StefanGamerHD/Lexicast.git
cd Lexicast
cp .env.example .env        # dann anpassen, mindestens LEXICAST_BASE_URL
docker compose up -d --build
docker compose logs lexicast   # zeigt das einmalige Setup-Token
```
Was die mitgelieferte `compose.yaml` tut:
- baut das Image (Stufe 1 baut die Oberfläche, das fertige Image enthält nur Node, nodemailer und die gebauten Dateien),
- bindet den Port nur an `127.0.0.1:8787`, dein Reverse Proxy muss also auf demselben Host laufen,
- speichert alle Daten im Volume `lexicast-data` (eingehängt unter `/data`),
- läuft schreibgeschützt, ohne Linux-Capabilities und mit `no-new-privileges`,
- hat einen Health-Check auf `/healthz`.

Nur Variablen, die in `compose.yaml` stehen, kommen im Container an. Wenn du in `.env` eine Variable setzt, die compose nicht auflistet (zum Beispiel `LEXICAST_TRUST_PROXY_HEADER`), trage sie zusätzlich unter `environment:` ein.

## Direkt mit Node
```bash
npm ci
npm run build:web      # baut die Oberfläche nach dist/web
LEXICAST_BASE_URL=https://translate.example.com npm start
```
Der Server führt die TypeScript-Quellen direkt aus (kein Build-Schritt für den Server). Ohne `npm run build:web` funktioniert die JSON-API, aber es gibt keine Weboberfläche.

## Erster Start: Einrichtung
1. Beim ersten Start schreibt der Server ein **einmaliges Setup-Token** ins Log. Es gilt, bis die Einrichtung abgeschlossen ist oder der Server neu startet.
2. Öffne `LEXICAST_BASE_URL` im Browser. Die Einrichtungsseite fragt nach dem Token, deiner E-Mail, einem Anzeigenamen und einem Passwort (mindestens 12 Zeichen, ohne den Namensteil deiner E-Mail).
3. Dieses erste Konto wird **Instanz-Admin**. Lexicast erzeugt den Signaturschlüssel und zeigt den **öffentlichen Schlüssel** und seinen Fingerabdruck. Kopiere den öffentlichen Schlüssel: Deine Apps brauchen ihn, um Releases zu prüfen.

Ohne Weboberfläche:
```bash
curl -X POST https://translate.example.com/api/v1/setup \
  -H 'Content-Type: application/json' -H 'Origin: https://translate.example.com' \
  -d '{"setupToken":"<Token aus dem Log>","email":"du@example.com","displayName":"Du","password":"mindestens 12 Zeichen"}'
```
Die Einrichtung funktioniert nur einmal. Danach schickt die Einrichtungsseite alle zur Anmeldung.

## Reverse Proxy
Leite den Proxy auf `http://127.0.0.1:8787` und setze `LEXICAST_BASE_URL` auf die öffentliche HTTPS-Adresse (ohne Pfad). Lexicast nutzt sie für:
- die Origin-Prüfung jeder schreibenden Anfrage (Anfragen von anderen Origins bekommen `403 bad_origin`),
- Links in Mails,
- das Sitzungs-Cookie: Mit einer `https://`-Adresse heißt es `__Host-lexicast` und ist `Secure`.

Beispiel für Caddy:
```
translate.example.com {
  reverse_proxy 127.0.0.1:8787
}
```
Hinter einem Proxy scheinen alle Anfragen vom Proxy zu kommen. Die Ratenbegrenzung gilt pro IP, also sag Lexicast, welcher Header die echte Client-Adresse enthält, zum Beispiel `LEXICAST_TRUST_PROXY_HEADER=cf-connecting-ip` hinter Cloudflare oder `x-real-ip`, wenn dein Proxy ihn setzt. Setze das nur, wenn der Proxy diesen Header immer überschreibt; sonst könnten Clients ihre Adresse fälschen.

## Nächste Schritte
- Mail einrichten: [Konfiguration](configuration.md#mail).
- Ein Projekt anlegen und Texte importieren: [Bedienung](user-guide.md#projekte).
- Backups des Signaturschlüssels planen: [Betrieb](operations.md#backup).

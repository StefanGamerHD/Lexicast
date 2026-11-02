# Entwicklung

## Technik
- **Server:** Node.js 24+, TypeScript wird direkt von Node ausgeführt (Type Stripping, kein Build-Schritt), `node:sqlite`, eine Laufzeit-Abhängigkeit (nodemailer). `tsconfig` nutzt `erasableSyntaxOnly`: keine Enums, keine Parameter-Properties, Importe mit `.ts`-Endung.
- **Oberfläche:** Svelte-5-Single-Page-App, mit Vite nach `dist/web` gebaut; eigener kleiner Router und eigene Übersetzungen, kein SvelteKit. Svelte, Vite, svelte-check und Playwright sind Entwicklungsabhängigkeiten mit fest gepinnten Versionen.

## Befehle
```bash
npm ci
npm run typecheck   # Server-tsc + e2e-tsconfig + svelte-check (Warnungen sind Fehler)
npm test            # Server-Tests: echter HTTP-Server auf Port 0, echter Signer-Prozess
npm run build:web   # Oberfläche nach dist/web
npm run test:e2e    # Playwright (Chromium) gegen einen echten Server mit frischem Datenordner
npm start           # http://127.0.0.1:8787
```
Vor dem ersten E2E-Lauf: `npx playwright install chromium`.

Oberfläche mit Live-Reload: `LEXICAST_BASE_URL=http://localhost:5173 npm start` in einem Terminal, `npm run dev:web` in einem zweiten, dann http://localhost:5173 öffnen.

## Aufbau
```
src/
  main.ts, app.ts, config.ts, audit.ts, i18n.ts
  db/          migrate.ts + nummerierte SQL-Migrationen
  auth/        Passwort-Hashing, Sitzungen, Einrichtung, Einladungen, Reset, Profil
  signer/      process.ts (der einzige Code, der den privaten Schlüssel lädt), client.ts (IPC)
  http/        api.ts (Anmelde-Routen), project-routes.ts (Projekt-Routen), util.ts
  projects/    Projekte, Sprachen, Mitglieder; Keys und Import
  review/      Vorschläge, Freigabe/Ablehnung/Zurückziehen, weiche Warnungen
  release/     reiner Release-Builder, Rollback, harte Textregeln
  releases/    Vorschau, Erstellen, Rollback, Verlauf, Sperre
  delivery/    statische Auslieferung der Release-Dateien
  public/      öffentliche Fortschrittsseite und JSON
  mail/        Versandarten (smtp/file/off) und Mailtexte
  notify/      Benachrichtigungs-Warteschlange und Sammel-Mail
  web/         liefert die gebaute Oberfläche mit strenger CSP aus
test/          Server-Tests (harness.ts startet eine echte App)
web/src/       Oberfläche: App.svelte (Routen), lib/ (API, Router, Übersetzungen, Sitzung, Projekte, Textprüfung, Diff), components/, pages/
e2e/           Browser-Tests
docs/          diese Dokumentation (en, de)
```

## Konventionen
- Kommentare erklären das Warum, nicht das Was; kurz halten.
- Server-Fehler sind `ApiError(status, code, message)`; die Oberfläche übersetzt `code` in eigenen Text (`web/src/lib/errors.ts`).
- Texte der Oberfläche stehen in `web/src/lib/i18n.svelte.ts` mit Punkt-Keys, auf Englisch und Deutsch. Immer beide ergänzen.
- Die Oberfläche muss unter der strengen CSP funktionieren: kein Inline-Code, keine Anfragen an Dritte.
- Neue Routen der Oberfläche brauchen einen Eintrag in `web/src/App.svelte` **und** in `APP_ROUTES` in `src/web/handler.ts`.
- Neue Umgebungsvariablen: `src/config.ts`, `.env.example`, `compose.yaml` und die Konfigurationsseite dieser Dokumentation.
- Diese Dokumentation (Englisch und Deutsch) und beide READMEs bei jeder Änderung mitpflegen.

## Mitarbeit
Siehe `CONTRIBUTING.md`. Kurz: Vor größeren Arbeiten ein Issue öffnen, jeden Commit abzeichnen (`git commit -s`, Developer Certificate of Origin), jede neue Abhängigkeit begründen, Versionen fest pinnen. Der Server steht unter AGPL-3.0-only.

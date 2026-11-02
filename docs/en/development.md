# Development

## Stack
- **Server:** Node.js 24+, TypeScript run directly by Node (type stripping, no build step), `node:sqlite`, one runtime dependency (nodemailer). `tsconfig` uses `erasableSyntaxOnly`: no enums, no parameter properties, imports with `.ts` extensions.
- **Editor UI:** Svelte 5 single-page app built with Vite into `dist/web`; own small router and i18n, no SvelteKit. Svelte, Vite, svelte-check and Playwright are development dependencies, pinned to exact versions.

## Commands
```bash
npm ci
npm run typecheck   # server tsc + e2e tsconfig + svelte-check (warnings fail)
npm test            # server tests: real HTTP server on port 0, real signer process
npm run build:web   # UI into dist/web
npm run test:e2e    # Playwright (Chromium) against a real server with a fresh data folder
npm start           # http://127.0.0.1:8787
```
Before the first E2E run: `npx playwright install chromium`.

UI with live reload: `LEXICAST_BASE_URL=http://localhost:5173 npm start` in one terminal, `npm run dev:web` in another, then open http://localhost:5173.

## Layout
```
src/
  main.ts, app.ts, config.ts, audit.ts, i18n.ts
  db/          migrate.ts + numbered SQL migrations
  auth/        password hashing, sessions, setup, invitations, reset, profile
  signer/      process.ts (the only code that loads the private key), client.ts (IPC)
  http/        api.ts (auth routes), project-routes.ts (project routes), util.ts
  projects/    projects, languages, members; keys and import
  review/      suggestions, approve/reject/withdraw, soft warnings
  release/     pure release builder, rollback, hard validation rules
  releases/    preview, create, rollback, history, locking
  delivery/    static delivery of the release tree
  public/      public progress page and JSON
  mail/        transports (smtp/file/off) and mail texts
  notify/      notification queue and digest
  web/         serves the built UI with a strict CSP
test/          server tests (harness.ts starts a real app)
web/src/       UI: App.svelte (routes), lib/ (api, router, i18n, session, projects, text checks, diff, JSON error location), components/, pages/
e2e/           browser tests
docs/          this documentation (en, de)
```

## Conventions
- Comments explain why, not what; keep them short.
- Server errors are `ApiError(status, code, message)`; the UI maps `code` to its own text (`web/src/lib/errors.ts`).
- UI texts live in `web/src/lib/i18n.svelte.ts` with dotted keys, in English and German. Add both.
- The UI must work under the strict CSP: no inline scripts or styles, no third-party requests.
- New app routes need an entry in `web/src/App.svelte` **and** in `APP_ROUTES` in `src/web/handler.ts`.
- New environment variables: `src/config.ts`, `.env.example`, `compose.yaml`, and the configuration page of this documentation.
- Keep this documentation (English and German) and both READMEs in step with every change.

## Contributing
See `CONTRIBUTING.md`. In short: open an issue before larger work, sign off every commit (`git commit -s`, Developer Certificate of Origin), explain every new dependency, pin exact versions. The server is AGPL-3.0-only.

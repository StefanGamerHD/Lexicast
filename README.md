# Lexicast

Self-hostable server for translations that are reviewed by a second person, signed, and delivered live to running apps.

Status: early. The delivery chain (signed releases, static delivery, rollback) and the database schema exist; accounts, editor and review workflow are not built yet. Not ready for production use.

## What it does (planned for v1)
- Translators suggest texts in a web editor, a second person approves, the owner presses "release".
- A release is a set of immutable JSON files plus a manifest signed with Ed25519 (hashes per language file).
- Apps use a small client library (separate repository, MIT) that verifies the signature, refuses older releases, and falls back to bundled texts.
- One container, SQLite, no external storage.

## Run
```bash
npm ci
npm test
npm start            # http://127.0.0.1:8787/healthz
```
Container:
```bash
docker compose up -d --build
```
Settings are environment variables, see `.env.example`. Put a TLS reverse proxy in front; the container port is bound to localhost on purpose.

## Layout
- `src/release/`: validation rules, release builder, rollback
- `src/delivery/`: static delivery handler (GET/HEAD only, fixed path allow-list, rate limit, CORS)
- `src/db/`: SQLite schema and migrations
- `test/`: end-to-end and database tests

## Delivery format
```
GET /p/{project}/manifest.json
GET /p/{project}/manifest.json.sig
GET /p/{project}/r/{release}/{lang}.json
```

## License
AGPL-3.0-only for the server (see `LICENSE`). The client library is MIT in its own repository.

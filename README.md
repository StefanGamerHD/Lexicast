# Lexicast

Self-hostable server for translations that are reviewed by a second person, signed, and delivered live to running apps.

Status: early. Exists: signed releases with rollback, static delivery, database schema, instance setup, sign-in and invitations (JSON API), signing key in a separate signer process. Not built yet: editor, projects and keys API, review workflow, mail transport. Not ready for production use.

## What it does (planned for v1)
- Translators suggest texts in a web editor, a second person approves, the owner presses "release".
- A release is a set of immutable JSON files plus a manifest signed with Ed25519 (hashes per language file).
- Apps use a small client library (separate repository, MIT) that verifies the signature, refuses older releases, and falls back to bundled texts.
- One container, SQLite, no external storage.

## First start
On the first start the server prints a one-time setup token to its log. Create the admin account with it, from the address configured as `LEXICAST_BASE_URL`:
```bash
curl -X POST http://127.0.0.1:8787/api/v1/setup \
  -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:8787' \
  -d '{"setupToken":"<token from the log>","email":"you@example.com","displayName":"You","password":"at least 12 characters"}'
```
The response contains the public signing key and its fingerprint: embed the public key in your apps. Setup works once; the token is deleted afterwards.

## Signing key
The private key is created on first use and stored read-only (mode 0400) in `LEXICAST_KEY_DIR`. It is loaded only by a separate signer process; the web process asks it to sign and never holds the key. This is process separation, not separate users: someone who can run code as the same OS user can still read the file. Back it up offline; losing it means every app must ship a new public key.

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
- `src/auth/`: password hashing (scrypt), sessions, setup, invitations
- `src/http/`: JSON API, request helpers
- `src/signer/`: signer process and its client
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

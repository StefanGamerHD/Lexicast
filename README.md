# Lexicast

Self-hostable server for translations that are reviewed by a second person, signed, and delivered live to running apps.

Status: early. Exists: signed releases with rollback, static delivery, database schema, instance setup, sign-in and invitations (JSON API), signing key in a separate signer process. Projects, members with roles per language, keys and JSON import (with preview) exist as API. Suggestions and review (four-eyes, solo mode as logged exception) exist as API. Releases (preview, build, signed publish, rollback) exist as API. Public progress page exists (de/en). Mail (invitations, password reset, digest notifications) exists. Not built yet: the editor UI. Not ready for production use.

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

## API overview (`/api/v1`, cookie session, JSON)
| Endpoint | Who |
|---|---|
| `GET /instance`, `POST /setup`, `POST /auth/login`, `POST /auth/logout`, `GET /me` | see above |
| `POST /invitations`, `POST /invitations/accept` | instance admin invites; anyone with the link accepts |
| `GET /projects`, `POST /projects` | members see their projects; only the instance admin creates (becomes owner) |
| `GET /projects/{slug}`, `PUT /projects/{slug}/languages/{tag}` | members; owners change languages and fallback chains |
| `GET/POST /projects/{slug}/members`, `POST .../members/remove` | owners (existing accounts are added, unknown emails get an invitation link) |
| `GET/POST /projects/{slug}/keys`, `PATCH .../keys/{name}` | members read (translators and reviewers see their languages only); owners write |
| `POST /projects/{slug}/keys/import` | owners; `apply:false` previews, `apply:true` writes, `deprecateMissing:true` marks absent keys deprecated |

| `PATCH /projects/{slug}` | owners: name, `soloMode`, `progressPublic` |
| `POST /projects/{slug}/suggestions`, `GET .../suggestions[?mine=1&language=&state=]` | translators, reviewers, owners suggest in their languages; reviewers/owners get the queue of their languages, everybody can list their own |
| `POST .../suggestions/{id}/approve`, `.../reject` (reason required), `.../withdraw` | reviewers/owners of that language (never for their own text, except owners in solo mode); the author withdraws |

| `GET /projects/{slug}/releases/preview` | owners: what a release would contain, change list per language, open suggestions, solo-mode approvals |
| `POST /projects/{slug}/releases` (`note`), `POST .../releases/{n}/rollback` | owners; one release per project at a time; a failed build changes nothing that is live |
| `GET /projects/{slug}/releases` | any member: history with notes, change summary, failures |

| `GET /progress/{slug}` (HTML), `GET /api/v1/public/projects/{slug}/progress` (JSON) | public, no sign-in; counts only (no key names, texts or people); 404 when the project is unknown or `progressPublic` is off, so existence is not revealed |

The progress page needs no JavaScript, follows the browser language (German or English) and the light/dark setting, and is served with a strict Content-Security-Policy.

An approved text becomes the current translation but is not live until a release is built. Releases contain active keys and translations that are not outdated; deprecated keys disappear with the next release. A rollback is a new release with a higher number, so clients accept it. A suggestion written against an older source text is flagged and cannot be approved.

Non-members get 404 for project URLs; the instance admin has no implicit access to projects.

## Mail
Set `LEXICAST_MAIL=smtp` with host, port, security (`starttls` by default, `tls`, or `none` for localhost only), user and password (prefer `LEXICAST_SMTP_PASSWORD_FILE`). Mails are plain text, in the recipient's language (German or English).
- **Invitations** are sent by mail; with mail configured the link is *not* returned by the API. Without mail, or if sending fails, the inviter gets the link once.
- **Password reset** (`POST /auth/password-reset/request`, `.../confirm`): the same answer for every address, link valid 60 minutes and usable once, at most 3 per hour and account, ends all sessions. Not available without mail.
- **Notifications** (new suggestions, rejected suggestions, published releases, outdated translations) are collected and sent as one digest mail per person every `LEXICAST_DIGEST_MINUTES` (default 15). Everyone can switch them off in their account (`PATCH /me` with `notifyEmail`). Failed mails stay queued and are retried; entries older than 7 days are dropped.
- Account: `PATCH /me` (name, language, theme, notifications), `POST /me/password`.

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

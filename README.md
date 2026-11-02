# Lexicast

Self-hostable server for translations that are reviewed by a second person, signed, and delivered live to running apps.

**English** · [Deutsch](README.de.md)

> Status: early, not ready for production use. Server API complete for milestone 1; the web interface covers setup, accounts, projects, translating, review, keys with JSON import, releases with rollback, members and invitations, languages, project settings, creating projects and the account page. The admin area follows.

## Why
Translators suggest texts in a web editor, a second person approves them, a project owner presses "release", and apps fetch the new texts within minutes. Every release is a set of immutable JSON files plus a manifest signed with Ed25519; apps verify the signature, refuse older releases and fall back to bundled texts. One container, SQLite, no external storage.

## Features
- Invitation-only accounts, password reset by mail, German and English interface, light and dark theme
- Projects with languages and fallback chains (`de-AT` → `de` → `en`, resolved at build time)
- Roles per project and language: owner, reviewer, translator; the instance admin has no implicit project access
- Keys with JSON import (flat or nested, preview, all-or-nothing)
- Translate screen with filters, placeholder chips, live rule checks, drafts in the browser, keyboard shortcuts
- Review queue with word diff, warnings, reject with reason, batch approve; four-eyes rule (solo mode as a logged exception)
- Releases: preview, signed publish, history, rollback as a new release
- Static delivery with ETag, CORS and rate limit; public progress page (optional, counts only)
- Signing key in a separate signer process; strict Content-Security-Policy; audit log

## Quick start
```bash
git clone https://github.com/StefanGamerHD/Lexicast.git && cd Lexicast
cp .env.example .env            # set LEXICAST_BASE_URL to your public https address
docker compose up -d --build
docker compose logs lexicast    # copy the one-time setup token
```
Put a TLS reverse proxy in front (the container port is bound to localhost), open your address, enter the setup token and create the admin account. Copy the public signing key shown after setup into your apps.

## Documentation
Full documentation in [docs/en](docs/en/README.md) (German: [docs/de](docs/de/README.md)):

[Installation](docs/en/installation.md) · [Configuration](docs/en/configuration.md) · [User guide](docs/en/user-guide.md) · [API reference](docs/en/api.md) · [Delivery and client](docs/en/delivery.md) · [Security](docs/en/security.md) · [Operations](docs/en/operations.md) · [Development](docs/en/development.md)

## Development
```bash
npm ci
npm run typecheck && npm test
npm run build:web && npm run test:e2e   # once before: npx playwright install chromium
npm start                               # http://127.0.0.1:8787
```
Node 24+, TypeScript run directly by Node, one runtime dependency (nodemailer). The editor UI is Svelte + Vite (development dependencies only). See [Development](docs/en/development.md) and [CONTRIBUTING.md](CONTRIBUTING.md); commits are signed off under the DCO.

## Security
Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License
AGPL-3.0-only for the server (see `LICENSE`). The client library will be MIT in its own repository.

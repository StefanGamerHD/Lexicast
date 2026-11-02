# Installation

Lexicast runs as one process with an SQLite database and a folder of release files. You can run it with Docker (recommended) or directly with Node.

## Requirements
- Docker with Compose, **or** Node.js 24 or newer.
- A domain and a reverse proxy with TLS (for example Caddy, nginx, Traefik or Cloudflare Tunnel). Lexicast itself speaks plain HTTP and must not be exposed directly.
- Optional: an SMTP account for invitations, password reset and notifications.

## With Docker Compose
```bash
git clone https://github.com/StefanGamerHD/Lexicast.git
cd Lexicast
cp .env.example .env        # then edit, at least LEXICAST_BASE_URL
docker compose up -d --build
docker compose logs lexicast   # shows the one-time setup token
```
What the provided `compose.yaml` does:
- builds the image (stage 1 builds the editor UI, the final image only holds Node, nodemailer and the built files),
- binds the port to `127.0.0.1:8787` only, so your reverse proxy must run on the same host,
- stores all data in the volume `lexicast-data` (mounted at `/data`),
- runs read-only with all Linux capabilities dropped and `no-new-privileges`,
- has a health check on `/healthz`.

Only variables listed in `compose.yaml` reach the container. If you set a variable in `.env` that compose does not list (for example `LEXICAST_TRUST_PROXY_HEADER`), add it under `environment:` too.

## With Node directly
```bash
npm ci
npm run build:web      # builds the editor UI into dist/web
LEXICAST_BASE_URL=https://translate.example.com npm start
```
The server runs the TypeScript sources directly (no build step for the server). Without `npm run build:web` the JSON API works, but there is no web interface.

## First start: setup
1. On the first start the server prints a **one-time setup token** to its log. It is valid until setup is done or the server restarts.
2. Open `LEXICAST_BASE_URL` in a browser. The setup page asks for the token, your email, a display name and a password (at least 12 characters, not containing the name part of your email).
3. This first account becomes the **instance admin**. Lexicast creates the signing key and shows the **public key** and its fingerprint. Copy the public key: your apps need it to verify releases.

Without the web interface:
```bash
curl -X POST https://translate.example.com/api/v1/setup \
  -H 'Content-Type: application/json' -H 'Origin: https://translate.example.com' \
  -d '{"setupToken":"<token from the log>","email":"you@example.com","displayName":"You","password":"at least 12 characters"}'
```
Setup works once. Afterwards the setup page sends everybody to the sign-in page.

## Reverse proxy
Point the proxy at `http://127.0.0.1:8787` and set `LEXICAST_BASE_URL` to the public HTTPS address (no path). Lexicast uses it for:
- the origin check of every write request (requests from other origins get `403 bad_origin`),
- links in mails,
- the session cookie: with an `https://` base URL the cookie is `__Host-lexicast` with `Secure`.

Example for Caddy:
```
translate.example.com {
  reverse_proxy 127.0.0.1:8787
}
```
Behind a proxy all requests seem to come from the proxy. Rate limits are per IP, so tell Lexicast which header carries the real client address, for example `LEXICAST_TRUST_PROXY_HEADER=cf-connecting-ip` behind Cloudflare or `x-real-ip` if your proxy sets it. Only set this when the proxy always overwrites that header; otherwise clients could fake their address.

## Next steps
- Set up mail: [Configuration](configuration.md#mail).
- Create a project and import texts: [User guide](user-guide.md#projects).
- Plan backups of the signing key: [Operations](operations.md#backup).

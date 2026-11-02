# Operations

## Health
`GET /healthz` answers `{"status":"ok","schema":3}` (schema = latest database migration) or `503`. The Docker image uses it as its health check.

## Logs
Lexicast logs to stdout/stderr: the start line (address, schema, base URL, mail mode), the one-time setup token before setup, failed mails, and internal errors with a short id (the same id the client sees in `500 internal`). No passwords, tokens or texts are logged.

## Backup
There is no backup command yet (planned: database + config + encrypted signing key, refusing to overwrite newer data). Until then back up the whole data folder while the server is stopped:
```bash
docker compose stop lexicast
docker run --rm -v lexicast_lexicast-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/lexicast-$(date +%F).tar.gz -C /data .
docker compose start lexicast
```
(The volume name is `<compose project>_lexicast-data`; check with `docker volume ls`.)

What matters most:
- `keys/signing.pem`: **the private signing key.** If it is lost, every app has to ship a new public key. If it leaks, someone can sign texts your apps accept. Keep backups offline and encrypted.
- `lexicast.sqlite`: accounts, projects, texts, suggestions, history.
- `releases/`: the published files. They can be rebuilt by publishing a new release, but apps keep their release numbers, so keep them.

Restore: stop the server, put the files back into the data folder (ownership `lexicast`, key file mode 0400), start the server.

## Updates
```bash
git pull
docker compose up -d --build
```
Database migrations run automatically at start and are recorded in `schema_migrations`. Back up before updating. Check the release notes of the pull requests for new environment variables, and add them to `compose.yaml` if you use them.

## Mail
- `LEXICAST_MAIL=off`: invitations show the link to the inviter; password reset is unavailable; no notifications.
- `LEXICAST_MAIL=file`: mails are written to the outbox folder as JSON. Use this to test without sending.
- `LEXICAST_MAIL=smtp`: see [Configuration](configuration.md#mail). If an invitation mail fails, the inviter gets the link once and the error is logged. Failed digest mails stay queued and are retried; entries older than 7 days are dropped.

## Restarts
- The setup token changes on every restart until setup is done.
- A release that was being built when the server stopped is marked as failed on the next start; the live release stays as it was.
- Rate-limit counters start from zero.

## Troubleshooting
| Symptom | Cause and fix |
|---|---|
| `403 bad_origin` on every write | `LEXICAST_BASE_URL` does not match the address in the browser (scheme, host and port must match exactly). |
| Signed out right after signing in | `LEXICAST_BASE_URL` starts with `https://` but you open the site over plain HTTP, so the `Secure` cookie is not stored. |
| Everybody gets `429` | All requests come from the proxy IP: set `LEXICAST_TRUST_PROXY_HEADER`; or raise `LEXICAST_AUTH_RATE_PER_MINUTE` for heavy reviewing. |
| The browser shows `{"error":{"code":"not_found"...}}` instead of the UI | UI not built or `LEXICAST_WEB_DIR` wrong; the start log says "web UI not found". Run `npm run build:web` and restart (the server reads the UI at start). |
| Server stops at start with a message about a variable | the value is invalid; the message names the variable and the allowed values. |
| Mail settings not applied in Docker | the variable is missing under `environment:` in `compose.yaml`. |
| `ExperimentalWarning: SQLite` in the log | expected with Node 24; harmless. |

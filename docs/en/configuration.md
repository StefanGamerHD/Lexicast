# Configuration

All settings are environment variables. None are required for a local test; for a real installation set at least `LEXICAST_BASE_URL`. Lexicast has no default passwords or keys. Invalid values stop the server at start with a clear message.

## Server
| Variable | Default | Meaning |
|---|---|---|
| `LEXICAST_BASE_URL` | `http://127.0.0.1:{port}` | Public address without path, e.g. `https://translate.example.com`. Used for the origin check, mail links and the cookie (`Secure` when it starts with `https://`). |
| `LEXICAST_HOST` | `127.0.0.1` (image: `0.0.0.0`) | Address to listen on. |
| `LEXICAST_PORT` | `8787` | Port to listen on. |
| `LEXICAST_DATA_DIR` | `./data` (image: `/data`) | Database (`lexicast.sqlite`), release files (`releases/`), signing key (`keys/`), outbox. |
| `LEXICAST_KEY_DIR` | `{data dir}/keys` | Folder of the private signing key. Only the signer process reads it. |
| `LEXICAST_WEB_DIR` | `dist/web` next to `src/` | Built editor UI. The server reads it at start. |

## Limits and network
| Variable | Default | Meaning |
|---|---|---|
| `LEXICAST_RATE_PER_MINUTE` | `600` | Requests per minute and IP for delivery (`/p/...`) and the public progress page. `0` = no limit. |
| `LEXICAST_AUTH_RATE_PER_MINUTE` | `20` | Write requests (POST, PATCH, PUT) per minute and IP to the JSON API: sign-in, setup, invitations, but currently also suggestions, approvals and other writes. `0` = no limit. See the note below. |
| `LEXICAST_TRUST_PROXY_HEADER` | empty | Header with the real client IP behind a trusted proxy, e.g. `cf-connecting-ip`. Empty = socket address. |
| `LEXICAST_ALLOWED_ORIGINS` | `*` | Comma-separated origins that browsers may fetch releases from (CORS on `/p/...`). `*` = any. |

Note on `LEXICAST_AUTH_RATE_PER_MINUTE`: the limit counts all write requests of an IP to the API, not only sign-ins. A reviewer who approves more than 20 suggestions within a minute (for example with batch approve) gets `429 rate_limited` and has to wait a minute. Raise the value if several people share one IP or if you review in large batches.

## Mail
| Variable | Default | Meaning |
|---|---|---|
| `LEXICAST_MAIL` | `off` | `off`: no mail; invitation links are shown to the inviter, password reset is unavailable. `smtp`: send through your SMTP server. `file`: write mails as JSON files into the outbox (tests only). |
| `LEXICAST_MAIL_FROM` | empty | Sender, `noreply@example.com` or `Lexicast <noreply@example.com>`. Required unless mail is off. |
| `LEXICAST_SMTP_HOST` | empty | Required for `smtp`. |
| `LEXICAST_SMTP_PORT` | `587` (`465` with `tls`) | |
| `LEXICAST_SMTP_SECURITY` | `starttls` | `starttls`, `tls` (implicit TLS) or `none` (only allowed for `localhost`, `127.0.0.1`, `::1`). |
| `LEXICAST_SMTP_USER` | empty | |
| `LEXICAST_SMTP_PASSWORD` | empty | Prefer the file variant below. |
| `LEXICAST_SMTP_PASSWORD_FILE` | empty | Path to a file with the password (e.g. a Docker secret). Wins over `LEXICAST_SMTP_PASSWORD`. |
| `LEXICAST_MAIL_OUTBOX` | `{data dir}/outbox` | Folder for `file` mode. |
| `LEXICAST_DIGEST_MINUTES` | `15` | Minutes between notification digests. `0` = notifications off. |
| `LEXICAST_DEFAULT_LOCALE` | `en` | Mail language (`en` or `de`) for people whose language is not known yet. |

Example for a provider with STARTTLS:
```env
LEXICAST_MAIL=smtp
LEXICAST_MAIL_FROM=Lexicast <noreply@example.com>
LEXICAST_SMTP_HOST=smtp.example.com
LEXICAST_SMTP_USER=noreply@example.com
LEXICAST_SMTP_PASSWORD_FILE=/run/secrets/smtp_password
```
Sending through a real SMTP provider has not been tested by the project yet; the code path is tested against a local SMTP test server.

## Files in the data folder
```
data/
  lexicast.sqlite        database (accounts, projects, texts, suggestions, audit log)
  keys/signing.pem       private Ed25519 key, mode 0400
  releases/{project}/    published release files (see Delivery)
  outbox/                mails in file mode
```

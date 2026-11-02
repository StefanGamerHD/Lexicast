# Security

Lexicast puts texts into other people's applications. A wrong or malicious text can reach many users, so the design tries to make that hard. This page describes what the code does today and what it does not do yet.

## Report a vulnerability
Please report privately through GitHub's "Report a vulnerability" on the repository, not as a public issue. See `SECURITY.md`.

## Texts
- Texts are **plain text**, stored and delivered as such. The editor and the client never interpret them as HTML.
- Hard rules refuse control characters, bidirectional override characters, broken braces and placeholders that differ from the source (see [User guide](user-guide.md#placeholders-and-text-rules)).
- **Four-eyes rule:** a text needs a second person before it can be released. Solo mode is an explicit, logged exception for one-person projects. The rule is also a database constraint.
- A suggestion written against an older source text cannot be approved.

## Releases and signature
- Each release is signed with **Ed25519**. Apps verify the signature with the public key they ship, and check the SHA-256 of every language file.
- Release files are immutable; a rollback is a new release with a higher number, so clients can refuse older releases.
- The manifest and its signature are written completely and then renamed, so a crash never leaves a new manifest next to an old signature.
- **Signing key:** created on first use, stored with file mode 0400 in `LEXICAST_KEY_DIR`, and loaded **only by a separate signer process**. The web process asks it to sign over a pipe and never holds the key. This is process separation, not user separation: code running as the same OS user can still read the file.
- Not built yet: key rotation with a trust chain and an emergency path (designed), encrypted key backup, hardware or offline signing.

## Accounts and sessions
- Passwords hashed with **scrypt**. At least 12 characters, not containing the name part of the email.
- After 5 failed sign-ins an account is locked for 15 minutes. Unknown emails get the same answer and similar timing (a dummy hash is computed).
- Session tokens are random and stored only as hashes. Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` and `__Host-` prefix over HTTPS, 7 days.
- Invitation only; links are single use and expire (invitations 7 days, password reset 60 minutes, at most 3 resets per hour). A password change or reset ends all sessions.
- The one-time setup token is stored as a hash and works once.
- The instance admin has no automatic access to projects. Non-members get "not found" for project URLs.

## Web
- Every write request must come from `LEXICAST_BASE_URL` (Origin check) and be JSON.
- The editor UI runs under a strict Content-Security-Policy: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. No inline scripts, no third-party requests. The public progress page has its own strict policy and no JavaScript.
- Rate limits (in memory): sign-in and password endpoints strictly per IP (default 20 per minute), other API writes per account (default 300), delivery and progress page per IP.
- Request bodies are size-limited. Internal errors are never echoed; the log gets a short id.

## Container
The provided compose file runs the container read-only, as a non-root user, with all capabilities dropped and `no-new-privileges`, and binds the port to localhost only. The image contains one runtime dependency (nodemailer, pinned) and no build tools.

## Audit log
Security-relevant actions (setup, sign-ins, lockouts, password changes and resets, invitations, membership changes, key changes, imports, suggestions, approvals including solo approvals, rejections, releases, rollbacks, settings) are written to an audit log in the database with a pseudonym instead of the name. A screen and API to read it are planned.

## Known limits
- Real SMTP providers are not yet tested; TLS is handled by nodemailer.
- Rate limits are per process and reset on restart; behind a proxy set `LEXICAST_TRUST_PROXY_HEADER`.
- No backup/restore command yet (see [Operations](operations.md#backup)).
- No API tokens yet; scripts use a session cookie.
- `node:sqlite` is still marked experimental in Node 24. The base image is pinned by tag, not yet by digest.
- The editor UI was tested in Chromium only, not in Firefox or Safari or with screen readers.

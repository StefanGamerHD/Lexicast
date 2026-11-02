# Delivery and client

Apps never talk to the API. They read static, public files that a release writes. No sign-in, no cookies.

## Files
```
GET /p/{project}/manifest.json        the current release (changes with every release)
GET /p/{project}/manifest.json.sig    Ed25519 signature of manifest.json, base64url
GET /p/{project}/r/{n}/{lang}.json    texts of release n for one language (never change)
```
- Only GET and HEAD, only these path shapes; everything else is `404`.
- `ETag` on every file; send `If-None-Match` to get `304 Not Modified`.
- `Cache-Control`: manifest and signature `public, max-age=60`; release files `public, max-age=31536000, immutable`.
- CORS: browsers may fetch from the origins in `LEXICAST_ALLOWED_ORIGINS` (default any).
- Rate limit: `LEXICAST_RATE_PER_MINUTE` per IP (default 600); `429` with `Retry-After: 30` above it.

## Manifest
```json
{
  "v": 1,
  "project": "shop",
  "release": 7,
  "created": "2026-11-02T10:00:00.000Z",
  "sourceLanguage": "en",
  "languages": {
    "de": { "path": "r/7/de.json", "sha256": "…64 hex characters…", "keys": 120 },
    "en": { "path": "r/7/en.json", "sha256": "…", "keys": 120 }
  }
}
```
- `release` grows with every release, also with a rollback.
- `sha256` is the hash of the exact bytes of the language file.

## Language files
A flat JSON object, keys sorted, values plain strings:
```json
{
  "cart.items": "{count} Artikel im Warenkorb",
  "cart.title": "Warenkorb"
}
```
Fallbacks are already resolved: if `de-AT` has no own text for a key, the file contains the `de` or `en` text according to the project's fallback chain. Only active keys and translations that are not outdated are included. Texts are plain text; never insert them as HTML.

## How a client must check a release
1. Fetch `manifest.json` (with `If-None-Match` if you have an ETag). On `304` nothing changed.
2. Fetch `manifest.json.sig` and verify it with the instance's **public key** (Ed25519) over the exact manifest bytes. On failure: keep the current texts.
3. Check `v === 1` and `project` is the expected project.
4. **Refuse older releases:** if `release` is lower than the one you already have, keep yours (protection against replaying an old, validly signed manifest).
5. Fetch the language file from `path` (only accept paths like `r/{n}/{lang}.json`), compute SHA-256 and compare with `sha256`. On mismatch: keep the current texts.
6. Use the texts; keep a copy (and the release number) in local storage for the next start.
7. If anything fails, fall back to the last good texts, then to the texts bundled with the app. Never show an empty screen because the server is unreachable.

The public key is shown once at setup and in the API at `GET /api/v1/instance`. Build it into your app; do not fetch it at runtime from the same server (that would defeat the signature).

## Client library
A JavaScript client (MIT, own repository) is planned. A working prototype exists from the first milestone: it uses `fetch` and WebCrypto Ed25519, caches the last good release, refuses downgrades and falls back to bundled texts. It was tested end to end against a real server in Chromium. Not yet done: a clear error when WebCrypto Ed25519 is not available (insecure context, older browsers), tests in Firefox, Safari and on phones, publishing to npm.

## Polling
Fetching the manifest every few minutes is cheap (60 seconds browser cache, `304` answers). New texts reach apps within minutes after a release.

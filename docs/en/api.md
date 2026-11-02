# API reference

The JSON API lives under `/api/v1`. The web interface uses exactly this API, so everything the interface can do, a script can do too. The routes are defined in `src/http/api.ts` and `src/http/project-routes.ts`; those files are the source of truth.

## Conventions
- **Session:** sign in with `POST /auth/login`; the response sets an HttpOnly cookie (`lexicast_session`, or `__Host-lexicast` over HTTPS, `SameSite=Strict`, 7 days). Send it with every request (`curl -c cookies.txt` / `-b cookies.txt`). API tokens for scripts are planned.
- **Write requests** (POST, PATCH, PUT) must carry `Origin: {LEXICAST_BASE_URL}` and `Content-Type: application/json`. Other origins get `403 bad_origin`. Sign-in and password endpoints count against `LEXICAST_AUTH_RATE_PER_MINUTE` per IP, all other writes against `LEXICAST_WRITE_RATE_PER_MINUTE` per account.
- **Errors** have the form `{"error":{"code":"...","message":"..."}}`. The `code` is stable and meant for programs; the `message` is English and for humans. Unknown internal errors return `500 internal` with a short id that also appears in the server log.
- **Not found vs. forbidden:** projects you are not a member of answer `404 not_found`. Inside a project, actions your role does not allow answer `403 forbidden`.
- Request bodies are limited in size (import: 2 MB).

## Instance, setup, sign-in
| Method and path | Body | Answer | Who |
|---|---|---|---|
| `GET /instance` | | `{setupDone, publicKey, fingerprint}` | anyone |
| `POST /setup` | `{setupToken, email, displayName, password}` | `201 {user, publicKey, fingerprint}` + cookie | once, with the token from the log |
| `POST /auth/login` | `{email, password}` | `{user}` + cookie | anyone |
| `POST /auth/logout` | | `{ok}` | signed in |
| `POST /auth/password-reset/request` | `{email}` | `202 {ok}` (same answer for every address) | anyone; `503 mail_disabled` without mail |
| `POST /auth/password-reset/confirm` | `{token, password}` | `{ok}` | holder of the link |

## Own account
| Method and path | Body | Answer |
|---|---|---|
| `GET /me` | | `{user, mailEnabled}` |
| `PATCH /me` | any of `{displayName, uiLocale: "en"\|"de", theme: "system"\|"light"\|"dark", notifyEmail: bool}` | `{user}` |
| `POST /me/password` | `{currentPassword, newPassword}` | `{ok}`; other sessions are signed out |

`user` = `{id, email, displayName, isInstanceAdmin, uiLocale, theme, notifyEmail}`.

## Invitations to the instance
| Method and path | Body | Answer | Who |
|---|---|---|---|
| `POST /invitations` | `{email}` | `201 {sent: true}` with mail; `{inviteUrl}` without mail; `{sent: false, mailError: true, inviteUrl}` if sending failed | instance admin |
| `POST /invitations/accept` | `{token, displayName, password}` | `201 {user}` + cookie | holder of the link |

## Projects, languages, members
| Method and path | Body / query | Answer | Who |
|---|---|---|---|
| `GET /projects` | | `{projects: [{slug, name, roles: ["owner", "reviewer:de", ...]}]}` | signed in |
| `POST /projects` | `{slug, name, sourceLanguage, languages: [{tag, fallback?: [tags]}]}` | `201 {project}`; the slug `new` is reserved | instance admin (becomes owner) |
| `GET /projects/{slug}` | | `{project, roles: {owner, reviewer: [...], translator: [...]}, progress: {languages: [{tag, translated, total, percent, inReview, outdated, isSource}], liveRelease: {number, createdAt} \| null}}` | members |
| `PATCH /projects/{slug}` | any of `{name, soloMode, progressPublic}` | `{project}` | owners |
| `PUT /projects/{slug}/languages/{tag}` | `{fallback: [tags]}` | `{project}` (adds the language or changes its chain) | owners |
| `GET /projects/{slug}/members` | | list of `{id, email, displayName, role, language}` | owners |
| `POST /projects/{slug}/members` | `{email, role: "owner"\|"reviewer"\|"translator", language?}` | existing account: `{added: true}`; unknown email: invitation like above | owners |
| `POST /projects/{slug}/members/remove` | `{userId, role, language?}` | `{ok}`; the last owner cannot be removed | owners |
| `GET /projects/{slug}/invitations` | | `{invitations: [{id, email, role, language, createdAt, expiresAt, expired, invitedBy}]}` (not yet accepted, incl. expired) | owners |
| `POST /projects/{slug}/invitations/{id}/revoke` | `{}` | `{revoked: true}`; the link stops working | owners |

`project` = `{id, slug, name, sourceLanguage, soloMode, progressPublic, languages: [{tag, fallback}]}`.

## Keys
| Method and path | Body / query | Answer | Who |
|---|---|---|---|
| `GET /projects/{slug}/keys` | `?search=&state=active\|deprecated&limit=1..500&offset=` | `{total, keys: [{name, sourceText, contextNote, maxLength, state, translations: {lang: {text, outdated}}, openSuggestions: {lang: count}}]}` | members; `translations` and `openSuggestions` only for languages you work on |
| `POST /projects/{slug}/keys` | `{name, sourceText, contextNote?, maxLength?}` | `201 {name}` | owners |
| `PATCH /projects/{slug}/keys/{name}` | any of `{sourceText, contextNote, maxLength, state}` | `{name, outdatedMarked}` | owners |
| `POST /projects/{slug}/keys/import` | `{texts: {...}, apply: bool, deprecateMissing?: bool}` | `{applied, added, changed, reactivated, unchanged, removed, removedAreDeprecated}` | owners |

## Suggestions and review
| Method and path | Body / query | Answer | Who |
|---|---|---|---|
| `POST /projects/{slug}/suggestions` | `{key, language, text}` | `201 {id, warnings: [...]}` | translators, reviewers, owners of that language |
| `GET /projects/{slug}/suggestions` | `?language=&state=open\|approved\|rejected\|withdrawn\|superseded&mine=1&limit=1..200&offset=` | `{total, suggestions: [...]}` | without `mine`: the review queue of your languages (default state `open`); with `mine=1`: your own suggestions |
| `POST .../suggestions/{id}/approve` | `{}` | `{approved, solo, superseded}` | reviewers and owners of that language, not for own text (solo mode: owners) |
| `POST .../suggestions/{id}/reject` | `{reason}` (1–500 characters) | `{rejected}` | reviewers and owners, not for own text |
| `POST .../suggestions/{id}/withdraw` | `{}` | `{withdrawn}` | the author |

A suggestion in a list: `{id, key, language, text, state, author, mine, createdAt, sourceText, currentText, sourceChanged, warnings, rejectReason}`.

Warning codes: `much_longer`, `much_shorter`, `whitespace_differs`, `punctuation_differs`, `same_as_source`, `new_url_or_email`, `looks_like_markup`.

## Releases
| Method and path | Body | Answer | Who |
|---|---|---|---|
| `GET /projects/{slug}/releases/preview` | | `{liveRelease, nextRelease, hasChanges, summary: {languages, soloApprovals, outdatedExcluded}, changes: {lang: {added, changed, removed}}, openSuggestions}` | owners |
| `POST /projects/{slug}/releases` | `{note?}` (up to 1000 characters) | `201 {release, summary}` | owners |
| `POST /projects/{slug}/releases/{n}/rollback` | `{note?}` | `201 {release, rolledBackTo}` | owners |
| `GET /projects/{slug}/releases` | | history: number, state, date, author, note, change summary, rollback target, failure reason | members |

## Public endpoints (no sign-in)
| Path | Answer |
|---|---|
| `GET /healthz` | `{status: "ok", schema}` or `503` |
| `GET /progress/{slug}` | HTML progress page (only if `progressPublic`) |
| `GET /api/v1/public/projects/{slug}/progress` | the same counts as JSON |
| `GET /p/{slug}/manifest.json`, `.../manifest.json.sig`, `.../r/{n}/{lang}.json` | release files, see [Delivery](delivery.md) |

## Error codes
| Code | Status | Meaning |
|---|---|---|
| `unauthenticated` | 401 | not signed in |
| `bad_origin` | 403 | missing or wrong `Origin` header |
| `forbidden` | 403 | your role does not allow this |
| `not_found` | 404 | unknown, or a project you are not a member of |
| `rate_limited` | 429 | too many requests (sign-in endpoints: from your IP; other writes: from your account) |
| `invalid_credentials`, `locked` | 401/429 | wrong sign-in, account locked for 15 minutes |
| `weak_password`, `invalid_email`, `invalid_field`, `invalid_name`, `invalid_slug`, `invalid_languages`, `invalid_language`, `invalid_role` | 400 | invalid input |
| `bad_setup_token`, `setup_done` | 403/409 | setup |
| `invalid_invitation`, `invalid_token` | 400 | invitation or reset link invalid, expired or used |
| `mail_disabled` | 503 | password reset needs mail |
| `exists` | 409 | account, project or key already exists |
| `invalid_text`, `invalid_import` | 400 | text breaks a hard rule; import rejected |
| `unchanged` | 409 | suggestion equals the current translation |
| `too_many_open` | 429 | 100 open suggestions per person and project |
| `self_review` | 403 | own suggestion |
| `not_open` | 409 | suggestion was already handled |
| `source_changed` | 409 | source text changed after the suggestion |
| `key_deprecated` | 409 | key is deprecated |
| `last_owner` | 409 | a project needs one owner |
| `nothing_to_release`, `no_changes`, `already_live`, `release_running`, `invalid_release`, `release_failed` | 409/500 | release could not be built |

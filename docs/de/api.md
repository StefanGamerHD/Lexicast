# API-Referenz

Die JSON-API liegt unter `/api/v1`. Die Weboberfläche nutzt genau diese API: Alles, was die Oberfläche kann, kann auch ein Skript. Die Routen stehen in `src/http/api.ts` und `src/http/project-routes.ts`; diese Dateien sind maßgeblich.

Die Feldnamen und Fehlercodes sind englisch, weil Programme sie lesen.

## Grundregeln
- **Sitzung:** Melde dich mit `POST /auth/login` an; die Antwort setzt ein HttpOnly-Cookie (`lexicast_session`, über HTTPS `__Host-lexicast`, `SameSite=Strict`, 7 Tage). Schicke es bei jeder Anfrage mit (`curl -c cookies.txt` / `-b cookies.txt`). API-Tokens für Skripte sind geplant.
- **Schreibende Anfragen** (POST, PATCH, PUT) brauchen `Origin: {LEXICAST_BASE_URL}` und `Content-Type: application/json`. Andere Origins bekommen `403 bad_origin`. Anmelde- und Passwort-Endpunkte zählen pro IP gegen `LEXICAST_AUTH_RATE_PER_MINUTE`, alle anderen Schreibzugriffe pro Konto gegen `LEXICAST_WRITE_RATE_PER_MINUTE`.
- **Fehler** haben die Form `{"error":{"code":"...","message":"..."}}`. Der `code` ist stabil und für Programme gedacht; die `message` ist englisch und für Menschen. Unbekannte interne Fehler liefern `500 internal` mit einer kurzen ID, die auch im Server-Log steht.
- **Nicht gefunden statt verboten:** Projekte, in denen du kein Mitglied bist, antworten mit `404 not_found`. Innerhalb eines Projekts antworten Aktionen, die deine Rolle nicht erlaubt, mit `403 forbidden`.
- Anfragen sind in der Größe begrenzt (Import: 2 MB).

## Instanz, Einrichtung, Anmeldung
| Methode und Pfad | Body | Antwort | Wer |
|---|---|---|---|
| `GET /instance` | | `{setupDone, publicKey, fingerprint}` | alle |
| `POST /setup` | `{setupToken, email, displayName, password}` | `201 {user, publicKey, fingerprint}` + Cookie | einmalig, mit dem Token aus dem Log |
| `POST /auth/login` | `{email, password}` | `{user}` + Cookie | alle |
| `POST /auth/logout` | | `{ok}` | angemeldet |
| `POST /auth/password-reset/request` | `{email}` | `202 {ok}` (gleiche Antwort für jede Adresse) | alle; ohne Mail `503 mail_disabled` |
| `POST /auth/password-reset/confirm` | `{token, password}` | `{ok}` | wer den Link hat |

## Eigenes Konto
| Methode und Pfad | Body | Antwort |
|---|---|---|
| `GET /me` | | `{user, mailEnabled}` |
| `PATCH /me` | beliebige von `{displayName, uiLocale: "en"\|"de", theme: "system"\|"light"\|"dark", notifyEmail: bool}` | `{user}` |
| `POST /me/password` | `{currentPassword, newPassword}` | `{ok}`; andere Sitzungen werden abgemeldet |

`user` = `{id, email, displayName, isInstanceAdmin, uiLocale, theme, notifyEmail}`.

## Einladungen zur Instanz
| Methode und Pfad | Body | Antwort | Wer |
|---|---|---|---|
| `POST /invitations` | `{email}` | mit Mail `201 {sent: true}`; ohne Mail `{inviteUrl}`; wenn der Versand scheitert `{sent: false, mailError: true, inviteUrl}` | Instanz-Admin |
| `POST /invitations/accept` | `{token, displayName, password}` | `201 {user}` + Cookie | wer den Link hat |

## Projekte, Sprachen, Mitglieder
| Methode und Pfad | Body / Query | Antwort | Wer |
|---|---|---|---|
| `GET /projects` | | `{projects: [{slug, name, roles: ["owner", "reviewer:de", ...]}]}` | angemeldet |
| `POST /projects` | `{slug, name, sourceLanguage, languages: [{tag, fallback?: [Kürzel]}]}` | `201 {project}`; der Slug `new` ist reserviert | Instanz-Admin (wird Owner) |
| `GET /projects/{slug}` | | `{project, roles: {owner, reviewer: [...], translator: [...]}, progress: {languages: [{tag, translated, total, percent, inReview, outdated, isSource}], liveRelease: {number, createdAt} \| null}}` | Mitglieder |
| `PATCH /projects/{slug}` | beliebige von `{name, soloMode, progressPublic}` | `{project}` | Owner |
| `PUT /projects/{slug}/languages/{tag}` | `{fallback: [Kürzel]}` | `{project}` (fügt die Sprache hinzu oder ändert ihre Kette) | Owner |
| `GET /projects/{slug}/members` | | Liste von `{id, email, displayName, role, language}` | Owner |
| `POST /projects/{slug}/members` | `{email, role: "owner"\|"reviewer"\|"translator", language?}` | vorhandenes Konto: `{added: true}`; unbekannte E-Mail: Einladung wie oben | Owner |
| `POST /projects/{slug}/members/remove` | `{userId, role, language?}` | `{ok}`; der letzte Owner kann nicht entfernt werden | Owner |
| `GET /projects/{slug}/invitations` | | `{invitations: [{id, email, role, language, createdAt, expiresAt, expired, invitedBy}]}` (noch nicht angenommen, auch abgelaufene) | Owner |
| `POST /projects/{slug}/invitations/{id}/revoke` | `{}` | `{revoked: true}`; der Link funktioniert nicht mehr | Owner |

`project` = `{id, slug, name, sourceLanguage, soloMode, progressPublic, languages: [{tag, fallback}]}`.

## Keys
| Methode und Pfad | Body / Query | Antwort | Wer |
|---|---|---|---|
| `GET /projects/{slug}/keys` | `?search=&state=active\|deprecated&limit=1..500&offset=` | `{total, keys: [{name, sourceText, contextNote, maxLength, state, translations: {Sprache: {text, outdated}}, openSuggestions: {Sprache: Anzahl}}]}` | Mitglieder; `translations` und `openSuggestions` nur für deine Sprachen |
| `POST /projects/{slug}/keys` | `{name, sourceText, contextNote?, maxLength?}` | `201 {name}` | Owner |
| `PATCH /projects/{slug}/keys/{name}` | beliebige von `{sourceText, contextNote, maxLength, state}` | `{name, outdatedMarked}` | Owner |
| `POST /projects/{slug}/keys/import` | `{texts: {...}, apply: bool, deprecateMissing?: bool}` | `{applied, added, changed, reactivated, unchanged, removed, removedAreDeprecated}` | Owner |

## Vorschläge und Prüfung
| Methode und Pfad | Body / Query | Antwort | Wer |
|---|---|---|---|
| `POST /projects/{slug}/suggestions` | `{key, language, text}` | `201 {id, warnings: [...]}` | Übersetzer, Prüfer, Owner dieser Sprache |
| `GET /projects/{slug}/suggestions` | `?language=&state=open\|approved\|rejected\|withdrawn\|superseded&mine=1&limit=1..200&offset=` | `{total, suggestions: [...]}` | ohne `mine`: die Prüf-Warteschlange deiner Sprachen (Standard `open`); mit `mine=1`: deine eigenen Vorschläge |
| `POST .../suggestions/{id}/approve` | `{}` | `{approved, solo, superseded}` | Prüfer und Owner dieser Sprache, nicht für eigene Texte (Solo-Modus: Owner) |
| `POST .../suggestions/{id}/reject` | `{reason}` (1–500 Zeichen) | `{rejected}` | Prüfer und Owner, nicht für eigene Texte |
| `POST .../suggestions/{id}/withdraw` | `{}` | `{withdrawn}` | die Person, die ihn geschrieben hat |

Ein Vorschlag in einer Liste: `{id, key, language, text, state, author, mine, createdAt, sourceText, currentText, sourceChanged, warnings, rejectReason}`.

Warnungscodes: `much_longer`, `much_shorter`, `whitespace_differs`, `punctuation_differs`, `same_as_source`, `new_url_or_email`, `looks_like_markup`.

## Releases
| Methode und Pfad | Body | Antwort | Wer |
|---|---|---|---|
| `GET /projects/{slug}/releases/preview` | | `{liveRelease, nextRelease, hasChanges, summary: {languages, soloApprovals, outdatedExcluded}, changes: {Sprache: {added, changed, removed}}, openSuggestions}` | Owner |
| `POST /projects/{slug}/releases` | `{note?}` (bis 1000 Zeichen) | `201 {release, summary}` | Owner |
| `POST /projects/{slug}/releases/{n}/rollback` | `{note?}` | `201 {release, rolledBackTo}` | Owner |
| `GET /projects/{slug}/releases` | | Verlauf: Nummer, Zustand, Datum, wer, Notiz, Änderungsübersicht, Rollback-Ziel, Fehlergrund | Mitglieder |

## Öffentliche Endpunkte (ohne Anmeldung)
| Pfad | Antwort |
|---|---|
| `GET /healthz` | `{status: "ok", schema}` oder `503` |
| `GET /progress/{slug}` | HTML-Fortschrittsseite (nur bei `progressPublic`) |
| `GET /api/v1/public/projects/{slug}/progress` | dieselben Zahlen als JSON |
| `GET /p/{slug}/manifest.json`, `.../manifest.json.sig`, `.../r/{n}/{Sprache}.json` | Release-Dateien, siehe [Auslieferung](delivery.md) |

## Fehlercodes
| Code | Status | Bedeutung |
|---|---|---|
| `unauthenticated` | 401 | nicht angemeldet |
| `bad_origin` | 403 | `Origin`-Header fehlt oder ist falsch |
| `forbidden` | 403 | deine Rolle erlaubt das nicht |
| `not_found` | 404 | unbekannt, oder ein Projekt, in dem du kein Mitglied bist |
| `rate_limited` | 429 | zu viele Anfragen (Anmelde-Endpunkte: von deiner IP; andere Schreibzugriffe: von deinem Konto) |
| `invalid_credentials`, `locked` | 401/429 | falsche Anmeldedaten, Konto für 15 Minuten gesperrt |
| `weak_password`, `invalid_email`, `invalid_field`, `invalid_name`, `invalid_slug`, `invalid_languages`, `invalid_language`, `invalid_role` | 400 | ungültige Eingabe |
| `bad_setup_token`, `setup_done` | 403/409 | Einrichtung |
| `invalid_invitation`, `invalid_token` | 400 | Einladungs- oder Reset-Link ungültig, abgelaufen oder benutzt |
| `mail_disabled` | 503 | Passwort-Reset braucht Mail |
| `exists` | 409 | Konto, Projekt oder Key gibt es schon |
| `invalid_text`, `invalid_import` | 400 | Text verletzt eine harte Regel; Import abgelehnt |
| `unchanged` | 409 | Vorschlag ist gleich der aktuellen Übersetzung |
| `too_many_open` | 429 | 100 offene Vorschläge pro Person und Projekt |
| `self_review` | 403 | eigener Vorschlag |
| `not_open` | 409 | Vorschlag wurde schon bearbeitet |
| `source_changed` | 409 | Ausgangstext hat sich nach dem Vorschlag geändert |
| `key_deprecated` | 409 | Key ist deprecated |
| `last_owner` | 409 | ein Projekt braucht einen Owner |
| `nothing_to_release`, `no_changes`, `already_live`, `release_running`, `invalid_release`, `release_failed` | 409/500 | Release konnte nicht gebaut werden |

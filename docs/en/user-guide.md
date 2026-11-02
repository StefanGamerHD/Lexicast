# User guide

## Roles
Lexicast separates the person who runs the server from the people who work on projects.

| Role | Scope | May |
|---|---|---|
| Instance admin | the server | invite people to the instance, create projects (and becomes their owner). Has **no** automatic access to other projects. |
| Owner | a project | everything in the project: keys and import, languages, members, settings, releases and rollback; suggest and review in every language |
| Reviewer | one language of a project | suggest, approve and reject in that language (never their own text) |
| Translator | one language of a project | suggest in that language, withdraw own suggestions |

A person can have several roles, for example reviewer for `de` and translator for `fr`. People who are not members of a project get "not found" for it, so they cannot even tell that it exists.

## Accounts
- **Invitation only.** There is no open registration. The instance admin invites people to the instance; project owners invite people to a project with a role. The invited person gets a link by mail (valid 7 days, usable once). Without mail the inviter sees the link once and passes it on.
- **Password:** at least 12 characters and not containing the name part of your email. After 5 wrong attempts the account is locked for 15 minutes.
- **Forgot password:** "Forgot your password?" on the sign-in page sends a link (valid 60 minutes, usable once, at most 3 per hour). Changing the password signs out all sessions. Only available when mail is set up.
- **Sessions** last 7 days.
- **Language and theme:** the header has a language switch (English, German) and a theme switch (system, light, dark). When you are signed in, both are saved in your account and follow you to other browsers.
- **Notifications:** Lexicast collects events (new suggestions in languages you review, your rejected suggestions, published releases, outdated translations) and sends one digest mail per person. You can switch this off in your account (`PATCH /api/v1/me` with `notifyEmail: false`; the screen comes with UI part 4).

## Projects
Projects are created by the instance admin. The web form follows with a later update; until then use the API:
```bash
curl -X POST https://translate.example.com/api/v1/projects \
  -H 'Content-Type: application/json' -H 'Origin: https://translate.example.com' -b cookies.txt \
  -d '{"slug":"shop","name":"Shop","sourceLanguage":"en","languages":[{"tag":"en"},{"tag":"de","fallback":["en"]},{"tag":"de-AT","fallback":["de","en"]}]}'
```
- **Slug:** lowercase letters, digits and dashes; it appears in URLs and in the delivery path.
- **Languages** are BCP 47 tags like `de` or `de-AT`. One of them is the source language.
- **Fallback chain:** when a text is missing in `de-AT`, the release uses `de`, then `en`. The chain is resolved when the release is built, so apps get complete files and need no fallback logic.
- **Settings** (owners): `soloMode` (see Review), `progressPublic` (public progress page), name.

The start page lists your projects. The project page shows each language with a progress bar, how many texts are in review or outdated, the live release, and buttons to translate or review.

## Keys and source texts
A key is one text of your app, e.g. `cart.items` with the source text `{count} items in your cart`. Owners manage keys through the API (screen in UI part 3):
- **Import** a JSON file, flat (`{"cart.title": "Your cart"}`) or nested (`{"cart": {"title": "Your cart"}}`). First send it with `apply: false` to see what would be added, changed, reactivated or removed; then with `apply: true`. The import is all-or-nothing: one invalid text rejects the whole file. `deprecateMissing: true` marks keys that are not in the file as deprecated.
- **Edit** a key: source text, context note for translators, maximum length, state (`active` or `deprecated`).
- **Changing a source text** marks all its translations as **outdated**. Outdated translations are not released until someone translates them again.
- Deprecated keys are hidden from translators and disappear from the next release.

## Placeholders and text rules
Placeholders look like `{name}`: letters, digits and underscore in curly braces. A translation must contain exactly the same placeholders as the source text. Plurals are separate keys (`items.one`, `items.other`); ICU message format is planned for later.

Hard rules (a suggestion is refused):
- same placeholders as the source; curly braces only as placeholders,
- not empty, at most 5000 characters or the key's maximum length,
- no control characters (newline is fine), no bidirectional override characters, Unicode in NFC form.

Soft warnings (shown to the reviewer, never block): much longer or shorter than the source, different spaces at start or end, different end punctuation, same as the source, a web address or email that is not in the source, text that looks like HTML. Texts are always delivered and shown as plain text, never as HTML.

## Translating
Open a project and press **Translate** next to a language you work on.
- **Left:** the list of keys with a search field and a filter: all, untranslated, outdated, in review, approved. On a phone you see the list first and the editor after choosing a key.
- **Right:** the editor. It shows the source text, the context note, the current approved translation (with an "outdated" mark if the source changed), your own open suggestion (with **Withdraw**) or the reason of your last rejected suggestion, and how many suggestions by others wait for review.
- **Placeholder chips** above the text field insert `{name}` at the cursor.
- The rules above are checked **while you type**; the button stays disabled while a hard rule is broken. A counter shows characters used and allowed.
- **Drafts** are saved in your browser automatically and survive a reload. They are sent only when you press **Send suggestion**.
- **Keyboard:** Ctrl+Enter (Cmd+Enter on a Mac) sends, Alt+↑ and Alt+↓ go to the previous or next key in the filtered list.

Sending a new suggestion for a key replaces your previous open suggestion for that key. You can have at most 100 open suggestions per project.

## Reviewing
Owners and reviewers see **Open review queue** on the project page.
- Choose a language or "all my languages".
- Each card shows the key, author and time, the source text, and the suggestion as a **word diff** against the current translation (removed words struck through, new words underlined). A text for a key without a translation is shown as "New translation".
- Warnings, a note when the source text changed after the suggestion was written (such suggestions cannot be approved; reject them so the author can update), and the number of other open suggestions for the same key.
- **Approve:** the text becomes the current translation and other open suggestions for the same key and language are closed (superseded). It goes live with the next release.
- **Reject…:** enter a reason (required, up to 500 characters). The author sees it in the editor and in the digest mail.
- **Batch approve:** suggestions without warnings have a "Select" box; **Approve selected** approves them one by one.

**Four-eyes rule:** nobody can approve their own suggestion. For projects with only one person, owners can switch on **solo mode**; then owners may approve their own texts, each such approval is logged as an exception and counted in the release preview. The database also enforces the rule.

## Releases
Owners publish releases (API now, screen in UI part 3):
1. **Preview** (`GET .../releases/preview`): next release number, changes per language (added, changed, removed), open suggestions, solo-mode approvals, outdated texts left out.
2. **Create** (`POST .../releases` with an optional note): Lexicast resolves fallbacks, writes one JSON file per language, signs the manifest and switches it live. Only one release per project can be built at a time. A failed build records the reason and leaves the live release untouched.
3. **History** (`GET .../releases`): all releases with notes, change summaries, failures and rollbacks.
4. **Rollback** (`POST .../releases/{n}/rollback`): publishes the content of an older release as a **new** release with a higher number, so apps accept it. History is never changed.

Approved texts are not live until a release is built. A release contains only active keys and translations that are not outdated.

## Public progress page
If an owner enables `progressPublic`, `/progress/{slug}` shows the translation progress per language to everybody, without sign-in: counts only, no key names, texts or people. It works without JavaScript, in German and English, light and dark. If the setting is off, the page answers "not found", exactly like for an unknown project.

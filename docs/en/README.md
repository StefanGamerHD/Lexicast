# Lexicast documentation

Lexicast is a self-hostable server for translations. Translators suggest texts, a second person approves them, a project owner publishes a release, and running apps fetch the new texts within minutes. Every release is a set of immutable JSON files plus a manifest signed with Ed25519, so apps can check that the texts really come from your server.

> Status: early, not ready for production use. This documentation describes what exists in the code today and marks what is planned.

Deutsche Fassung: [docs/de](../de/README.md)

## Contents
| Page | For whom | What |
|---|---|---|
| [Installation](installation.md) | operators | Docker, Node, first start, reverse proxy |
| [Configuration](configuration.md) | operators | every environment variable |
| [User guide](user-guide.md) | everybody | roles, translating, reviewing, releasing |
| [API reference](api.md) | developers, operators | every JSON endpoint |
| [Delivery and client](delivery.md) | app developers | release files, manifest, signature check |
| [Security](security.md) | everybody | how Lexicast protects texts, accounts and keys |
| [Operations](operations.md) | operators | backup, updates, mail, health, troubleshooting |
| [Development](development.md) | contributors | code layout, tests, contributing |

## How it fits together
```
translator ──suggest──▶ Lexicast ◀──approve── reviewer
                           │
                 owner: "release"
                           ▼
        signed manifest + JSON files (/p/{project}/...)
                           ▼
           app with the Lexicast client (checks signature)
```
1. The owner imports the source texts (keys) of a project.
2. Translators write suggestions for their languages.
3. A reviewer of that language approves or rejects them. Nobody approves their own text (four-eyes rule).
4. The owner builds a release. Lexicast writes the files, signs the manifest and publishes it.
5. Apps poll the manifest, verify the signature and switch to the new texts. If anything is wrong they keep the texts they have.

## What exists and what is planned
| Area | State |
|---|---|
| Setup, accounts, invitations, password reset, mail | done (API and UI) |
| Projects, languages with fallback chains, members and roles | done (API); UI planned (UI part 3) |
| Keys and JSON import with preview | done (API); UI planned (UI part 3) |
| Suggestions and review (four-eyes, solo mode) | done (API and UI) |
| Releases, rollback, history | done (API); UI planned (UI part 3) |
| Static delivery, public progress page | done |
| Account settings and instance admin screens | API partly done; UI planned (UI part 4) |
| API tokens, backup/restore command, audit log reader, key rotation | planned |
| Client library (MIT, own repository) | prototype only, not published |

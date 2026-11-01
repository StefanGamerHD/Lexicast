# Contributing

Thank you for helping. Lexicast is early; please open an issue before starting larger work so we can agree on the approach.

## Developer Certificate of Origin (DCO)

Contributions are accepted under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Sign off every commit:

```bash
git commit -s -m "Describe the change"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line, certifying that you wrote the change or have the right to submit it under the project's license (AGPL-3.0-only).

**Data notice:** the sign-off puts your name and email address into the Git history. Git history is public, permanent and copied by everyone who clones or forks the repository, so it cannot be fully erased on request. If you do not want this, use a commit email you are comfortable publishing (for example your GitHub no-reply address) or do not contribute code.

## Development

Node 24 or newer, `npm ci`, `npm run typecheck`, `npm test`. The server runs TypeScript directly (no build step). The server has one runtime dependency (nodemailer, exact version, installed from the lock file). Keep it that way where possible: explain every new dependency in the pull request, pin exact versions and prefer versions that have been public for at least two weeks.

## Security

Report vulnerabilities privately, see `SECURITY.md`.

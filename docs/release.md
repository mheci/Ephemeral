# Build and Release

## Local Check

```sh
npm ci
npm audit --audit-level=high
npm run secrets:audit -- --history
npm run check
npm run coverage
npm run bench
npm run test:e2e:prepare
FIREFOX_BIN=/path/to/firefox npm run test:e2e
npm run package
npm run package:source
```

Run package commands twice, compare SHA-256. Archive must have no tests, sourcemaps, creds, artwork, WASM.

## CI

Every push/PR runs: format, lint, typecheck, docs:check, secrets:audit, unit/integration/stress/coverage, manifest/package validation, npm audit, real-Firefox stable+Beta e2e, CodeQL, dependency review.

Dependabot grouped, requires checks + owner approval.

## Release Prep

Release Please uses conventional commits, maintains release PR that updates:

- package.json, package-lock.json
- src/manifest.json
- CHANGELOG.md
- tag + GitHub notes

Only reviewed main changes eligible.

When release-please creates the version bump commit it also creates the tag and GitHub
release, then dispatches the "Signed release" workflow for the new tag (a GITHUB_TOKEN-created
release does not fire its own `release` event). If that dispatch is ever suppressed, an owner
can trigger signing manually: Actions → Signed release → Run workflow (existing tag), or
`gh workflow run "Signed release" -f tag=vX.Y.Z`.

## Signing

Release workflow rebuilds, retests tagged source, creates deterministic archives, submits via Mozilla unlisted signing channel (JWT), verifies returned XPI, uploads:

- ephemeral-<version>-signed.xpi
- ephemeral-<version>.zip
- ephemeral-<version>-source.zip
- SHA256SUMS

AMO creds in protected `amo-production` env. No public AMO listing – GitHub is distribution.

A follow-up job ("Publish Firefox update manifest") regenerates `updates.json` from the published
releases, sanity-checks it against the manifest's gecko id/urls, and deploys it to `gh-pages`
(fast-forward only) so https://mheci.github.io/Ephemeral/updates.json serves the auto-update channel.
The job runs for tag builds and dispatches with a resolved tag, and skips scheduled runs that found
nothing to sign. Never edit updates.json by hand.

Complete only when signed XPI attached and its version, ID, install, UI startup, cleanup smoke test pass.

## Versioning

- Patch: bug fixes
- Minor: backward-compatible features or default changes
- Major: incompatible settings, storage, perms, behavior

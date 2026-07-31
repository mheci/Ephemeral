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

## Signing

Release workflow rebuilds, retests tagged source, creates deterministic archives, submits via Mozilla unlisted signing channel (JWT), verifies returned XPI, uploads:

- ephemeral-<version>-signed.xpi
- ephemeral-<version>.zip
- ephemeral-<version>-source.zip
- SHA256SUMS

AMO creds in protected `amo-production` env. No public AMO listing – GitHub is distribution.

Complete only when signed XPI attached and its version, ID, install, UI startup, cleanup smoke test pass.

## Versioning

- Patch: bug fixes
- Minor: backward-compatible features or default changes
- Major: incompatible settings, storage, perms, behavior

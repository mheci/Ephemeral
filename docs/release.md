# Build and release

## Local production check

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

Run both package commands twice and compare SHA-256 hashes. The extension archive must contain no tests, source maps, credentials, documentation artwork, or WebAssembly.

## Continuous integration

Every push and pull request runs:

- formatting, typed linting, and strict TypeScript checks;
- documentation and complete-history secret checks;
- unit, integration, stress, and coverage tests;
- manifest and package-layout validation;
- dependency audit;
- real-Firefox tests on stable and Beta;
- CodeQL and dependency review.

Dependabot groups development and workflow updates. Automated dependency pull requests require all checks and owner review before merge.

## Release preparation

Release Please reads conventional commit messages and maintains a release pull request. The release pull request updates:

- `package.json` and `package-lock.json`;
- `src/manifest.json`;
- `CHANGELOG.md`;
- the release tag and GitHub release notes.

Only reviewed changes on `main` are eligible for release.

## Signing and publication

The release workflow rebuilds and retests the tagged source, creates deterministic extension and source archives, submits the extension through Mozilla's unlisted signing channel, verifies the returned XPI, and uploads these assets to GitHub:

- `ephemeral-<version>-signed.xpi`;
- `ephemeral-<version>.zip`;
- `ephemeral-<version>-source.zip`;
- `SHA256SUMS`.

AMO credentials are stored in the protected `amo-production` GitHub environment. The workflow does not create a public AMO listing. GitHub is the distribution location.

The release is considered complete only when the signed XPI is attached and its manifest version, extension ID, Firefox installation, UI startup, and cleanup smoke test have passed.

## Versioning

- Patch: bug fixes and maintenance
- Minor: backward-compatible features or meaningful default changes
- Major: incompatible settings, storage, permission, or behavior changes

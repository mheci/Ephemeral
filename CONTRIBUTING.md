# Contributing

Ephemeral accepts focused proposals and security reports. Repository ownership and release authority remain with `astarling-x`.

## Development setup

```sh
git clone https://github.com/astarling-x/Ephemeral.git
cd Ephemeral
npm ci
npm run check
```

Requirements: Node.js 20.19+, npm 10+, Python 3.11+, Firefox 153+, and geckodriver.

## Pull requests

A pull request should:

- solve one clearly described problem;
- explain user-visible behavior and failure handling;
- include regression tests;
- preserve container ownership and cleanup ordering;
- update relevant documentation and the changelog;
- include measurements for resource-sensitive changes;
- avoid unrelated formatting or dependency changes.

Run before requesting review:

```sh
npm audit --audit-level=high
npm run secrets:audit -- --history
npm run check
npm run coverage
npm run bench
npm run test:e2e:prepare
FIREFOX_BIN=/path/to/firefox npm run test:e2e
npm run package
```

## Engineering requirements

- Keep Firefox API access behind `FirefoxAdapter`.
- Record state before crossing browser/storage boundaries.
- Never remove global data to imitate container cleanup.
- Prefer events and one-shot alarms; do not poll.
- Keep every retry, timer, listener, lock, history list, and cache bounded.
- Do not log or persist URLs, cookie values, hostnames, page titles, or page content.
- Do not add telemetry, remote code, host permissions, or runtime dependencies.
- Do not commit generated builds, profiles, diagnostics, credentials, signed XPIs, or AMO responses.

A new cleanup category requires official Firefox documentation, a cross-container safety test, failure recovery coverage, and a real-Firefox test.

## Automated maintenance

Dependabot groups dependency updates. Automated pull requests must pass all required checks and receive owner approval before merge. Release automation uses conventional commit messages to prepare version updates and release notes.

## Security reports

Use the private process in [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.

Contributions are licensed under MPL-2.0.

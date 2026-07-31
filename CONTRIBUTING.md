# Contributing

Efficient, focused PRs only. Repository owned by `mheci`.

## Setup

```sh
git clone https://github.com/mheci/Ephemeral.git
cd Ephemeral
npm ci
npm run check
```

Requires Node 20.19+, npm 10+, Python 3.11+, Firefox 153+, geckodriver.

## PR Requirements

- One problem per PR, clear description of behavior and failure handling
- Tests for regression, preserve cleanup ordering and ownership
- Update docs/changelog if user-visible
- Measurements for performance changes
- No unrelated formatting or deps

Pre-review:

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

## Engineering Rules

- Firefox APIs only via `FirefoxAdapter`
- Record state before crossing storage/browser boundaries
- Never delete global data to fake container cleanup
- Events + one-shot alarms, no polling
- All retries, timers, listeners, locks, history, caches bounded
- Never log/persist URLs, cookies, hostnames, titles, page content
- No telemetry, remote code, host perms, runtime deps
- Don't commit builds, profiles, diagnostics, creds, signed XPIs

New cleanup category needs: Firefox docs, cross-container safety test, recovery test, real-Firefox test.

## Security

Use private process in SECURITY.md, not public issues. Licensed MPL-2.0.

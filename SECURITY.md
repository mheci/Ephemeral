# Security Policy

## Supported

Only latest release. Update promptly when new signed XPI published.

## Reporting

Use GitHub Security Advisories privately. No credentials, browsing data, profiles, or unredacted diagnostics in public issues.

Include: Ephemeral + Firefox versions, OS, repro steps, expected vs observed, whether unrelated containers/global data affected.

## Boundaries

- Cleanup only via documented Firefox WebExtension APIs
- Never delete global data to fake container cleanup
- Remove identity only after scoped cleanup succeeds
- Serialized, recoverable operations
- Settings import: exact schema, bounded 64 KiB, safe URLs, unknown-field rejection
- Messages: same-extension sender only
- UI text rendered as text, not HTML
- No outbound network, no host perms, no content scripts, no native messaging, no runtime deps
- Bounded: errors, retries, history, alarms, locks, caches

## Supply Chain

- `package-lock.json` pins deps
- Checks before release: dependency review, npm audit, CodeQL, secret scanning, lint, tests, package validation, real-Firefox e2e
- Grouped dependency updates
- Reproducible builds with source archives + checksums
- AMO creds in protected GitHub environment only
- No creds/private keys committed

## Response

1. Add regression test
2. Fix smallest surface
3. Run full checks
4. Rotate creds if needed
5. Publish higher signed version
6. Document impact without exposing user data

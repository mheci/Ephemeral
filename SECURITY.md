# Security policy

## Supported version

Only the latest release is supported. Users should update promptly when a new signed XPI is published.

## Reporting a vulnerability

Report security issues privately through GitHub Security Advisories. Do not include credentials, real browsing data, Firefox profiles, or unredacted diagnostics in a public issue.

A useful report includes:

- Ephemeral and Firefox versions;
- operating system;
- reproduction steps;
- expected and observed behavior;
- whether unrelated containers or global browser data were affected.

## Security boundaries

Ephemeral protects managed-container ownership, cleanup ordering, local settings, and unrelated Firefox data.

The project follows these rules:

- Cleanup uses only documented Firefox WebExtension APIs.
- Globally scoped browser data is never deleted as a substitute for container cleanup.
- The container identity is removed only after supported scoped cleanup succeeds.
- Cleanup operations are serialized and recoverable.
- Imported settings use an exact schema, bounded size, safe URL rules, and unknown-field rejection.
- Runtime messages accept only same-extension senders.
- UI text is rendered as text, not injected HTML.
- Extension pages cannot make outbound network connections.
- There are no host permissions, content scripts, native messaging, or runtime dependencies.
- Errors, retries, history, alarms, locks, and caches are bounded.

## Supply-chain controls

- `package-lock.json` pins build dependencies.
- Dependency review, npm audit, CodeQL, secret scanning, typed linting, tests, package validation, and real-Firefox automation run before release.
- Dependency updates are grouped for review.
- Release builds are reproducible and include source archives and checksums.
- AMO credentials are stored only in a protected GitHub environment.
- No credential or private key may be committed or attached to a release.

## Release response

For a confirmed vulnerability:

1. Add a regression test.
2. Fix the smallest affected surface.
3. Run the complete release checks.
4. Rotate affected credentials.
5. Publish a higher signed version.
6. Document impact and upgrade guidance without exposing user data.

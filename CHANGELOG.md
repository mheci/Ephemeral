# Changelog

## [1.4.0](https://github.com/mheci/Ephemeral/compare/v1.3.0...v1.4.0) (2026-08-01)


### Features

* ephemeral windows, honest site-data reporting, resilient state recovery ([#3](https://github.com/mheci/Ephemeral/issues/3)) ([db82d50](https://github.com/mheci/Ephemeral/commit/db82d509e6420237093a49c053f8a313837bf4f5))

## 1.2.0 — 2026-07-29

### Added

- Disposable and reusable Firefox container sessions
- Last-tab, browser-restart, inactivity, and manual cleanup policies
- Concurrent session management
- Automatic recovery and bounded cleanup retries
- Dashboard, toolbar popup, cleanup reports, diagnostics, and settings import/export
- Optional container-scoped download-history cleanup
- Production package verification and real-Firefox browser tests
- Continuous integration, dependency review, security analysis, grouped dependency updates, and automated release preparation

### Improved

- Default start page changed to `about:blank` for predictable container creation
- Firefox native New Tab requests use the supported URL-omission path
- Reusable-session inactivity default reduced to 30 minutes
- Cleanup history default reduced to 50 entries
- Retry schedule shortened while remaining bounded
- Normal tab-close handling queries only the affected managed container
- UI startup uses bounded requests with clear error and retry states
- Invalid settings recover safely without losing valid managed-container ownership records

### Security and privacy

- No telemetry, analytics, advertising, tracking, remote logging, host permissions, content scripts, or runtime dependencies
- No global browser-data deletion
- Strict import validation and same-extension message checks
- Complete-history secret auditing and package-layout validation
- Local-only state with bounded retention

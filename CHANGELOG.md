# Changelog

## [2.3.1](https://github.com/mheci/Ephemeral/compare/v2.3.0...v2.3.1) (2026-08-05)


### Bug Fixes

* unbiased token generation; simplify popup ([#19](https://github.com/mheci/Ephemeral/issues/19)) ([c85128b](https://github.com/mheci/Ephemeral/commit/c85128bfca745186e2aaaf8dd0d8d79c414a1a0f))

## [2.3.0](https://github.com/mheci/Ephemeral/compare/v2.2.0...v2.3.0) (2026-08-05)


### Features

* redesign and modernize the extension popup ([#17](https://github.com/mheci/Ephemeral/issues/17)) ([fa2acce](https://github.com/mheci/Ephemeral/commit/fa2accebbc5126d2e3379c95f6058a87c25c1ddf))

## [2.2.0](https://github.com/mheci/Ephemeral/compare/v2.1.0...v2.2.0) (2026-08-02)


### Features

* add opt-in global browsing history sweep ([#14](https://github.com/mheci/Ephemeral/issues/14)) ([2e41841](https://github.com/mheci/Ephemeral/commit/2e418419137d5ca674db203bd4de0464dd864cfe))

## [2.1.0](https://github.com/mheci/Ephemeral/compare/v2.0.1...v2.1.0) (2026-08-01)


### Features

* add undo-close drain grace and lifetime privacy stats ([#12](https://github.com/mheci/Ephemeral/issues/12)) ([83d2388](https://github.com/mheci/Ephemeral/commit/83d23883866b22e5a22ac1debf97cd8510b7c2ed))

## [2.0.1](https://github.com/mheci/Ephemeral/compare/v2.0.0...v2.0.1) (2026-08-01)


### Bug Fixes

* move tab and space shortcuts off Firefox defaults ([#10](https://github.com/mheci/Ephemeral/issues/10)) ([ff9bcef](https://github.com/mheci/Ephemeral/commit/ff9bceffafca838328d8bf4f4c38706244b70386))

## [2.0.0](https://github.com/mheci/Ephemeral/compare/v1.5.0...v2.0.0) (2026-08-01)


### ⚠ BREAKING CHANGES

* migrate add-on identity to ephemeral@mheci.github.io ([#8](https://github.com/mheci/Ephemeral/issues/8))

### Features

* migrate add-on identity to ephemeral@mheci.github.io ([#8](https://github.com/mheci/Ephemeral/issues/8)) ([9361f4f](https://github.com/mheci/Ephemeral/commit/9361f4f2a340a65937b94ecaaf0144dbab489356))

## [1.5.0](https://github.com/mheci/Ephemeral/compare/v1.4.0...v1.5.0) (2026-08-01)


### Features

* brand and modernize the extension design ([#6](https://github.com/mheci/Ephemeral/issues/6)) ([d5d9e60](https://github.com/mheci/Ephemeral/commit/d5d9e601bcb8900daf72179f57c8c2de914bdb3c))

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

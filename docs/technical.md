# Technical design

## Overview

Ephemeral is a Firefox Manifest V3 extension. Its background page is non-persistent: Firefox starts it when an event requires work and may stop it when idle.

The extension contains four main areas:

- **Firefox adapter:** the only code that calls Firefox APIs directly.
- **Container manager:** creates containers, opens tabs, and records activity.
- **Lifecycle controller:** responds to tab, alarm, startup, and user events.
- **Cleanup engine:** performs ordered cleanup, verification, recovery, and reporting.

All important state is stored locally in one versioned record. UI pages communicate with the background page through validated same-extension messages.

## Container creation

1. Store a creation intent before asking Firefox to create a container.
2. Create the Firefox contextual identity.
3. Replace the intent with the managed-container record.
4. Schedule inactivity cleanup when enabled.
5. Open the requested start page.

Firefox rejects an explicit `about:newtab` URL when a container cookie-store ID is supplied. Ephemeral therefore omits the URL for that setting and lets Firefox open its native New Tab page inside the container. `about:blank`, HTTP, and HTTPS pages are passed explicitly after validation.

A random token in the container name allows recovery to identify an interrupted creation without claiming unrelated user containers.

## Cleanup order

1. Record a pending cleanup operation.
2. Recheck the lifecycle condition.
3. Close the container's tabs and confirm they are closed.
4. Request container-scoped removal of cookies, IndexedDB, local storage, and session storage.
5. Optionally erase download-history entries associated with the container.
6. Remove the Firefox contextual identity.
7. Confirm the identity and tabs are absent.
8. Remove active extension state and append a bounded cleanup report.

If scoped cleanup fails, the identity remains available for retry. Work for the same container is serialized so duplicate events cannot run cleanup concurrently.

## Recovery

The extension records work before performing it. On startup it:

- resumes interrupted cleanup;
- recovers exact creation intents;
- re-arms inactivity and retry alarms;
- reconciles externally removed identities;
- repairs invalid settings to defaults while preserving valid ownership records.

An unknown storage schema fails closed. Ephemeral does not guess how to interpret container ownership.

## Resource use

- No polling or repeating intervals
- No content scripts or page observers
- No runtime network requests
- No runtime dependencies or WebAssembly
- One inactivity alarm only when enabled for a container
- At most one retry alarm per failed container and one global recovery alarm
- Bounded history, retries, locks, timers, errors, and in-memory tab ownership
- Normal tab-close events query only the affected container
- Cold background starts use a limited fallback scan only when Firefox no longer exposes the removed tab's container ID

Persistent growth is proportional to active containers plus the configured cleanup-history limit. Completed active records are removed.

## UI reliability

Popup and dashboard pages move through `starting`, `ready`, or `error` states. Background requests have a fixed timeout and visible retry controls. Local storage and permission events trigger a short combined refresh; listeners and timers are removed when the page closes.

The build verifies every HTML and manifest resource. Production packages reject missing or empty files, path escapes, test files, source maps, and WebAssembly.

## Tests

The test suite covers:

- policy and settings validation;
- creation, cleanup, retry, and restart recovery;
- last-tab races and concurrent containers;
- native container New Tab creation;
- malformed state recovery;
- popup and dashboard startup;
- 1,000 sequential disposable sessions with bounded state;
- real Firefox cookies, local storage, IndexedDB, container isolation, and last-tab cleanup;
- production package structure and permissions.

Run all local checks:

```sh
npm ci
npm run check
npm run coverage
npm run bench
npm run test:e2e:prepare
FIREFOX_BIN=/path/to/firefox npm run test:e2e
```

## Firefox limits

Firefox can safely target cookies, IndexedDB, local storage, and session storage by container ID. Download-history entries can also be filtered by container ID when the optional permission is granted.

Firefox does not provide safe container-scoped removal for browsing history, browser cache, Cache Storage, service workers, saved passwords, form history, site permissions, HSTS, TLS sessions, DNS state, bookmarks, or downloaded files. Ephemeral does not remove those categories globally.

Browser-exit cleanup runs on the next Firefox startup because extensions cannot block browser shutdown until asynchronous cleanup finishes.

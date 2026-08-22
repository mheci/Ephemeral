# Technical Design

## Overview

MV3 extension, non-persistent background (event-driven). Four core areas:

- **Firefox adapter:** only Firefox API calls
- **Container manager:** creates containers, opens tabs
- **Controller:** tab/ alarm/ startup events, tab ownership tracking
- **Cleanup engine:** ordered cleanup + verification + recovery

State stored locally in one versioned record. UI talks to background via validated messages.

## Container Creation

1. Store creation intent
2. Create contextual identity (random token in name for recovery)
3. Replace intent with managed record
4. Schedule inactivity alarm
5. Open start page or custom URL in a tab (mode `none`/`tab`), or create a dedicated browser window bound to the container (mode `window`, `windows.create` with `cookieStoreId`)
6. `about:blank` / `about:newtab` handled specially – Firefox rejects explicit `about:newtab` with cookieStoreId, so the URL is omitted

## Ephemeral Windows

A "new ephemeral window" is a dedicated browser window whose tabs all belong to a fresh container. It is created with `browser.windows.create({ cookieStoreId, url })` (supported for containers since Firefox 64, bug 1393570). The window's first tab is tracked in the tab-owner index immediately after creation, so closing the window triggers the same last-tab cleanup path as any other tab. Surfaced via the popup, an assignable command (`open-ephemeral-window`), and link/page context-menu items.

## Cleanup Order (monster)

1. Record pending
2. Recheck condition (e.g., new tab opened?)
3. Close tabs, confirm closed
4. Remove scoped site data: cookies, indexedDB, localStorage (batched, falling back per type), then cacheStorage, serviceWorkers – each type's success is recorded individually; the report lists exactly which types Firefox accepted and which it rejected
5. Optional download-history erase (if permission)
6. Optional global history sweep (`sweepGlobalHistory`, default off): erases the ENTIRE Firefox history via `browsingData.remove({since:0},{history:true})` – Firefox has no container-scoped history API (Places is global). Reported as a `history-sweep` step and labeled global. A rejection degrades the step to `limited`; it never fails container cleanup.
7. Remove identity
8. Verify identity + tabs gone
9. Remove extension state, append bounded report

If every scoped data type is rejected, the identity stays for retry and the container is marked failed (never destroyed with unverifiable residue). Same-container work serialized via KeyedLock (bounded, timeout).

## Drain Grace (Undo Close)

When the last tab of a container closes and `destroyOnLastTabClose` is set, cleanup is deferred for `policy.graceSeconds` (0 = instant, current behavior; max 600 s):

1. The record stores `drainDeadline` and a `ephemeral:drain:<id>` alarm is armed at that deadline; the inactivity alarm is disarmed so nothing double-cleans during the window.
2. Reopening a tab (including Firefox's Ctrl+Shift+T "Undo Close Tab") fires `onTabActivity` → `touch` → clears `drainDeadline`, cancels the drain alarm, re-arms inactivity.
3. When the alarm fires the controller re-checks tabs; if a tab raced back it clears the drain instead of cleaning. Otherwise cleanup runs with trigger `grace-expired` (same tab-recheck guard as `last-tab-closed`).
4. Persisted `drainDeadline` survives event-page suspension: `recoverLifecycle` re-arms the alarm, or settles an expired window immediately (cleanup, or drain-clear if a tab exists).
5. Changing a session policy re-anchors an active drain to the new grace value, or clears it when grace is disabled.
6. The popup and dashboard show a live "cleans in Ns" countdown chip (1 s ticker, stopped when no drains exist).

## Panic Wipe

Panic clean is a global, keyboard-first counterpart to per-container cleanup:

1. `PANIC_CLEAN` (popup/dashboard button or the assignable `panic-clean` command) arms
   `panicDeadline = now + settings.panicGraceSeconds * 1000` on EVERY active container in one
   batched transaction and arms an `ephemeral:panic:<id>` alarm per container. Default grace is
   10 s (0–600 s, dashboard "Cleanup" section).
2. Expiry calls cleanup with the dedicated `panic-expired` trigger, which – unlike
   `last-tab-closed`/`grace-expired` – force-cleans regardless of open tabs.
3. Undo is explicit only: `CANCEL_PANIC_CLEAN` clears every pending panic deadline and alarm.
   Tab activity touches containers (which cancels drains) but never cancels a panic wipe.
4. Persisted `panicDeadline` survives event-page suspension: recovery re-arms future deadlines
   and settles expired ones immediately with the same force-cleanup semantics.

## Lifetime Privacy Stats

Local-only counters in the persisted state (`lifetimeStats`), surfaced on the dashboard hero and in diagnostics exports: sessions created, sessions cleaned, failed cleanups, container-scoped data types Firefox acknowledged erasing, and tabs closed by cleanups. They are incremented only inside the same transaction that records the event, survive browser restarts, and are never sent anywhere. A missing or corrupted stats object in stored state resets to zeros without affecting managed containers.

## Recovery

Records work before doing it. On startup:

- Resume interrupted cleanup
- Recover creation intents (match by expectedName + token)
- Re-arm inactivity, drain, and retry alarms; settle expired drain windows
- Reconcile externally removed identities
- Repair invalid settings to defaults, preserve ownership

Unknown state schema: settings/history reset, parseable container records salvaged, state rewritten under the current schema.

## Resource Use – Invisible

- No polling, no content scripts, no network, no deps, no WASM
- One inactivity alarm per container (when enabled), one drain alarm per active undo-close window,
  one panic alarm per armed wipe, one retry per failed, one global recovery
- Bounded: history (50 default, 0-500), retries, locks (max 200 keys, auto-prune), timers, tabOwners (500 max, debounced session storage save)
- Reverse index containerId→Set<tabId> for O(1) forget
- Tab ownership persisted to storage.session to survive event-page restarts – avoids full scan fallback
- Badge reads a primitive {total, failed, pending} summary; per-tab-event cookie-store lookup scans the in-memory index – neither clones the persisted state
- Independent warm-up stages of event-page initialization run concurrently (tab-owner load, session id, capabilities)
- Badge text/color cached to avoid redundant API calls
- Logger silent for debug/info, throttled warn (5s)
- Hotkeys & context menus debounced 350ms
- getPublicState sequential, not Promise.all burst
- Background non-persistent, event-driven

Growth proportional to active containers + history limit.

## Hotkeys & Automation

**Manifest commands:**

- `open-ephemeral-tab` Ctrl+Alt+E (MacCtrl+Shift+E on macOS)
- `open-ephemeral-space` Ctrl+Alt+U (MacCtrl+Shift+U on macOS)
- `open-ephemeral-window` assignable (no default key)
- `_execute_action` Ctrl+Shift+Period (popup)

The default shortcuts avoid Firefox's built-in bindings (Ctrl+Shift+E is the
Network Monitor, Ctrl+Shift+U collides with the View Source family); browser-owned
combinations cannot be overridden and would silently not fire.

**Background:** `commands.onCommand` + `menus.onClicked` (link/page context) both debounced, call `createContainerWithUrl` / `createWindow` with sanitized URL (http/https/about:blank/about:newtab only, strips creds, 2048 cap).

**Context menus:** `menus` permission, 5 items (link tab/space/window, page tab/window) created onInstalled, onStartup, init.

## UI Reliability

Popup/dashboard have `booting|ready|error` states, 10s request timeout, retry controls. Storage/permission changes trigger debounced 120ms refresh. Listeners removed on pagehide. Build verifies all HTML/manifest resources, rejects empty files, path escapes, test files, sourcemaps, WASM.

## Onboarding

New file `src/onboarding/` – 4 steps, plain language, theme-able via `ui.css` variables (light/dark via prefers-color-scheme). Triggered on `runtime.onInstalled` reason install if `onboardingCompleted` not set. Stores flag in storage.local. Includes hotkey demos, cleanup visual, final actions to try ephemeral tab or open dashboard, keyboard navigation (arrows, Enter, Escape).

## Update Channel

Ephemeral is unlisted on AMO (signed via the `unlisted` channel; GitHub Releases is the
distribution), so Mozilla does not deliver updates. The manifest pins
`browser_specific_settings.gecko.update_url` to `https://mheci.github.io/Ephemeral/updates.json`.
`scripts/update-manifest.mjs` regenerates that Firefox update manifest from the repository's
published releases – every non-draft release carrying an `ephemeral-<version>-signed.xpi` asset
becomes an entry (newest first) with `update_hash` from the release asset's sha256 digest. The
release workflow's "Publish Firefox update manifest" job regenerates, sanity-checks, and deploys it
to the orphan `gh-pages` branch (fast-forward only). Installs predating v2.4.0 carry no update_url:
one manual reinstall of any ≥2.4.0 signed XPI moves them onto the auto-update track.

## Tests

- Unit: policy, validation, defaults, errors, keyed-lock, scheduler, state-repo, firefox-adapter, ui-client, update-manifest
- Integration: controller lifecycle, recovery, message-router, ui-reliability, panic wipe
- Stress: 1000 sequential sessions bounded
- E2E: real Firefox cookies, localStorage, IndexedDB, isolation, last-tab cleanup, ephemeral window close cleanup
- Bench: policy hot paths
- Coverage thresholds: lines 80, funcs 80, stmts 80, branches 70

Local checks: `npm run check` (format, lint, typecheck, docs:check, secrets:audit, test, extension:lint)

## Firefox Limits

Container-scoped via `cookieStoreId`: cookies, indexedDB, localStorage, cacheStorage, serviceWorkers. Each type is attempted individually, and the cleanup report names exactly which types Firefox accepted or rejected on that run (a partially accepted removal is reported as `completed-with-limitations`, a fully rejected one fails the container for retry). Download history filterable if optional permission granted.

Not safely container-scoped: history, HTTP cache, passwords, form data, permissions, HSTS, TLS, DNS, downloaded files, bookmarks. Ephemeral never deletes global data as a silent substitute. The one opt-in exception is `sweepGlobalHistory`: Firefox cannot scope history removal to a container, so when enabled, every container cleanup additionally erases the entire global browsing history and the cleanup report labels the `history-sweep` step as global.

Browser-exit cleanup runs on next startup (extensions cannot block shutdown).

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
6. Remove identity
7. Verify identity + tabs gone
8. Remove extension state, append bounded report

If every scoped data type is rejected, the identity stays for retry and the container is marked failed (never destroyed with unverifiable residue). Same-container work serialized via KeyedLock (bounded, timeout).

## Recovery

Records work before doing it. On startup:

- Resume interrupted cleanup
- Recover creation intents (match by expectedName + token)
- Re-arm inactivity + retry alarms
- Reconcile externally removed identities
- Repair invalid settings to defaults, preserve ownership

Unknown state schema: settings/history reset, parseable container records salvaged, state rewritten under the current schema.

## Resource Use – Invisible

- No polling, no content scripts, no network, no deps, no WASM
- One inactivity alarm per container (when enabled), one retry per failed, one global recovery
- Bounded: history (50 default, 0-500), retries, locks (max 200 keys, auto-prune), timers, tabOwners (500 max, debounced session storage save)
- Reverse index containerId→Set<tabId> for O(1) forget
- Tab ownership persisted to storage.session to survive event-page restarts – avoids full scan fallback
- Badge cached to avoid redundant API calls
- Logger silent for debug/info, throttled warn (5s)
- Hotkeys & context menus debounced 350ms
- getPublicState sequential, not Promise.all burst
- Background non-persistent, event-driven

Growth proportional to active containers + history limit.

## Hotkeys & Automation

**Manifest commands:**

- `open-ephemeral-tab` Ctrl+Shift+E
- `open-ephemeral-space` Ctrl+Shift+U
- `open-ephemeral-window` assignable (no default key)
- `_execute_action` Ctrl+Shift+Period (popup)

**Background:** `commands.onCommand` + `menus.onClicked` (link/page context) both debounced, call `createContainerWithUrl` / `createWindow` with sanitized URL (http/https/about:blank/about:newtab only, strips creds, 2048 cap).

**Context menus:** `menus` permission, 5 items (link tab/space/window, page tab/window) created onInstalled, onStartup, init.

## UI Reliability

Popup/dashboard have `booting|ready|error` states, 10s request timeout, retry controls. Storage/permission changes trigger debounced 120ms refresh. Listeners removed on pagehide. Build verifies all HTML/manifest resources, rejects empty files, path escapes, test files, sourcemaps, WASM.

## Onboarding

New file `src/onboarding/` – 4 steps, plain language, theme-able via `ui.css` variables (light/dark via prefers-color-scheme). Triggered on `runtime.onInstalled` reason install if `onboardingCompleted` not set. Stores flag in storage.local. Includes hotkey demos, cleanup visual, final actions to try ephemeral tab or open dashboard, keyboard navigation (arrows, Enter, Escape).

## Tests

- Unit: policy, validation, defaults, errors, keyed-lock, scheduler, state-repo, firefox-adapter, ui-client
- Integration: controller lifecycle, recovery, message-router, ui-reliability
- Stress: 1000 sequential sessions bounded
- E2E: real Firefox cookies, localStorage, IndexedDB, isolation, last-tab cleanup, ephemeral window close cleanup
- Bench: policy hot paths
- Coverage thresholds: lines 80, funcs 80, stmts 80, branches 70

Local checks: `npm run check` (format, lint, typecheck, docs:check, secrets:audit, test, extension:lint)

## Firefox Limits

Container-scoped via `cookieStoreId`: cookies, indexedDB, localStorage, cacheStorage, serviceWorkers. Each type is attempted individually, and the cleanup report names exactly which types Firefox accepted or rejected on that run (a partially accepted removal is reported as `completed-with-limitations`, a fully rejected one fails the container for retry). Download history filterable if optional permission granted.

Not safely container-scoped: history, HTTP cache, passwords, form data, permissions, HSTS, TLS, DNS, downloaded files, bookmarks. Ephemeral never deletes global data as substitute.

Browser-exit cleanup runs on next startup (extensions cannot block shutdown).

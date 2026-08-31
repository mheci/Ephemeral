# Ephemeral

[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-orange.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/mheci/Ephemeral)](https://github.com/mheci/Ephemeral/releases/latest)
[![Firefox](https://img.shields.io/badge/Firefox-153%2B-blue)](https://www.mozilla.org/firefox)

**Private tabs that clean themselves.** One hotkey, zero traces.

Ephemeral creates temporary Firefox containers – isolated spaces for browsing. When you close the last tab, everything inside that container is erased automatically. No history, no cookies, no leftover data. It feels like normal browsing, but completely private.

> Personal project, experimental. Anything can change or break without notice.

## For Novices

**What it does:** Gives you disposable tabs. Each tab lives alone, can't see your other tabs, and self-destructs when closed.

**How it functions:**

1. Press `Ctrl+Alt+E` → new isolated tab opens
2. Browse normally
3. Close the tab → Firefox erases cookies, storage, cache for that container
4. Nothing left behind

**How it behaves:**

- Isolated: Each ephemeral tab can't access your normal tabs
- Automatic: Cleans on last-tab close, browser restart, or inactivity
- Invisible: No telemetry, no network, no tracking – runs entirely on your device
- Fast: Hotkey, right-click menu, or toolbar button – all feel native

First time you install, a friendly 4-step intro overlay appears, theme-matched to your browser (light/dark), explaining everything in plain language.

## Install

Firefox 153+ required.

1. Download latest `-signed.xpi` from [Releases](https://github.com/mheci/Ephemeral/releases/latest)
2. Open file in Firefox → Approve permissions

**Updates:** installs made from v2.4.0 or later update automatically – Firefox checks
`https://mheci.github.io/Ephemeral/updates.json`, which points at each release's signed XPI on GitHub
(hash-verified before install). Ephemeral is unlisted on AMO, so Mozilla does not deliver updates.
Installs of older versions must reinstall once from a v2.4.0+ signed XPI to move onto the auto-update track.

## Use

**Keyboard (fastest, invisible):**

- `Ctrl+Alt+E` / `MacCtrl+Shift+E` – New ephemeral tab (auto-cleans)
- `Ctrl+Alt+U` / `MacCtrl+Shift+U` – New ephemeral space (stays open for many tabs)
- New ephemeral window (dedicated window, cleans when closed) - bind one under Manage Extension Shortcuts
- `Ctrl+Shift+Period` – Open popup

Change shortcuts: Add-ons Manager → Gear → Manage Extension Shortcuts

**Mouse:**

- Toolbar button → New ephemeral tab / space / window
- Right-click link → Open link in new ephemeral tab / window
- Right-click page → Open this page in new ephemeral tab / window

**Cleanup triggers:** Last tab closed, window closed, browser restart, inactivity timeout, manual Clean button, panic wipe, or context menu.

**Undo close:** optionally set an "undo-close grace" per policy (0–600 seconds). After the last tab closes, cleanup waits – the popup and dashboard show a live countdown – and reopening the tab (or `Ctrl+Shift+T`) cancels the cleanup.

**Panic clean:** one toolbar button or assignable hotkey arms a wipe of every active session after a short undo window (default 10 s, configurable 0–600 s). A live "wipes in Ns" countdown shows everywhere; pressing _Cancel wipe_ is the only way back. Tab activity does not rescue an armed panic wipe – only the explicit cancel does.

**Lifetime stats:** the dashboard shows local-only counters (sessions cleaned, tabs closed, data types erased) that never leave your device.

## What Gets Erased

| Data                                      | Result                                |
| ----------------------------------------- | ------------------------------------- |
| Cookies, IndexedDB, local/session storage | Removed for that container            |
| Cache Storage, Service Workers            | Removed for that container            |
| Tabs & container identity                 | Closed & removed                      |
| Download history                          | Optional, files stay on disk          |
| Browsing history                          | Optional global sweep, off by default |
| Extension state                           | Removed after cleanup                 |

Container-scoped removal works for cookies, IndexedDB, local/session storage, cache storage, and service workers – each attempted individually and reported honestly when Firefox rejects a type. Firefox does NOT allow container-scoped removal of history, HTTP cache, passwords, form data, permissions, HSTS/TLS state, DNS, or download history – we never delete global data as a silent substitute. If you opt in, the global history sweep erases the entire Firefox browsing history (including non-container sites) whenever a container is cleaned; the cleanup report always labels that step as global.

## Privacy

- No host permissions, no content scripts, no network, no telemetry
- Only stores settings, container records, bounded cleanup reports locally
- No URLs, cookies, or page content stored

## Efficiency

- Event-driven, non-persistent background – no polling
- Tab ownership cached + persisted to session storage (500 entries max, debounced)
- Reverse index for O(1) cleanup, sequential tab queries to avoid bursts
- Badge updates cached + served from primitive state summaries (no full-state clones per event)
- Per-tab-event container lookup reads an in-memory index instead of cloning persisted state
- Logs silent/throttled, locks bounded (200 keys) with timeout
- Hotkeys & context menus debounced 350ms to avoid spam

## Development

```sh
npm ci
npm run check   # format, lint, typecheck, secrets, test, build verify
npm run build
npm run package # artifacts/*.zip
```

## Contributing

Source lives in `src/`. Report bugs or request features on [Issues](https://github.com/mheci/Ephemeral/issues).

## License

[MPL-2.0](LICENSE)

<p align="center"><img src="docs/assets/logo.svg" alt="Ephemeral" width="460"></p>

# Ephemeral

**Private tabs that clean themselves.** One hotkey, zero traces.

Ephemeral creates temporary Firefox containers – isolated spaces for browsing. When you close the last tab, everything inside that container is erased automatically. No history, no cookies, no leftover data. It feels like normal browsing, but completely private.

## For Novices

**What it does:** Gives you disposable tabs. Each tab lives alone, can't see your other tabs, and self-destructs when closed.

**How it functions:** 
1. Press `Ctrl+Shift+E` → new isolated tab opens
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

## Use

**Keyboard (fastest, invisible):**
- `Ctrl+Shift+E` / `MacCtrl+Shift+E` – New ephemeral tab (auto-cleans)
- `Ctrl+Shift+U` – New ephemeral space (stays open for many tabs)
- `Ctrl+Shift+Period` – Open popup

Change shortcuts: Add-ons Manager → Gear → Manage Extension Shortcuts

**Mouse:**
- Toolbar button → New ephemeral tab / space
- Right-click link → Open link in new ephemeral tab
- Right-click page → Open this page in new ephemeral tab

**Cleanup triggers:** Last tab closed, browser restart, inactivity timeout, manual Clean button, or context menu.

## What Gets Erased

| Data | Result |
|------|--------|
| Cookies, IndexedDB, local/session storage | Removed for that container |
| Cache Storage, Service Workers | Removed (new) |
| Tabs & container identity | Closed & removed |
| Download history | Optional, files stay on disk |
| Extension state | Removed after cleanup |

Firefox does NOT allow container-scoped removal of history, HTTP cache, passwords, permissions – we never delete global data as substitute.

## Privacy

- No host permissions, no content scripts, no network, no telemetry
- Only stores settings, container records, bounded cleanup reports locally
- No URLs, cookies, or page content stored

See [Privacy](docs/privacy.md) and [Security](SECURITY.md).

## Efficiency

- Event-driven, non-persistent background – no polling
- Tab ownership cached + persisted to session storage (500 entries max, debounced)
- Reverse index for O(1) cleanup, sequential tab queries to avoid bursts
- Badge updates cached, logs silent/throttled, locks bounded (200 keys) with timeout
- Hotkeys & context menus debounced 350ms to avoid spam

## Development

```sh
npm ci
npm run check   # format, lint, typecheck, secrets, test, build verify
npm run build
npm run package # artifacts/*.zip
```

## Docs

- [Technical](docs/technical.md) – architecture & resource use
- [Privacy](docs/privacy.md)
- [Release](docs/release.md)

## License

[MPL-2.0](LICENSE)

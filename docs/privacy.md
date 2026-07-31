# Privacy

Ephemeral collects zero data. Firefox data_collection_permissions = none.

## Stored Locally (required only)

- Settings, lifecycle policies
- Active container IDs, creation/cleanup recovery state
- Timestamps, status, bounded errors
- Bounded cleanup history (50 default, 0-500, clearable)
- Tab ownership cache (session storage, 500 max, debounced)
- Onboarding completed flag

## Never Stored

- URLs, titles, cookie values, storage contents, page content, search terms, download names, account info

Start page stored because it's a setting.

## Retention

Active records removed after cleanup. Failed remain until success or removal. History bounded and clearable. Tab ownership session-only.

## Network

Extension pages: `connect-src 'none'` – cannot make outbound connections. No server, telemetry, analytics, ads, sync, diagnostics.

Websites you open make normal Firefox requests – not sent to extension.

## Exports

Settings/diagnostics created locally, nothing uploaded. Review before sharing – custom names or Firefox errors may be personal.

## Downloads Permission

Optional. Only erases download-history entries filtered by container ID. Never deletes files.

## Uninstall

Clean all first. Firefox has no reliable uninstall event for async cleanup.

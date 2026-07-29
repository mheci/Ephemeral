# Privacy

Ephemeral does not collect or transmit data. Firefox is told explicitly that the extension collects no data.

## Data stored locally

Ephemeral stores only what is required to manage temporary sessions:

- settings and lifecycle policies;
- active managed-container identifiers;
- creation and cleanup recovery state;
- timestamps, status, and bounded error messages;
- a bounded cleanup history.

Ephemeral does not store:

- visited URLs or page titles;
- cookie values;
- local-storage or IndexedDB contents;
- page content or search terms;
- download names;
- account or identity information.

The configured start page is stored because it is a user setting.

## Retention

Active records are removed after cleanup. Cleanup history keeps 50 entries by default, can be set from 0 to 500, and can be cleared at any time. Failed records remain visible until cleanup succeeds or the container is removed.

## Network activity

Extension pages cannot make outbound connections. Ephemeral has no server, account, telemetry, analytics, advertising, synchronization service, or remote diagnostics.

Websites opened by the user make their normal network requests through Firefox. Those requests are not sent to Ephemeral or its maintainers.

## Exports

Settings and diagnostics exports are created locally. Nothing is uploaded. Users should review diagnostic files before sharing them because custom names or Firefox error messages may be personally meaningful.

## Optional download permission

When enabled, Ephemeral uses the download permission only to erase Firefox download-history entries filtered by the temporary container ID. It never deletes downloaded files.

## Uninstalling

Use **Clean all** before uninstalling. Firefox does not provide a reliable extension-uninstall event that can complete asynchronous container cleanup.

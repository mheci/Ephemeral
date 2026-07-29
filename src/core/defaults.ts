import type { PersistedState, Settings } from "./types";
import { STATE_SCHEMA_VERSION } from "./types";

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  schemaVersion: STATE_SCHEMA_VERSION,
  containerNamePrefix: "Ephemeral",
  startUrl: "about:blank",
  oneTimePolicy: Object.freeze({
    destroyOnLastTabClose: true,
    destroyOnBrowserRestart: true,
    inactivity: Object.freeze({ enabled: false, minutes: 30 }),
  }),
  reusablePolicy: Object.freeze({
    destroyOnLastTabClose: false,
    destroyOnBrowserRestart: true,
    inactivity: Object.freeze({ enabled: true, minutes: 30 }),
  }),
  cleanup: Object.freeze({ eraseDownloadMetadata: false }),
  retry: Object.freeze({
    maxAttempts: 5,
    delaysMinutes: Object.freeze([1, 5, 15, 60, 240]) as unknown as number[],
  }),
  cleanupHistoryLimit: 50,
});

export function createDefaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

export function createInitialState(): PersistedState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    revision: 0,
    settings: createDefaultSettings(),
    containers: {},
    creationIntents: {},
    cleanupHistory: [],
  };
}

export const API_LIMITATIONS = Object.freeze([
  "Firefox exposes no container-scoped API for browsing history; Ephemeral never deletes global history.",
  "HTTP cache, Cache Storage, and service-worker registrations cannot be safely targeted by cookieStoreId.",
  "Saved passwords, form history, site permissions, HSTS, TLS state, DNS state, and physical download files are not container-scoped WebExtension data.",
  "A WebExtension cannot guarantee work during Firefox shutdown; browser-exit cleanup runs on the next Firefox startup.",
  "Firefox acknowledges IndexedDB/local-storage removal but does not expose a byte-level verification API.",
  "Removing an extension does not provide a reliable uninstall cleanup event; clean all containers before uninstalling.",
]);

export const STATE_SCHEMA_VERSION = 1 as const;
export const SETTINGS_EXPORT_VERSION = 1 as const;

export type ContainerKind = "one-time" | "reusable";
export type CleanupTrigger =
  | "last-tab-closed"
  | "grace-expired"
  | "browser-startup"
  | "inactivity"
  | "manual"
  | "manual-all"
  | "panic-expired"
  | "recovery"
  | "external-removal";
export type ContainerStatus = "active" | "pending" | "cleaning" | "failed";
export type CleanupOutcome =
  | "completed"
  | "completed-with-limitations"
  | "failed"
  | "cancelled";
export type StepOutcome = "succeeded" | "skipped" | "limited" | "failed";

export type InactivityPolicy = {
  enabled: boolean;
  minutes: number;
};

export type LifecyclePolicy = {
  destroyOnLastTabClose: boolean;
  /** Seconds of "undo close" grace before last-tab cleanup; 0 = clean immediately. */
  graceSeconds: number;
  destroyOnBrowserRestart: boolean;
  inactivity: InactivityPolicy;
};

export type CleanupPolicy = {
  eraseDownloadMetadata: boolean;
  /** Opt-in: erase the ENTIRE Firefox browsing history on every container cleanup.
   * Firefox has no container-scoped history API, so this is global, never scoped. */
  sweepGlobalHistory: boolean;
};

export type RetryPolicy = {
  maxAttempts: number;
  delaysMinutes: number[];
};

export type Settings = {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  containerNamePrefix: string;
  startUrl: string;
  oneTimePolicy: LifecyclePolicy;
  reusablePolicy: LifecyclePolicy;
  cleanup: CleanupPolicy;
  retry: RetryPolicy;
  cleanupHistoryLimit: number;
  /** Undo window (seconds) for the panic wipe before every active container force-cleans. */
  panicGraceSeconds: number;
};

export type ContainerRecord = {
  id: string;
  operationToken: string;
  cookieStoreId: string;
  name: string;
  kind: ContainerKind;
  color: string;
  icon: string;
  createdAt: number;
  lastActivityAt: number;
  createdBrowserSessionId: string;
  policy: LifecyclePolicy;
  status: ContainerStatus;
  /** Deadline until which cleanup is deferred after the last tab closed (drain grace). */
  drainDeadline?: number;
  /** Deadline at which a panic wipe force-cleans this container regardless of open tabs. */
  panicDeadline?: number;
  pendingTrigger?: CleanupTrigger;
  cleanupAttempts: number;
  lastError?: string;
};

export type CreationIntent = {
  id: string;
  operationToken: string;
  expectedName: string;
  kind: ContainerKind;
  createdAt: number;
  browserSessionId: string;
  policy: LifecyclePolicy;
};

export type CleanupStep = {
  name:
    | "close-tabs"
    | "scoped-site-data"
    | "download-metadata"
    | "history-sweep"
    | "remove-identity"
    | "extension-state"
    | "verification"
    | "cleanup";
  outcome: StepOutcome;
  durationMs: number;
  detail: string;
  affectedItems?: number;
};

export type CleanupHistoryEntry = {
  id: string;
  containerId: string;
  containerName: string;
  trigger: CleanupTrigger;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  outcome: CleanupOutcome;
  attempt: number;
  steps: CleanupStep[];
  limitations: string[];
  error?: string;
};

/** Local-only lifetime counters. Never leaves the browser unless exported as diagnostics. */
export type LifetimeStats = {
  containersCreated: number;
  containersCleaned: number;
  cleanupsFailed: number;
  /** Sum of container-scoped data types Firefox acknowledged erasing. */
  dataTypesErased: number;
  /** Sum of container tabs closed by Ephemeral cleanups. */
  tabsClosed: number;
};

export type PersistedState = {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  revision: number;
  settings: Settings;
  containers: Record<string, ContainerRecord>;
  creationIntents: Record<string, CreationIntent>;
  cleanupHistory: CleanupHistoryEntry[];
  lifetimeStats: LifetimeStats;
};

export type ContainerView = ContainerRecord & {
  tabCount: number;
  expiresAt?: number;
};

export type HealthView = {
  level: "healthy" | "attention" | "degraded";
  summary: string;
  failedCleanups: number;
  pendingCleanups: number;
  activeContainers: number;
};

export type PublicState = {
  settings: Settings;
  containers: ContainerView[];
  cleanupHistory: CleanupHistoryEntry[];
  health: HealthView;
  lifetimeStats: LifetimeStats;
  capabilities: {
    downloadsPermission: boolean;
    supportedColors: string[];
    supportedIcons: string[];
  };
};

export type SettingsExport = {
  format: "ephemeral-settings";
  version: typeof SETTINGS_EXPORT_VERSION;
  exportedAt: string;
  settings: Settings;
};

export type DiagnosticsExport = {
  format: "ephemeral-diagnostics";
  version: 1;
  generatedAt: string;
  extensionVersion: string;
  firefoxVersion?: string;
  stateRevision: number;
  health: HealthView;
  containers: Array<{
    id: string;
    kind: ContainerKind;
    status: ContainerStatus;
    tabCount: number;
    ageMs: number;
    cleanupAttempts: number;
    policy: LifecyclePolicy;
    lastError?: string;
  }>;
  cleanupHistory: CleanupHistoryEntry[];
  lifetimeStats: LifetimeStats;
  apiLimitations: string[];
};

export type RequestMessage =
  | { type: "GET_STATE" }
  | { type: "CREATE_CONTAINER"; kind: ContainerKind; openTab: boolean }
  | { type: "CREATE_WINDOW"; kind: ContainerKind; url?: string }
  | { type: "OPEN_TAB"; containerId: string }
  | { type: "CLEANUP_CONTAINER"; containerId: string }
  | { type: "CLEANUP_ALL" }
  | { type: "PANIC_CLEAN" }
  | { type: "CANCEL_PANIC_CLEAN" }
  | { type: "UPDATE_SETTINGS"; settings: unknown }
  | { type: "UPDATE_CONTAINER_POLICY"; containerId: string; policy: unknown }
  | { type: "IMPORT_SETTINGS"; text: string }
  | { type: "EXPORT_SETTINGS" }
  | { type: "EXPORT_DIAGNOSTICS" }
  | { type: "CLEAR_HISTORY" }
  | { type: "REQUEST_DOWNLOADS_PERMISSION" }
  | { type: "REMOVE_DOWNLOADS_PERMISSION" };

export type ResponseMessage =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; code: string };

import { createInitialState } from "../core/defaults";
import { errorMessage } from "../core/errors";
import type {
  CleanupHistoryEntry,
  ContainerRecord,
  CreationIntent,
  PersistedState,
} from "../core/types";
import { STATE_SCHEMA_VERSION } from "../core/types";
import { validateLifecyclePolicy, validateSettings } from "../core/validation";
import type { BrowserAdapter } from "./browser-adapter";

type Mutator<T> = (draft: PersistedState) => T | Promise<T>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRecord(value: unknown): value is ContainerRecord {
  if (!isObject(value)) return false;
  const requiredStrings = [
    "id",
    "operationToken",
    "cookieStoreId",
    "name",
    "kind",
    "color",
    "icon",
    "createdBrowserSessionId",
    "status",
  ];
  if (requiredStrings.some((key) => typeof value[key] !== "string")) return false;
  if (
    !["one-time", "reusable"].includes(value["kind"] as string) ||
    !["active", "pending", "cleaning", "failed"].includes(value["status"] as string)
  ) {
    return false;
  }
  if (
    !Number.isFinite(value["createdAt"]) ||
    !Number.isFinite(value["lastActivityAt"]) ||
    !Number.isInteger(value["cleanupAttempts"])
  ) {
    return false;
  }
  try {
    validateLifecyclePolicy(value["policy"]);
    return true;
  } catch {
    return false;
  }
}

function validIntent(value: unknown): value is CreationIntent {
  if (!isObject(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["operationToken"] === "string" &&
    typeof value["expectedName"] === "string" &&
    (value["kind"] === "one-time" || value["kind"] === "reusable") &&
    Number.isFinite(value["createdAt"]) &&
    typeof value["browserSessionId"] === "string"
  );
}

function validHistory(value: unknown): value is CleanupHistoryEntry {
  if (!isObject(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["containerId"] === "string" &&
    typeof value["containerName"] === "string" &&
    Number.isFinite(value["startedAt"]) &&
    Number.isFinite(value["finishedAt"]) &&
    Array.isArray(value["steps"]) &&
    Array.isArray(value["limitations"])
  );
}

function recoverState(value: unknown): { state: PersistedState; repaired: boolean } {
  if (value === undefined) return { state: createInitialState(), repaired: true };
  if (!isObject(value)) throw new Error("Persisted state root is not an object");
  const state = createInitialState();
  let repaired = false;
  if (value["schemaVersion"] !== STATE_SCHEMA_VERSION) {
    // Unknown schema (older or newer release). Never brick the extension over
    // it: reset settings and history, but salvage any ownership records that
    // are still parseable so managed identities remain tracked and can still
    // be cleaned up, then resave under the current schema.
    repaired = true;
  } else {
    if (Number.isInteger(value["revision"]))
      state.revision = value["revision"] as number;
    else repaired = true;

    try {
      state.settings = validateSettings(value["settings"]);
    } catch {
      // Settings corruption must not hide managed identities. Defaults are safe to
      // restore while valid ownership records below remain available for cleanup.
      repaired = true;
    }
  }

  if (isObject(value["containers"])) {
    for (const [id, record] of Object.entries(value["containers"])) {
      if (validRecord(record) && record.id === id)
        state.containers[id] = structuredClone(record);
      else repaired = true;
    }
  } else if (value["containers"] !== undefined) repaired = true;

  if (isObject(value["creationIntents"])) {
    for (const [id, intent] of Object.entries(value["creationIntents"])) {
      if (validIntent(intent) && intent.id === id) {
        try {
          validateLifecyclePolicy(intent.policy);
          state.creationIntents[id] = structuredClone(intent);
        } catch {
          repaired = true;
        }
      } else repaired = true;
    }
  } else if (value["creationIntents"] !== undefined) repaired = true;

  if (Array.isArray(value["cleanupHistory"])) {
    const valid = value["cleanupHistory"].filter(validHistory);
    state.cleanupHistory = valid
      .slice(0, state.settings.cleanupHistoryLimit)
      .map((entry) => structuredClone(entry));
    if (
      valid.length !== value["cleanupHistory"].length ||
      valid.length !== state.cleanupHistory.length
    ) {
      repaired = true;
    }
  } else if (value["cleanupHistory"] !== undefined) repaired = true;

  return { state, repaired };
}
export class StateRepository {
  private state: PersistedState | undefined;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly adapter: BrowserAdapter) {}

  public async initialize(): Promise<PersistedState> {
    if (this.state) return structuredClone(this.state);
    const raw = await this.adapter.loadState();
    let repaired = false;
    try {
      const recovered = recoverState(raw);
      this.state = recovered.state;
      repaired = recovered.repaired;
    } catch (error) {
      throw new Error(`Stored Ephemeral state is invalid: ${errorMessage(error)}`, {
        cause: error,
      });
    }
    if (repaired) await this.adapter.saveState(this.state);
    return structuredClone(this.state);
  }

  public async snapshot(): Promise<PersistedState> {
    await this.initialize();
    await this.queue;
    return structuredClone(this.requireState());
  }

  public async transaction<T>(mutator: Mutator<T>): Promise<T> {
    await this.initialize();
    let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined;
    let rejectResult: (reason?: unknown) => void = () => undefined;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        const draft = structuredClone(this.requireState());
        try {
          const value = await mutator(draft);
          draft.revision += 1;
          draft.cleanupHistory = draft.cleanupHistory.slice(
            0,
            draft.settings.cleanupHistoryLimit,
          );
          await this.adapter.saveState(draft);
          this.state = draft;
          resolveResult(value);
        } catch (error) {
          rejectResult(error);
        }
      });
    return result;
  }

  private requireState(): PersistedState {
    if (!this.state) throw new Error("StateRepository has not been initialized");
    return this.state;
  }
}

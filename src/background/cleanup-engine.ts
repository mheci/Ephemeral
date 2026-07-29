import { API_LIMITATIONS } from "../core/defaults";
import { EphemeralError, errorMessage, isNotFoundError } from "../core/errors";
import { randomId } from "../core/ids";
import type {
  CleanupHistoryEntry,
  CleanupOutcome,
  CleanupStep,
  CleanupTrigger,
  ContainerRecord,
} from "../core/types";
import type { BrowserAdapter } from "./browser-adapter";
import { KeyedLock } from "./keyed-lock";
import type { Logger } from "./logger";
import type { Scheduler } from "./scheduler";
import type { StateRepository } from "./state-repository";

const SCOPED_LIMITATIONS = [
  API_LIMITATIONS[0] ?? "Container-scoped browsing history removal is unavailable.",
  API_LIMITATIONS[1] ??
    "Container-scoped cache and service-worker removal is unavailable.",
  API_LIMITATIONS[4] ?? "Site-storage removal cannot be byte-verified.",
];

function step(
  name: CleanupStep["name"],
  outcome: CleanupStep["outcome"],
  startedAt: number,
  detail: string,
  now: () => number,
  affectedItems?: number,
): CleanupStep {
  return {
    name,
    outcome,
    durationMs: Math.max(0, now() - startedAt),
    detail,
    ...(affectedItems === undefined ? {} : { affectedItems }),
  };
}

export class CleanupEngine {
  private readonly lock = new KeyedLock();
  private readonly removingStores = new Set<string>();

  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly repository: StateRepository,
    private readonly scheduler: Scheduler,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  public async request(
    containerId: string,
    trigger: CleanupTrigger,
  ): Promise<CleanupHistoryEntry | undefined> {
    return this.lock.run(containerId, async () => {
      const state = await this.repository.snapshot();
      const initial = state.containers[containerId];
      if (!initial) return undefined;

      if (trigger === "last-tab-closed") {
        const tabs = await this.adapter.queryTabs(initial.cookieStoreId);
        if (tabs.length > 0) {
          await this.restoreActive(initial.id);
          return undefined;
        }
      }

      await this.repository.transaction((draft) => {
        const record = draft.containers[containerId];
        if (!record) return;
        record.status = "pending";
        record.pendingTrigger = trigger;
      });
      await this.scheduler.armRecovery();
      return this.execute(containerId, trigger);
    });
  }

  private async execute(
    containerId: string,
    trigger: CleanupTrigger,
  ): Promise<CleanupHistoryEntry | undefined> {
    const state = await this.repository.snapshot();
    const record = state.containers[containerId];
    if (!record) return undefined;
    const startedAt = this.now();
    const steps: CleanupStep[] = [];
    const limitations = [...SCOPED_LIMITATIONS];
    const attempt = record.cleanupAttempts + 1;

    await this.repository.transaction((draft) => {
      const current = draft.containers[containerId];
      if (!current) return;
      current.status = "cleaning";
      current.pendingTrigger = trigger;
      current.cleanupAttempts = attempt;
      delete current.lastError;
    });

    try {
      const identity = await this.adapter.getIdentity(record.cookieStoreId);
      if (!identity) {
        limitations.push(
          "The container identity was already absent, so scoped data removal could not be re-run.",
        );
        return await this.finishMissingIdentity(
          record,
          trigger,
          startedAt,
          attempt,
          steps,
          limitations,
        );
      }

      let phaseStarted = this.now();
      const tabs = await this.adapter.queryTabs(record.cookieStoreId);
      if (trigger === "last-tab-closed" && tabs.length > 0) {
        steps.push(
          step(
            "close-tabs",
            "skipped",
            phaseStarted,
            "A new tab opened before cleanup; cleanup was cancelled.",
            this.now,
          ),
        );
        await this.restoreActive(record.id);
        return await this.recordCancelled(
          record,
          trigger,
          startedAt,
          attempt,
          steps,
          limitations,
        );
      }
      await this.adapter.closeTabs(tabs.map((tab) => tab.id));
      const remainingTabs = await this.adapter.queryTabs(record.cookieStoreId);
      if (remainingTabs.length > 0) {
        throw new EphemeralError(
          "Firefox did not close every container tab",
          "TABS_REMAIN",
        );
      }
      steps.push(
        step(
          "close-tabs",
          "succeeded",
          phaseStarted,
          `Closed ${tabs.length} tab${tabs.length === 1 ? "" : "s"}.`,
          this.now,
          tabs.length,
        ),
      );

      phaseStarted = this.now();
      await this.adapter.removeScopedSiteData(record.cookieStoreId);
      steps.push(
        step(
          "scoped-site-data",
          "succeeded",
          phaseStarted,
          "Firefox acknowledged removal of cookies, IndexedDB, local storage, and session storage for this cookie store.",
          this.now,
        ),
      );

      phaseStarted = this.now();
      if (!state.settings.cleanup.eraseDownloadMetadata) {
        steps.push(
          step(
            "download-metadata",
            "skipped",
            phaseStarted,
            "Container-scoped download-history cleanup is disabled.",
            this.now,
          ),
        );
      } else if (!(await this.adapter.hasDownloadsPermission())) {
        const detail =
          "The optional downloads permission is not granted; download metadata was not erased.";
        steps.push(
          step("download-metadata", "limited", phaseStarted, detail, this.now),
        );
        limitations.push(detail);
      } else {
        const result = await this.adapter.eraseDownloadMetadata(record.cookieStoreId);
        if (result.remaining !== 0) {
          throw new EphemeralError(
            "Download metadata remained after erase",
            "DOWNLOADS_REMAIN",
          );
        }
        steps.push(
          step(
            "download-metadata",
            "succeeded",
            phaseStarted,
            `Erased ${result.erasedIds.length} container-scoped download-history entr${
              result.erasedIds.length === 1 ? "y" : "ies"
            }; downloaded files were not deleted.`,
            this.now,
            result.erasedIds.length,
          ),
        );
      }

      phaseStarted = this.now();
      this.removingStores.add(record.cookieStoreId);
      try {
        await this.adapter.removeIdentity(record.cookieStoreId);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      } finally {
        this.removingStores.delete(record.cookieStoreId);
      }
      steps.push(
        step(
          "remove-identity",
          "succeeded",
          phaseStarted,
          "Firefox removed the contextual identity.",
          this.now,
        ),
      );

      phaseStarted = this.now();
      const [remainingIdentity, tabsAfter] = await Promise.all([
        this.adapter.getIdentity(record.cookieStoreId),
        this.adapter.queryTabs(record.cookieStoreId),
      ]);
      if (remainingIdentity || tabsAfter.length > 0) {
        throw new EphemeralError(
          "Container identity or tabs remained after removal",
          "VERIFY_FAILED",
        );
      }
      steps.push(
        step(
          "verification",
          "succeeded",
          phaseStarted,
          "Verified that the contextual identity and its tabs no longer exist. Site-storage deletion is API-acknowledged, not byte-verifiable.",
          this.now,
        ),
      );

      return await this.finish(
        record,
        trigger,
        startedAt,
        attempt,
        "completed-with-limitations",
        steps,
        limitations,
      );
    } catch (error) {
      return this.fail(record, trigger, startedAt, attempt, steps, limitations, error);
    }
  }

  public async handleExternalRemoval(cookieStoreId: string): Promise<void> {
    if (this.removingStores.has(cookieStoreId)) return;
    const state = await this.repository.snapshot();
    const record = Object.values(state.containers).find(
      (candidate) => candidate.cookieStoreId === cookieStoreId,
    );
    if (!record || record.status === "cleaning") return;
    const startedAt = this.now();
    const limitations = [
      ...SCOPED_LIMITATIONS,
      "The identity was removed outside Ephemeral; explicit scoped cleanup and verification could not run.",
    ];
    await this.finishMissingIdentity(
      record,
      "external-removal",
      startedAt,
      record.cleanupAttempts,
      [],
      limitations,
    );
  }

  public isRemoving(cookieStoreId: string): boolean {
    return this.removingStores.has(cookieStoreId);
  }

  private async finishMissingIdentity(
    record: ContainerRecord,
    trigger: CleanupTrigger,
    startedAt: number,
    attempt: number,
    steps: CleanupStep[],
    limitations: string[],
  ): Promise<CleanupHistoryEntry> {
    const phaseStarted = this.now();
    const tabs = await this.adapter.queryTabs(record.cookieStoreId);
    if (tabs.length > 0) await this.adapter.closeTabs(tabs.map((tab) => tab.id));
    steps.push(
      step(
        "remove-identity",
        "limited",
        phaseStarted,
        "The contextual identity was already absent.",
        this.now,
      ),
    );
    return this.finish(
      record,
      trigger,
      startedAt,
      attempt,
      "completed-with-limitations",
      steps,
      limitations,
    );
  }

  private async restoreActive(containerId: string): Promise<void> {
    let record: ContainerRecord | undefined;
    await this.repository.transaction((draft) => {
      const current = draft.containers[containerId];
      if (!current) return;
      current.status = "active";
      delete current.pendingTrigger;
      delete current.lastError;
      record = structuredClone(current);
    });
    if (record) await this.scheduler.scheduleInactivity(record);
  }

  private async recordCancelled(
    record: ContainerRecord,
    trigger: CleanupTrigger,
    startedAt: number,
    attempt: number,
    steps: CleanupStep[],
    limitations: string[],
  ): Promise<CleanupHistoryEntry> {
    return this.appendHistory(
      record,
      trigger,
      startedAt,
      attempt,
      "cancelled",
      steps,
      limitations,
    );
  }

  private async finish(
    record: ContainerRecord,
    trigger: CleanupTrigger,
    startedAt: number,
    attempt: number,
    outcome: CleanupOutcome,
    steps: CleanupStep[],
    limitations: string[],
  ): Promise<CleanupHistoryEntry> {
    const extensionStarted = this.now();
    const entry = this.makeHistory(
      record,
      trigger,
      startedAt,
      attempt,
      outcome,
      steps,
      limitations,
    );
    entry.steps.push(
      step(
        "extension-state",
        "succeeded",
        extensionStarted,
        "Removed active extension state; retained only bounded cleanup history.",
        this.now,
      ),
    );
    entry.finishedAt = this.now();
    entry.durationMs = Math.max(0, entry.finishedAt - entry.startedAt);
    await this.repository.transaction((draft) => {
      delete draft.containers[record.id];
      draft.cleanupHistory.unshift(entry);
    });
    await this.scheduler.cancelForContainer(record.id);
    this.logger.info("Cleanup completed", { containerId: record.id, attempt, outcome });
    return entry;
  }

  private async appendHistory(
    record: ContainerRecord,
    trigger: CleanupTrigger,
    startedAt: number,
    attempt: number,
    outcome: CleanupOutcome,
    steps: CleanupStep[],
    limitations: string[],
    error?: string,
  ): Promise<CleanupHistoryEntry> {
    const entry = this.makeHistory(
      record,
      trigger,
      startedAt,
      attempt,
      outcome,
      steps,
      limitations,
      error,
    );
    await this.repository.transaction((draft) => {
      draft.cleanupHistory.unshift(entry);
    });
    return entry;
  }

  private makeHistory(
    record: ContainerRecord,
    trigger: CleanupTrigger,
    startedAt: number,
    attempt: number,
    outcome: CleanupOutcome,
    steps: CleanupStep[],
    limitations: string[],
    error?: string,
  ): CleanupHistoryEntry {
    const finishedAt = this.now();
    return {
      id: randomId("cleanup"),
      containerId: record.id,
      containerName: record.name,
      trigger,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      outcome,
      attempt,
      steps: structuredClone(steps),
      limitations: [...new Set(limitations)],
      ...(error === undefined ? {} : { error }),
    };
  }

  private async fail(
    record: ContainerRecord,
    trigger: CleanupTrigger,
    startedAt: number,
    attempt: number,
    steps: CleanupStep[],
    limitations: string[],
    error: unknown,
  ): Promise<CleanupHistoryEntry> {
    const message = errorMessage(error);
    steps.push(
      step(
        "verification",
        "failed",
        this.now(),
        `Cleanup stopped safely: ${message}`,
        this.now,
      ),
    );
    const entry = await this.appendHistory(
      record,
      trigger,
      startedAt,
      attempt,
      "failed",
      steps,
      limitations,
      message,
    );
    const state = await this.repository.snapshot();
    await this.repository.transaction((draft) => {
      const current = draft.containers[record.id];
      if (!current) return;
      current.status = "failed";
      current.cleanupAttempts = attempt;
      current.lastError = message;
      current.pendingTrigger = trigger;
    });
    const current = (await this.repository.snapshot()).containers[record.id];
    if (current && attempt < state.settings.retry.maxAttempts) {
      await this.scheduler.scheduleRetry(current, state.settings);
    }
    this.logger.error("Cleanup failed", error);
    return entry;
  }
}

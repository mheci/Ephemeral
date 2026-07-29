import { API_LIMITATIONS } from "../core/defaults";
import { randomId } from "../core/ids";
import { inactivityDeadline, isInactive } from "../core/policy";
import type {
  CleanupHistoryEntry,
  ContainerView,
  DiagnosticsExport,
  HealthView,
  PublicState,
} from "../core/types";
import {
  createSettingsExport,
  parseSettingsExport,
  validateSettings,
} from "../core/validation";
import type { BrowserAdapter, BrowserTab } from "./browser-adapter";
import { CleanupEngine } from "./cleanup-engine";
import { ContainerManager } from "./container-manager";
import { KeyedLock } from "./keyed-lock";
import { Logger } from "./logger";
import { Scheduler } from "./scheduler";
import { StateRepository } from "./state-repository";

export class Controller {
  private readonly repository: StateRepository;
  private readonly scheduler: Scheduler;
  private readonly manager: ContainerManager;
  private readonly cleanup: CleanupEngine;
  private readonly logger = new Logger();
  private readonly lifecycleLock = new KeyedLock();
  /** Hot-path hint only; correctness falls back to a bounded managed-container scan. */
  private readonly tabOwners = new Map<number, string>();
  private ready: Promise<void> | undefined;
  private browserSessionId = "";

  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly now: () => number = Date.now,
  ) {
    this.repository = new StateRepository(adapter);
    this.scheduler = new Scheduler(adapter, now);
    this.manager = new ContainerManager(adapter, this.repository, this.scheduler, now);
    this.cleanup = new CleanupEngine(
      adapter,
      this.repository,
      this.scheduler,
      this.logger,
      now,
    );
  }

  public initialize(): Promise<void> {
    if (!this.ready) {
      const attempt = this.initializeOnce();
      this.ready = attempt.catch((error: unknown) => {
        // A transient Firefox API/storage failure must not poison the event page
        // forever. The next event or explicit dashboard retry gets a fresh attempt.
        this.ready = undefined;
        throw error;
      });
    }
    return this.ready;
  }

  private async initializeOnce(): Promise<void> {
    await this.repository.initialize();
    this.browserSessionId =
      (await this.adapter.getBrowserSessionId()) ?? randomId("session");
    await this.adapter.setBrowserSessionId(this.browserSessionId);
    await this.manager.getCapabilities();
    await this.manager.recoverCreationIntents();
    await this.recoverLifecycle();
    await this.updateBadge();
  }

  private async recoverLifecycle(): Promise<void> {
    const state = await this.repository.snapshot();
    const identities = new Set(
      (await this.adapter.queryIdentities()).map((identity) => identity.cookieStoreId),
    );
    let needsRecoveryAlarm = false;
    for (const record of Object.values(state.containers)) {
      if (!identities.has(record.cookieStoreId)) {
        await this.cleanup.request(record.id, "recovery");
      } else if (record.status === "pending" || record.status === "cleaning") {
        needsRecoveryAlarm = true;
        await this.cleanup.request(record.id, "recovery");
      } else if (
        record.status === "failed" &&
        record.cleanupAttempts < state.settings.retry.maxAttempts
      ) {
        await this.scheduler.scheduleRetry(record, state.settings);
      } else if (record.status === "active") {
        await this.scheduler.scheduleInactivity(record);
      }
    }
    if (needsRecoveryAlarm) await this.scheduler.armRecovery();
    else await this.scheduler.cancelRecovery();
  }

  public async onBrowserStartup(): Promise<void> {
    await this.initialize();
    const state = await this.repository.snapshot();
    for (const record of Object.values(state.containers)) {
      if (
        record.policy.destroyOnBrowserRestart &&
        record.createdBrowserSessionId !== this.browserSessionId
      ) {
        await this.cleanup.request(record.id, "browser-startup");
      }
    }
    await this.updateBadge();
  }

  public async onTabActivity(tab: BrowserTab): Promise<void> {
    await this.initialize();
    if (!tab.cookieStoreId) return;
    const containerId = await this.manager.touchByCookieStore(tab.cookieStoreId);
    if (containerId) this.tabOwners.set(tab.id, containerId);
  }

  public async onTabActivated(tabId: number): Promise<void> {
    await this.initialize();
    const tab = await this.adapter.getTab(tabId);
    if (tab) await this.onTabActivity(tab);
  }

  public async onTabRemoved(tabId: number): Promise<void> {
    await this.initialize();
    const knownContainerId = this.tabOwners.get(tabId);
    this.tabOwners.delete(tabId);
    await this.lifecycleLock.run("last-tab-scan", async () => {
      const state = await this.repository.snapshot();
      if (knownContainerId) {
        const record = state.containers[knownContainerId];
        if (record?.status === "active" && record.policy.destroyOnLastTabClose) {
          const tabs = await this.adapter.queryTabs(record.cookieStoreId);
          if (tabs.length === 0)
            await this.cleanup.request(record.id, "last-tab-closed");
        }
        return;
      }

      // A non-persistent event page can wake after Firefox has already removed
      // the tab, leaving no supported API to recover its cookieStoreId. Scan
      // only last-tab-enabled managed records in this cold-start case.
      for (const record of Object.values(state.containers)) {
        if (record.status !== "active" || !record.policy.destroyOnLastTabClose)
          continue;
        const tabs = await this.adapter.queryTabs(record.cookieStoreId);
        if (tabs.length === 0) await this.cleanup.request(record.id, "last-tab-closed");
      }
    });
    await this.updateBadge();
  }

  public async onAlarm(name: string): Promise<void> {
    await this.initialize();
    const parsed = this.scheduler.parse(name);
    if (parsed.kind === "unknown") return;
    if (parsed.kind === "recovery") {
      await this.recoverLifecycle();
      await this.updateBadge();
      return;
    }
    const state = await this.repository.snapshot();
    const record = state.containers[parsed.containerId];
    if (!record) {
      await this.scheduler.cancelForContainer(parsed.containerId);
      return;
    }
    if (parsed.kind === "inactivity") {
      if (
        record.status === "active" &&
        isInactive(this.now(), record.lastActivityAt, record.policy)
      ) {
        await this.cleanup.request(record.id, "inactivity");
      } else {
        await this.scheduler.scheduleInactivity(record);
      }
    } else if (parsed.kind === "retry" && record.status !== "active") {
      await this.cleanup.request(record.id, "recovery");
    }
    await this.updateBadge();
  }

  public async onIdentityRemoved(cookieStoreId: string): Promise<void> {
    await this.initialize();
    const record = await this.manager.managedRecordForStore(cookieStoreId);
    await this.cleanup.handleExternalRemoval(cookieStoreId);
    if (record) this.forgetContainerTabs(record.id);
    await this.updateBadge();
  }

  public async createContainer(
    kind: "one-time" | "reusable",
    openTab: boolean,
  ): Promise<void> {
    await this.initialize();
    await this.lifecycleLock.run("create", async () => {
      await this.manager.create(kind, this.browserSessionId, openTab);
    });
    await this.updateBadge();
  }

  public async openTab(containerId: string): Promise<void> {
    await this.initialize();
    const tabId = await this.manager.openTab(containerId);
    this.tabOwners.set(tabId, containerId);
  }

  public async cleanupContainer(
    containerId: string,
  ): Promise<CleanupHistoryEntry | undefined> {
    await this.initialize();
    const result = await this.cleanup.request(containerId, "manual");
    this.forgetContainerTabs(containerId);
    await this.updateBadge();
    return result;
  }

  public async cleanupAll(): Promise<void> {
    await this.initialize();
    const state = await this.repository.snapshot();
    for (const record of Object.values(state.containers)) {
      await this.cleanup.request(record.id, "manual-all");
      this.forgetContainerTabs(record.id);
    }
    await this.updateBadge();
  }

  public async updateSettings(value: unknown): Promise<void> {
    await this.initialize();
    const settings = validateSettings(value);
    await this.repository.transaction((draft) => {
      draft.settings = settings;
    });
    await this.updateBadge();
  }

  public async updateContainerPolicy(
    containerId: string,
    value: unknown,
  ): Promise<void> {
    await this.initialize();
    await this.manager.updatePolicy(containerId, value);
  }

  public async importSettings(text: string): Promise<void> {
    await this.updateSettings(parseSettingsExport(text));
  }

  public async exportSettings(): Promise<string> {
    await this.initialize();
    const state = await this.repository.snapshot();
    return JSON.stringify(createSettingsExport(state.settings, this.now()), null, 2);
  }

  public async clearHistory(): Promise<void> {
    await this.initialize();
    await this.repository.transaction((draft) => {
      draft.cleanupHistory = [];
    });
  }

  public async requestDownloadsPermission(): Promise<boolean> {
    await this.initialize();
    return this.adapter.requestDownloadsPermission();
  }

  public async removeDownloadsPermission(): Promise<boolean> {
    await this.initialize();
    return this.adapter.removeDownloadsPermission();
  }

  public async getPublicState(): Promise<PublicState> {
    await this.initialize();
    const state = await this.repository.snapshot();
    const containers: ContainerView[] = await Promise.all(
      Object.values(state.containers).map(async (record) => {
        let tabCount = 0;
        try {
          tabCount = (await this.adapter.queryTabs(record.cookieStoreId)).length;
        } catch (error) {
          // Dashboard visibility is diagnostic and must survive a transient tabs
          // query failure. Destructive cleanup paths continue to fail closed.
          this.logger.warn("Could not count tabs for dashboard", {
            containerId: record.id,
            error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
          });
        }
        const deadline = inactivityDeadline(record.lastActivityAt, record.policy);
        return {
          ...record,
          tabCount,
          ...(deadline === undefined ? {} : { expiresAt: deadline }),
        };
      }),
    );
    containers.sort((left, right) => left.createdAt - right.createdAt);
    const capabilities = await this.manager.getCapabilities();
    let downloadsPermission = false;
    try {
      downloadsPermission = await this.adapter.hasDownloadsPermission();
    } catch (error) {
      this.logger.warn("Could not read optional downloads permission", {
        error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      });
    }
    return {
      settings: state.settings,
      containers,
      cleanupHistory: state.cleanupHistory,
      health: this.health(containers),
      capabilities: {
        downloadsPermission,
        supportedColors: capabilities.supportedColors,
        supportedIcons: capabilities.supportedIcons,
      },
    };
  }

  public async exportDiagnostics(): Promise<string> {
    const publicState = await this.getPublicState();
    const state = await this.repository.snapshot();
    const diagnostics: DiagnosticsExport = {
      format: "ephemeral-diagnostics",
      version: 1,
      generatedAt: new Date(this.now()).toISOString(),
      extensionVersion: this.adapter.extensionVersion(),
      ...(await this.adapter
        .browserVersion()
        .then((version) => (version === undefined ? {} : { firefoxVersion: version }))),
      stateRevision: state.revision,
      health: publicState.health,
      containers: publicState.containers.map((record) => ({
        id: record.id,
        kind: record.kind,
        status: record.status,
        tabCount: record.tabCount,
        ageMs: Math.max(0, this.now() - record.createdAt),
        cleanupAttempts: record.cleanupAttempts,
        policy: record.policy,
        ...(record.lastError === undefined ? {} : { lastError: record.lastError }),
      })),
      cleanupHistory: publicState.cleanupHistory,
      apiLimitations: [...API_LIMITATIONS],
    };
    return JSON.stringify(diagnostics, null, 2);
  }

  private health(containers: ContainerView[]): HealthView {
    const failed = containers.filter((record) => record.status === "failed").length;
    const pending = containers.filter(
      (record) => record.status === "pending" || record.status === "cleaning",
    ).length;
    if (failed > 0) {
      return {
        level: "degraded",
        summary: `${failed} cleanup${failed === 1 ? " needs" : "s need"} attention`,
        failedCleanups: failed,
        pendingCleanups: pending,
        activeContainers: containers.length,
      };
    }
    if (pending > 0) {
      return {
        level: "attention",
        summary: `${pending} cleanup${pending === 1 ? " is" : "s are"} in progress`,
        failedCleanups: 0,
        pendingCleanups: pending,
        activeContainers: containers.length,
      };
    }
    return {
      level: "healthy",
      summary: containers.length === 0 ? "Ready" : `${containers.length} active`,
      failedCleanups: 0,
      pendingCleanups: 0,
      activeContainers: containers.length,
    };
  }

  private forgetContainerTabs(containerId: string): void {
    for (const [tabId, ownerId] of this.tabOwners) {
      if (ownerId === containerId) this.tabOwners.delete(tabId);
    }
  }

  private async updateBadge(): Promise<void> {
    try {
      const state = await this.repository.snapshot();
      const records = Object.values(state.containers);
      const failed = records.some((record) => record.status === "failed");
      const pending = records.some(
        (record) => record.status === "pending" || record.status === "cleaning",
      );
      if (failed) await this.adapter.setBadge("!", "#b42318");
      else if (pending) await this.adapter.setBadge("…", "#b54708");
      else if (records.length > 0)
        await this.adapter.setBadge(String(records.length), "#087f8c");
      else await this.adapter.setBadge("", "#087f8c");
    } catch (error) {
      // Toolbar decoration is best-effort and must never prevent lifecycle or UI
      // initialization from completing.
      this.logger.warn("Could not update toolbar badge", {
        error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      });
    }
  }
}

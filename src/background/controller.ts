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

/**
 * Resource-efficient tab ownership tracking.
 * We keep both forward (tabId -> containerId) and reverse (containerId -> Set<tabId>) maps
 * for O(1) cleanup, and persist to browser.storage.session to survive event page restarts
 * without needing a full scan of all managed containers (invisible to user).
 */
export class Controller {
  private readonly repository: StateRepository;
  private readonly scheduler: Scheduler;
  private readonly manager: ContainerManager;
  private readonly cleanup: CleanupEngine;
  private readonly logger = new Logger();
  private readonly lifecycleLock = new KeyedLock();
  /** Hot-path hint with reverse index for O(1) forget – persisted to session storage */
  private readonly tabOwners = new Map<number, string>();
  private readonly containerTabs = new Map<string, Set<number>>();
  private ready: Promise<void> | undefined;
  private browserSessionId = "";
  private pendingTabOwnersSave: number | undefined;

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
    await this.loadTabOwners();
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

  // --- Tab ownership persistence (invisible efficiency) ---

  private async loadTabOwners(): Promise<void> {
    try {
      const stored = (await browser.storage.session.get("tabOwners")) as Record<
        string,
        unknown
      >;
      const raw = stored["tabOwners"];
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "number" &&
          typeof entry[1] === "string"
        ) {
          const tabId = entry[0];
          const containerId = entry[1];
          this.tabOwners.set(tabId, containerId);
          const set = this.containerTabs.get(containerId) ?? new Set<number>();
          set.add(tabId);
          this.containerTabs.set(containerId, set);
        }
      }
    } catch {
      // Session storage may be unavailable – fallback to empty, will use bounded scan
      this.tabOwners.clear();
      this.containerTabs.clear();
    }
  }

  private scheduleTabOwnersSave(): void {
    if (this.pendingTabOwnersSave !== undefined) return;
    // Debounce save to avoid hammering storage on rapid tab events
    // Use globalThis for compatibility with both browser and Vitest Node env
    this.pendingTabOwnersSave = globalThis.setTimeout(() => {
      this.pendingTabOwnersSave = undefined;
      void this.saveTabOwners();
    }, 500);
  }

  private async saveTabOwners(): Promise<void> {
    try {
      const entries: Array<[number, string]> = [...this.tabOwners.entries()];
      // Bounded: only keep up to 500 most recent entries to avoid unbounded growth
      const bounded = entries.slice(-500);
      await browser.storage.session.set({ tabOwners: bounded });
    } catch {
      // Best-effort – if session storage fails, we still have in-memory map
    }
  }

  private trackTab(tabId: number, containerId: string): void {
    // Update forward map
    this.tabOwners.set(tabId, containerId);
    // Update reverse map
    const set = this.containerTabs.get(containerId) ?? new Set<number>();
    set.add(tabId);
    this.containerTabs.set(containerId, set);
    this.scheduleTabOwnersSave();
  }

  private untrackTab(tabId: number): string | undefined {
    const containerId = this.tabOwners.get(tabId);
    if (containerId === undefined) return undefined;
    this.tabOwners.delete(tabId);
    const set = this.containerTabs.get(containerId);
    if (set) {
      set.delete(tabId);
      if (set.size === 0) this.containerTabs.delete(containerId);
    }
    this.scheduleTabOwnersSave();
    return containerId;
  }

  // --- Event handlers ---

  public async onTabActivity(tab: BrowserTab): Promise<void> {
    await this.initialize();
    if (!tab.cookieStoreId) return;
    const containerId = await this.manager.touchByCookieStore(tab.cookieStoreId);
    if (containerId) this.trackTab(tab.id, containerId);
  }

  public async onTabActivated(tabId: number): Promise<void> {
    await this.initialize();
    const tab = await this.adapter.getTab(tabId);
    if (tab) await this.onTabActivity(tab);
  }

  public async onTabRemoved(tabId: number): Promise<void> {
    await this.initialize();
    const knownContainerId = this.untrackTab(tabId);
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

      // Cold-start fallback: event page woke after Firefox already removed
      // the tab, so we have no cookieStoreId. Only scan containers that
      // actually need last-tab cleanup (bounded, not all containers).
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

  public async createContainerWithUrl(
    kind: "one-time" | "reusable",
    url: string,
    openTab: boolean,
  ): Promise<void> {
    await this.initialize();
    // Validate URL to avoid opening dangerous schemes
    const sanitized = this.sanitizeUrl(url);
    await this.lifecycleLock.run("create", async () => {
      await this.manager.createWithUrl(kind, this.browserSessionId, sanitized, openTab);
    });
    await this.updateBadge();
  }

  public async createWindow(
    kind: "one-time" | "reusable",
    url?: string,
  ): Promise<void> {
    await this.initialize();
    const state = await this.repository.snapshot();
    const sanitized =
      url === undefined ? state.settings.startUrl : this.sanitizeUrl(url);
    let containerId = "";
    let tabId = -1;
    await this.lifecycleLock.run("create", async () => {
      const created = await this.manager.createWindow(
        kind,
        this.browserSessionId,
        sanitized,
      );
      containerId = created.containerId;
      tabId = created.tabId;
    });
    this.trackTab(tabId, containerId);
    await this.updateBadge();
  }

  public async openTab(containerId: string): Promise<void> {
    await this.initialize();
    const tabId = await this.manager.openTab(containerId);
    this.trackTab(tabId, containerId);
  }

  public async openTabWithUrl(containerId: string, url: string): Promise<void> {
    await this.initialize();
    const sanitized = this.sanitizeUrl(url);
    const tabId = await this.manager.openTabWithUrl(containerId, sanitized);
    this.trackTab(tabId, containerId);
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
    // Query tabs for each container – accurate count even if initial tab wasn't tracked via tabOwners
    // We run sequentially to avoid bursting Firefox with many parallel queries (resource efficient)
    const containers: ContainerView[] = [];
    for (const record of Object.values(state.containers)) {
      let tabCount = 0;
      try {
        tabCount = (await this.adapter.queryTabs(record.cookieStoreId)).length;
      } catch (error) {
        this.logger.warn("Could not count tabs for dashboard", {
          containerId: record.id,
          error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
        });
      }
      const deadline = inactivityDeadline(record.lastActivityAt, record.policy);
      containers.push({
        ...record,
        tabCount,
        ...(deadline === undefined ? {} : { expiresAt: deadline }),
      });
    }
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

  private sanitizeUrl(url: string): string {
    if (url === "about:blank" || url === "about:newtab") return url;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        // Strip credentials for safety
        if (parsed.username !== "" || parsed.password !== "") return "about:blank";
        if (parsed.href.length > 2048) return "about:blank";
        return parsed.href;
      }
      return "about:blank";
    } catch {
      return "about:blank";
    }
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
    // O(1) via reverse index instead of scanning entire forward map
    const tabIds = this.containerTabs.get(containerId);
    if (tabIds) {
      for (const tabId of tabIds) this.tabOwners.delete(tabId);
      this.containerTabs.delete(containerId);
      this.scheduleTabOwnersSave();
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
      this.logger.warn("Could not update toolbar badge", {
        error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      });
    }
  }
}

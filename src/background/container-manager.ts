import { EphemeralError, errorMessage } from "../core/errors";
import { containerName, randomId, randomToken } from "../core/ids";
import { policyForKind } from "../core/policy";
import type { ContainerKind, ContainerRecord, CreationIntent } from "../core/types";
import { sanitizeStyleName, validateLifecyclePolicy } from "../core/validation";
import type { BrowserAdapter, BrowserIdentity } from "./browser-adapter";
import type { Scheduler } from "./scheduler";
import type { StateRepository } from "./state-repository";

const CREATION_INTENT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type Capabilities = {
  supportedColors: string[];
  supportedIcons: string[];
};

function tokenHash(token: string): number {
  let hash = 0;
  for (const character of token) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

export class ContainerManager {
  private capabilities: Capabilities | undefined;

  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly repository: StateRepository,
    private readonly scheduler: Scheduler,
    private readonly now: () => number = Date.now,
  ) {}

  public async getCapabilities(): Promise<Capabilities> {
    if (this.capabilities) return structuredClone(this.capabilities);
    const [colors, icons] = await Promise.all([
      this.adapter.getSupportedColors(),
      this.adapter.getSupportedIcons(),
    ]);
    if (colors.length === 0 || icons.length === 0) {
      throw new EphemeralError(
        "Firefox reported no supported container styles",
        "NO_STYLES",
      );
    }
    this.capabilities = { supportedColors: colors, supportedIcons: icons };
    return structuredClone(this.capabilities);
  }

  public async create(
    kind: ContainerKind,
    browserSessionId: string,
    openTab: boolean,
  ): Promise<ContainerRecord> {
    const state = await this.repository.snapshot();
    return this.createWithUrl(kind, browserSessionId, state.settings.startUrl, openTab);
  }

  public async createWithUrl(
    kind: ContainerKind,
    browserSessionId: string,
    url: string,
    openTab: boolean,
  ): Promise<ContainerRecord> {
    const [state, capabilities] = await Promise.all([
      this.repository.snapshot(),
      this.getCapabilities(),
    ]);
    const token = randomToken();
    const id = randomId("container");
    const name = containerName(state.settings.containerNamePrefix, token);
    const policy = policyForKind(
      kind,
      state.settings.oneTimePolicy,
      state.settings.reusablePolicy,
    );
    const intent: CreationIntent = {
      id,
      operationToken: token,
      expectedName: name,
      kind,
      createdAt: this.now(),
      browserSessionId,
      policy,
    };
    await this.repository.transaction((draft) => {
      draft.creationIntents[id] = intent;
    });

    const styleIndex = tokenHash(token);
    const color = sanitizeStyleName(
      capabilities.supportedColors[styleIndex % capabilities.supportedColors.length] ??
        "blue",
      "blue",
    );
    const preferredIcon = capabilities.supportedIcons.includes("fingerprint")
      ? "fingerprint"
      : (capabilities.supportedIcons[styleIndex % capabilities.supportedIcons.length] ??
        "circle");
    const icon = sanitizeStyleName(preferredIcon, "circle");

    let identity: BrowserIdentity;
    try {
      identity = await this.adapter.createIdentity({ name, color, icon });
    } catch (error) {
      await this.repository.transaction((draft) => {
        delete draft.creationIntents[id];
      });
      throw new EphemeralError(
        `Firefox could not create the container: ${errorMessage(error)}`,
        "CREATE_FAILED",
        { cause: error },
      );
    }

    const record: ContainerRecord = {
      id,
      operationToken: token,
      cookieStoreId: identity.cookieStoreId,
      name: identity.name,
      kind,
      color: identity.color,
      icon: identity.icon,
      createdAt: intent.createdAt,
      lastActivityAt: intent.createdAt,
      createdBrowserSessionId: browserSessionId,
      policy,
      status: "active",
      cleanupAttempts: 0,
    };
    await this.repository.transaction((draft) => {
      draft.containers[id] = record;
      delete draft.creationIntents[id];
    });
    await this.scheduler.scheduleInactivity(record);

    if (openTab) {
      try {
        await this.adapter.createTab(record.cookieStoreId, url);
      } catch (error) {
        const message = `Container created, but Firefox could not open its tab: ${errorMessage(error)}`;
        await this.repository.transaction((draft) => {
          const current = draft.containers[id];
          if (current) current.lastError = message;
        });
        throw new EphemeralError(message, "TAB_CREATE_FAILED", { cause: error });
      }
    }
    return record;
  }

  public async openTab(containerId: string): Promise<number> {
    const state = await this.repository.snapshot();
    const record = state.containers[containerId];
    if (!record) throw new EphemeralError("Container not found", "NOT_FOUND");
    if (record.status !== "active") {
      throw new EphemeralError(
        "Container is being cleaned and cannot open a tab",
        "NOT_ACTIVE",
      );
    }
    const tabId = await this.adapter.createTab(
      record.cookieStoreId,
      state.settings.startUrl,
    );
    await this.touch(containerId);
    return tabId;
  }

  public async openTabWithUrl(containerId: string, url: string): Promise<number> {
    const state = await this.repository.snapshot();
    const record = state.containers[containerId];
    if (!record) throw new EphemeralError("Container not found", "NOT_FOUND");
    if (record.status !== "active") {
      throw new EphemeralError(
        "Container is being cleaned and cannot open a tab",
        "NOT_ACTIVE",
      );
    }
    const tabId = await this.adapter.createTab(record.cookieStoreId, url);
    await this.touch(containerId);
    return tabId;
  }

  public async touch(containerId: string): Promise<void> {
    let updated: ContainerRecord | undefined;
    await this.repository.transaction((draft) => {
      const record = draft.containers[containerId];
      if (record?.status !== "active") return;
      record.lastActivityAt = this.now();
      delete record.lastError;
      updated = structuredClone(record);
    });
    if (updated) await this.scheduler.scheduleInactivity(updated);
  }

  public async touchByCookieStore(cookieStoreId: string): Promise<string | undefined> {
    const state = await this.repository.snapshot();
    const record = Object.values(state.containers).find(
      (candidate) => candidate.cookieStoreId === cookieStoreId,
    );
    if (!record) return undefined;
    await this.touch(record.id);
    return record.id;
  }

  public async updatePolicy(containerId: string, value: unknown): Promise<void> {
    const policy = validateLifecyclePolicy(value);
    let updated: ContainerRecord | undefined;
    await this.repository.transaction((draft) => {
      const record = draft.containers[containerId];
      if (!record) throw new EphemeralError("Container not found", "NOT_FOUND");
      record.policy = policy;
      updated = structuredClone(record);
    });
    if (updated) await this.scheduler.scheduleInactivity(updated);
  }

  public async recoverCreationIntents(): Promise<void> {
    const [state, identities] = await Promise.all([
      this.repository.snapshot(),
      this.adapter.queryIdentities(),
    ]);
    const claimed = new Set(
      Object.values(state.containers).map((record) => record.cookieStoreId),
    );
    for (const intent of Object.values(state.creationIntents)) {
      const matching = identities.find(
        (identity) =>
          identity.name === intent.expectedName && !claimed.has(identity.cookieStoreId),
      );
      if (matching) {
        const record: ContainerRecord = {
          id: intent.id,
          operationToken: intent.operationToken,
          cookieStoreId: matching.cookieStoreId,
          name: matching.name,
          kind: intent.kind,
          color: matching.color,
          icon: matching.icon,
          createdAt: intent.createdAt,
          lastActivityAt: intent.createdAt,
          createdBrowserSessionId: intent.browserSessionId,
          policy: structuredClone(intent.policy),
          status: "pending",
          pendingTrigger: "recovery",
          cleanupAttempts: 0,
        };
        await this.repository.transaction((draft) => {
          draft.containers[intent.id] = record;
          delete draft.creationIntents[intent.id];
        });
        claimed.add(matching.cookieStoreId);
      } else if (this.now() - intent.createdAt > CREATION_INTENT_MAX_AGE_MS) {
        await this.repository.transaction((draft) => {
          delete draft.creationIntents[intent.id];
        });
      }
    }
  }

  public async managedRecordForStore(
    cookieStoreId: string,
  ): Promise<ContainerRecord | undefined> {
    const state = await this.repository.snapshot();
    return Object.values(state.containers).find(
      (record) => record.cookieStoreId === cookieStoreId,
    );
  }
}

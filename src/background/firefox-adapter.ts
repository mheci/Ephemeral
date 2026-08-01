import type {
  BrowserAdapter,
  BrowserIdentity,
  BrowserTab,
  DownloadEraseResult,
  SiteDataRemoval,
} from "./browser-adapter";

const STATE_KEY = "ephemeralState";
const FALLBACK_COLORS = ["blue", "green", "orange", "pink", "purple", "red", "yellow"];
const FALLBACK_ICONS = [
  "fingerprint",
  "briefcase",
  "circle",
  "dollar",
  "gift",
  "vacation",
];

type DynamicContextualIdentities = typeof browser.contextualIdentities & {
  getSupportedColors?: () => Promise<string[]>;
  getSupportedIcons?: () => Promise<string[]>;
};

function toIdentity(
  identity: browser.contextualIdentities.ContextualIdentity,
): BrowserIdentity {
  return {
    cookieStoreId: identity.cookieStoreId,
    name: identity.name,
    color: identity.color,
    icon: identity.icon,
  };
}

export class FirefoxAdapter implements BrowserAdapter {
  // Cache for badge to avoid redundant API calls (invisible efficiency)
  private lastBadgeText = "";
  private lastBadgeColor = "";

  public async loadState(): Promise<unknown> {
    const stored = await browser.storage.local.get(STATE_KEY);
    return stored[STATE_KEY];
  }

  public async saveState(value: unknown): Promise<void> {
    await browser.storage.local.set({ [STATE_KEY]: value });
  }

  public async getBrowserSessionId(): Promise<string | undefined> {
    const stored = (await browser.storage.session.get("browserSessionId")) as Record<
      string,
      unknown
    >;
    const value: unknown = stored["browserSessionId"];
    return typeof value === "string" ? value : undefined;
  }

  public async setBrowserSessionId(id: string): Promise<void> {
    await browser.storage.session.set({ browserSessionId: id });
  }

  public async createIdentity(details: {
    name: string;
    color: string;
    icon: string;
  }): Promise<BrowserIdentity> {
    const identity = await browser.contextualIdentities.create({
      name: details.name,
      color: details.color,
      icon: details.icon,
    });
    return toIdentity(identity);
  }

  public async getIdentity(
    cookieStoreId: string,
  ): Promise<BrowserIdentity | undefined> {
    try {
      return toIdentity(await browser.contextualIdentities.get(cookieStoreId));
    } catch {
      return undefined;
    }
  }

  public async queryIdentities(): Promise<BrowserIdentity[]> {
    const identities = await browser.contextualIdentities.query({});
    return identities.map(toIdentity);
  }

  public async removeIdentity(cookieStoreId: string): Promise<void> {
    await browser.contextualIdentities.remove(cookieStoreId);
  }

  public async getSupportedColors(): Promise<string[]> {
    const api = browser.contextualIdentities as DynamicContextualIdentities;
    try {
      return api.getSupportedColors
        ? await api.getSupportedColors()
        : [...FALLBACK_COLORS];
    } catch {
      return [...FALLBACK_COLORS];
    }
  }

  public async getSupportedIcons(): Promise<string[]> {
    const api = browser.contextualIdentities as DynamicContextualIdentities;
    try {
      return api.getSupportedIcons
        ? await api.getSupportedIcons()
        : [...FALLBACK_ICONS];
    } catch {
      return [...FALLBACK_ICONS];
    }
  }

  public async queryTabs(cookieStoreId: string): Promise<BrowserTab[]> {
    const tabs = await browser.tabs.query({ cookieStoreId });
    // Avoid spread operator for micro-efficiency, direct construction
    const result: BrowserTab[] = [];
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        result.push(
          tab.cookieStoreId
            ? { id: tab.id, cookieStoreId: tab.cookieStoreId }
            : { id: tab.id },
        );
      }
    }
    return result;
  }

  public async getTab(tabId: number): Promise<BrowserTab | undefined> {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.id === undefined) return undefined;
      return tab.cookieStoreId
        ? { id: tab.id, cookieStoreId: tab.cookieStoreId }
        : { id: tab.id };
    } catch {
      return undefined;
    }
  }

  public async createTab(cookieStoreId: string, url: string): Promise<number> {
    // Firefox rejects an explicit `about:newtab` combined with cookieStoreId.
    // Omitting url is the supported way to open Firefox's native New Tab page
    // while still assigning the new tab to the requested container.
    const tab = await browser.tabs.create(
      url === "about:newtab"
        ? { active: true, cookieStoreId }
        : { active: true, cookieStoreId, url },
    );
    if (tab.id === undefined) throw new Error("Firefox created a tab without an ID");
    return tab.id;
  }

  public async createWindow(cookieStoreId: string, url: string): Promise<number> {
    // A dedicated browser window whose tabs all belong to the container.
    // The same about:newtab special case applies as for tabs.create.
    const window = await browser.windows.create(
      url === "about:newtab"
        ? { cookieStoreId, focused: true }
        : { cookieStoreId, url, focused: true },
    );
    const tab = window.tabs?.[0];
    if (tab?.id === undefined) {
      throw new Error("Firefox created a window without a tab ID");
    }
    return tab.id;
  }

  public async closeTabs(tabIds: number[]): Promise<void> {
    if (tabIds.length > 0) await browser.tabs.remove(tabIds);
  }

  public async removeScopedSiteData(cookieStoreId: string): Promise<SiteDataRemoval> {
    // Container-scoped data removal: Firefox supports cookieStoreId for
    // cookies, indexedDB, localStorage, cacheStorage, and serviceWorkers.
    // Each type is attempted individually (with one batch shortcut for the
    // core trio) and the result is reported per type so cleanup history can
    // be honest about what Firefox actually accepted.
    const removalOptions = { cookieStoreId, since: 0 };
    const acknowledgedTypes: string[] = [];
    const failedTypes: string[] = [];

    // Primary batch: most critical and universally supported
    try {
      await browser.browsingData.remove(removalOptions, {
        cookies: true,
        indexedDB: true,
        localStorage: true,
      });
      acknowledgedTypes.push("cookies", "indexedDB", "localStorage");
    } catch {
      for (const type of ["cookies", "indexedDB", "localStorage"] as const) {
        try {
          await browser.browsingData.remove(removalOptions, { [type]: true });
          acknowledgedTypes.push(type);
        } catch {
          failedTypes.push(type);
        }
      }
    }

    // Secondary: cacheStorage and serviceWorkers – newer Firefox supports
    // these scoped; older versions reject them and that is reported.
    for (const type of ["cacheStorage", "serviceWorkers"] as const) {
      try {
        await browser.browsingData.remove(removalOptions, { [type]: true });
        acknowledgedTypes.push(type);
      } catch {
        failedTypes.push(type);
      }
    }

    return { acknowledgedTypes, failedTypes };
  }

  public async hasDownloadsPermission(): Promise<boolean> {
    return browser.permissions.contains({ permissions: ["downloads"] });
  }

  public async requestDownloadsPermission(): Promise<boolean> {
    return browser.permissions.request({ permissions: ["downloads"] });
  }

  public async removeDownloadsPermission(): Promise<boolean> {
    return browser.permissions.remove({ permissions: ["downloads"] });
  }

  public async eraseDownloadMetadata(
    cookieStoreId: string,
  ): Promise<DownloadEraseResult> {
    const erasedIds = await browser.downloads.erase({ cookieStoreId });
    const remainingItems = await browser.downloads.search({ cookieStoreId, limit: 1 });
    return { erasedIds, remaining: remainingItems.length };
  }

  public async scheduleAlarm(name: string, when: number): Promise<void> {
    await browser.alarms.create(name, { when });
  }

  public async cancelAlarm(name: string): Promise<void> {
    await browser.alarms.clear(name);
  }

  public async setBadge(text: string, color: string): Promise<void> {
    // Avoid redundant API calls – invisible efficiency
    if (text === this.lastBadgeText && color === this.lastBadgeColor) return;
    this.lastBadgeText = text;
    this.lastBadgeColor = color;
    await Promise.all([
      browser.action.setBadgeText({ text }),
      browser.action.setBadgeBackgroundColor({ color }),
    ]);
  }

  public extensionVersion(): string {
    return browser.runtime.getManifest().version;
  }

  public async browserVersion(): Promise<string | undefined> {
    try {
      return (await browser.runtime.getBrowserInfo()).version;
    } catch {
      return undefined;
    }
  }
}

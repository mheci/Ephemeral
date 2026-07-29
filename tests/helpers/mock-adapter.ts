import type {
  BrowserAdapter,
  BrowserIdentity,
  BrowserTab,
  DownloadEraseResult,
} from "../../src/background/browser-adapter";

export class MockAdapter implements BrowserAdapter {
  public stored: unknown;
  public sessionId: string | undefined;
  public identities = new Map<string, BrowserIdentity>();
  public tabs = new Map<number, BrowserTab>();
  public alarms = new Map<string, number>();
  public siteDataRemovals: string[] = [];
  public identityRemovals: string[] = [];
  public queriedCookieStores: string[] = [];
  public downloadEntries = new Map<string, number[]>();
  public downloadsPermission = false;
  public badge = { text: "", color: "" };
  public failSiteData = false;
  public failIdentityRemoval = false;
  public failTabCreation = false;
  public failDownloads = false;
  public failBadge = false;
  public failTabQueries = false;
  public loadFailuresRemaining = 0;
  private identitySequence = 0;
  private tabSequence = 0;

  public async loadState(): Promise<unknown> {
    if (this.loadFailuresRemaining > 0) {
      this.loadFailuresRemaining -= 1;
      throw new Error("simulated transient storage failure");
    }
    return structuredClone(this.stored);
  }

  public async saveState(value: unknown): Promise<void> {
    this.stored = structuredClone(value);
  }

  public async getBrowserSessionId(): Promise<string | undefined> {
    return this.sessionId;
  }

  public async setBrowserSessionId(id: string): Promise<void> {
    this.sessionId = id;
  }

  public async createIdentity(details: {
    name: string;
    color: string;
    icon: string;
  }): Promise<BrowserIdentity> {
    const identity = {
      cookieStoreId: `firefox-container-${++this.identitySequence}`,
      ...details,
    };
    this.identities.set(identity.cookieStoreId, identity);
    return structuredClone(identity);
  }

  public async getIdentity(
    cookieStoreId: string,
  ): Promise<BrowserIdentity | undefined> {
    const value = this.identities.get(cookieStoreId);
    return value ? structuredClone(value) : undefined;
  }

  public async queryIdentities(): Promise<BrowserIdentity[]> {
    return [...this.identities.values()].map((value) => structuredClone(value));
  }

  public async removeIdentity(cookieStoreId: string): Promise<void> {
    if (this.failIdentityRemoval) throw new Error("simulated identity removal failure");
    if (!this.identities.has(cookieStoreId))
      throw new Error("Contextual identity not found");
    this.identities.delete(cookieStoreId);
    this.identityRemovals.push(cookieStoreId);
  }

  public async getSupportedColors(): Promise<string[]> {
    return ["blue", "cyan", "violet"];
  }

  public async getSupportedIcons(): Promise<string[]> {
    return ["fingerprint", "circle"];
  }

  public async queryTabs(cookieStoreId: string): Promise<BrowserTab[]> {
    this.queriedCookieStores.push(cookieStoreId);
    if (this.failTabQueries) throw new Error("simulated tab query failure");
    return [...this.tabs.values()]
      .filter((tab) => tab.cookieStoreId === cookieStoreId)
      .map((tab) => structuredClone(tab));
  }

  public async getTab(tabId: number): Promise<BrowserTab | undefined> {
    const value = this.tabs.get(tabId);
    return value ? structuredClone(value) : undefined;
  }

  public async createTab(cookieStoreId: string): Promise<number> {
    if (this.failTabCreation) throw new Error("simulated tab creation failure");
    if (!this.identities.has(cookieStoreId))
      throw new Error("Container does not exist");
    const id = ++this.tabSequence;
    this.tabs.set(id, { id, cookieStoreId });
    return id;
  }

  public async closeTabs(tabIds: number[]): Promise<void> {
    for (const id of tabIds) this.tabs.delete(id);
  }

  public async removeScopedSiteData(cookieStoreId: string): Promise<void> {
    if (this.failSiteData) throw new Error("simulated browsingData failure");
    this.siteDataRemovals.push(cookieStoreId);
  }

  public async hasDownloadsPermission(): Promise<boolean> {
    return this.downloadsPermission;
  }

  public async requestDownloadsPermission(): Promise<boolean> {
    this.downloadsPermission = true;
    return true;
  }

  public async removeDownloadsPermission(): Promise<boolean> {
    this.downloadsPermission = false;
    return true;
  }

  public async eraseDownloadMetadata(
    cookieStoreId: string,
  ): Promise<DownloadEraseResult> {
    if (this.failDownloads) throw new Error("simulated downloads failure");
    const erasedIds = this.downloadEntries.get(cookieStoreId) ?? [];
    this.downloadEntries.delete(cookieStoreId);
    return { erasedIds, remaining: 0 };
  }

  public async scheduleAlarm(name: string, when: number): Promise<void> {
    this.alarms.set(name, when);
  }

  public async cancelAlarm(name: string): Promise<void> {
    this.alarms.delete(name);
  }

  public async setBadge(text: string, color: string): Promise<void> {
    if (this.failBadge) throw new Error("simulated badge failure");
    this.badge = { text, color };
  }

  public extensionVersion(): string {
    return "1.2.0-test";
  }

  public async browserVersion(): Promise<string> {
    return "153.0-test";
  }

  public removeTabsForStore(cookieStoreId: string): void {
    for (const [id, tab] of this.tabs) {
      if (tab.cookieStoreId === cookieStoreId) this.tabs.delete(id);
    }
  }
}

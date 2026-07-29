export type BrowserIdentity = {
  cookieStoreId: string;
  name: string;
  color: string;
  icon: string;
};

export type BrowserTab = {
  id: number;
  cookieStoreId?: string;
};

export type DownloadEraseResult = {
  erasedIds: number[];
  remaining: number;
};

export type BrowserAdapter = {
  loadState(): Promise<unknown>;
  saveState(value: unknown): Promise<void>;
  getBrowserSessionId(): Promise<string | undefined>;
  setBrowserSessionId(id: string): Promise<void>;
  createIdentity(details: {
    name: string;
    color: string;
    icon: string;
  }): Promise<BrowserIdentity>;
  getIdentity(cookieStoreId: string): Promise<BrowserIdentity | undefined>;
  queryIdentities(): Promise<BrowserIdentity[]>;
  removeIdentity(cookieStoreId: string): Promise<void>;
  getSupportedColors(): Promise<string[]>;
  getSupportedIcons(): Promise<string[]>;
  queryTabs(cookieStoreId: string): Promise<BrowserTab[]>;
  getTab(tabId: number): Promise<BrowserTab | undefined>;
  createTab(cookieStoreId: string, url: string): Promise<number>;
  closeTabs(tabIds: number[]): Promise<void>;
  removeScopedSiteData(cookieStoreId: string): Promise<void>;
  hasDownloadsPermission(): Promise<boolean>;
  requestDownloadsPermission(): Promise<boolean>;
  removeDownloadsPermission(): Promise<boolean>;
  eraseDownloadMetadata(cookieStoreId: string): Promise<DownloadEraseResult>;
  scheduleAlarm(name: string, when: number): Promise<void>;
  cancelAlarm(name: string): Promise<void>;
  setBadge(text: string, color: string): Promise<void>;
  extensionVersion(): string;
  browserVersion(): Promise<string | undefined>;
};

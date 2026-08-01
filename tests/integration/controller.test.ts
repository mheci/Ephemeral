import { beforeEach, describe, expect, it } from "vitest";
import { Controller } from "../../src/background/controller";
import type { PublicState } from "../../src/core/types";
import { MockAdapter } from "../helpers/mock-adapter";

let now: number;
let adapter: MockAdapter;
let controller: Controller;

async function state(): Promise<PublicState> {
  return controller.getPublicState();
}

beforeEach(async () => {
  now = 1_700_000_000_000;
  adapter = new MockAdapter();
  controller = new Controller(adapter, () => now);
  await controller.initialize();
});

describe("container lifecycle integration", () => {
  it("creates and destroys a one-time container after its last tab closes", async () => {
    await controller.createContainer("one-time", true);
    const created = (await state()).containers[0];
    expect(created).toBeDefined();
    expect(created?.tabCount).toBe(1);
    expect(adapter.identities.size).toBe(1);

    adapter.removeTabsForStore(created!.cookieStoreId);
    await controller.onTabRemoved(99_001);

    const result = await state();
    expect(result.containers).toHaveLength(0);
    expect(adapter.siteDataRemovals).toEqual([created!.cookieStoreId]);
    expect(adapter.identityRemovals).toEqual([created!.cookieStoreId]);
    expect(result.cleanupHistory[0]?.outcome).toBe("completed-with-limitations");
    expect(result.cleanupHistory[0]?.steps.map((item) => item.name)).toContain(
      "scoped-site-data",
    );
  });

  it("does not race a new tab opened before last-tab cleanup", async () => {
    await controller.createContainer("one-time", true);
    const created = (await state()).containers[0]!;
    await controller.onTabRemoved(99_001);
    expect((await state()).containers).toHaveLength(1);
    expect(adapter.siteDataRemovals).toHaveLength(0);
    expect(adapter.identities.has(created.cookieStoreId)).toBe(true);
  });

  it("closes live tabs during manual cleanup", async () => {
    await controller.createContainer("reusable", true);
    const created = (await state()).containers[0]!;
    await controller.openTab(created.id);
    expect((await state()).containers[0]?.tabCount).toBe(2);
    const report = await controller.cleanupContainer(created.id);
    expect(
      report?.steps.find((item) => item.name === "close-tabs")?.affectedItems,
    ).toBe(2);
    expect(adapter.tabs.size).toBe(0);
  });

  it("expires a reusable container via an alarm without polling", async () => {
    await controller.createContainer("reusable", true);
    const created = (await state()).containers[0]!;
    const alarm = `ephemeral:inactivity:${created.id}`;
    expect(adapter.alarms.has(alarm)).toBe(true);
    now = created.lastActivityAt + created.policy.inactivity.minutes * 60_000;
    await controller.onAlarm(alarm);
    expect((await state()).containers).toHaveLength(0);
  });

  it("keeps the identity after a failed scoped cleanup and retries safely", async () => {
    await controller.createContainer("reusable", false);
    const created = (await state()).containers[0]!;
    adapter.failSiteData = true;
    const first = await controller.cleanupContainer(created.id);
    expect(first?.outcome).toBe("failed");
    expect(adapter.identities.has(created.cookieStoreId)).toBe(true);
    expect((await state()).containers[0]?.status).toBe("failed");
    const retryAlarm = `ephemeral:retry:${created.id}`;
    expect(adapter.alarms.has(retryAlarm)).toBe(true);

    adapter.failSiteData = false;
    await controller.onAlarm(retryAlarm);
    expect((await state()).containers).toHaveLength(0);
    expect((await state()).cleanupHistory.map((entry) => entry.outcome)).toEqual([
      "completed-with-limitations",
      "failed",
    ]);
  });

  it("erases container-scoped download metadata only with opt-in and permission", async () => {
    adapter.downloadsPermission = true;
    const initial = (await state()).settings;
    await controller.updateSettings({
      ...initial,
      cleanup: { eraseDownloadMetadata: true },
    });
    await controller.createContainer("reusable", false);
    const created = (await state()).containers[0]!;
    adapter.downloadEntries.set(created.cookieStoreId, [10, 11]);
    const report = await controller.cleanupContainer(created.id);
    const downloadStep = report?.steps.find(
      (item) => item.name === "download-metadata",
    );
    expect(downloadStep?.outcome).toBe("succeeded");
    expect(downloadStep?.affectedItems).toBe(2);
  });

  it("recovers browser-exit policy on the next startup", async () => {
    adapter.sessionId = "old-session";
    controller = new Controller(adapter, () => now);
    await controller.initialize();
    await controller.createContainer("reusable", false);
    const created = (await state()).containers[0]!;

    adapter.sessionId = undefined;
    const next = new Controller(adapter, () => now + 1);
    await next.initialize();
    await next.onBrowserStartup();
    expect((await next.getPublicState()).containers).toHaveLength(0);
    expect(adapter.identityRemovals).toContain(created.cookieStoreId);
  });

  it("records an externally removed identity without guessing that cleanup ran", async () => {
    await controller.createContainer("reusable", false);
    const created = (await state()).containers[0]!;
    adapter.identities.delete(created.cookieStoreId);
    await controller.onIdentityRemoved(created.cookieStoreId);
    const result = await state();
    expect(result.containers).toHaveLength(0);
    expect(result.cleanupHistory[0]?.trigger).toBe("external-removal");
    expect(result.cleanupHistory[0]?.limitations.join(" ")).toMatch(
      /outside Ephemeral/,
    );
  });

  it("uses the hot tab-owner index instead of scanning unrelated containers", async () => {
    await controller.createContainer("one-time", false);
    await controller.createContainer("one-time", false);
    const [first, second] = (await state()).containers;
    const tabId = await adapter.createTab(first!.cookieStoreId);
    await controller.onTabActivity({ id: tabId, cookieStoreId: first!.cookieStoreId });
    adapter.tabs.delete(tabId);
    adapter.queriedCookieStores = [];

    await controller.onTabRemoved(tabId);

    expect(adapter.queriedCookieStores).not.toContain(second!.cookieStoreId);
    expect((await state()).containers.map((record) => record.id)).toEqual([second!.id]);
  });

  it("creates a dedicated window for a fresh ephemeral container", async () => {
    await controller.createWindow("one-time");
    const created = (await state()).containers[0]!;
    expect(created.kind).toBe("one-time");
    expect(adapter.windowCreates).toEqual([
      { cookieStoreId: created.cookieStoreId, url: "about:blank" },
    ]);
    expect(adapter.tabs.size).toBe(1);
  });

  it("tracks the window tab immediately so closing the window cleans up", async () => {
    await controller.createWindow("one-time");
    const created = (await state()).containers[0]!;
    const [tabId] = [...adapter.tabs.keys()];
    adapter.removeTabsForStore(created.cookieStoreId);
    await controller.onTabRemoved(tabId!);
    expect((await state()).containers).toHaveLength(0);
    expect(adapter.identityRemovals).toEqual([created.cookieStoreId]);
  });

  it("creates a window with a sanitized custom URL and tracks the new tab", async () => {
    await controller.createWindow("reusable", "https://example.com/");
    const created = (await state()).containers[0]!;
    expect(adapter.windowCreates).toEqual([
      { cookieStoreId: created.cookieStoreId, url: "https://example.com/" },
    ]);
    const tabId = [...adapter.tabs.keys()][0]!;
    await controller.onTabActivity({
      id: tabId,
      cookieStoreId: created.cookieStoreId,
    });
    expect((await state()).containers[0]?.tabCount).toBe(1);
  });

  it("rejects dangerous window URLs instead of opening them", async () => {
    await controller.createWindow("one-time", "javascript:alert(1)");
    expect(adapter.windowCreates[0]?.url).toBe("about:blank");
  });

  it("reports a partially rejected site-data removal as a limitation", async () => {
    await controller.createContainer("reusable", false);
    const created = (await state()).containers[0]!;
    adapter.failSiteDataTypes = ["cacheStorage", "serviceWorkers"];
    const report = await controller.cleanupContainer(created.id);
    expect(report?.outcome).toBe("completed-with-limitations");
    const siteStep = report?.steps.find((item) => item.name === "scoped-site-data");
    expect(siteStep?.outcome).toBe("limited");
    expect(report?.limitations.join(" ")).toMatch(/cacheStorage, and serviceWorkers/);
    expect(adapter.identities.has(created.cookieStoreId)).toBe(false);
  });

  it("keeps the identity when every site-data removal is rejected", async () => {
    await controller.createContainer("reusable", false);
    const created = (await state()).containers[0]!;
    adapter.failSiteDataTypes = [
      "cookies",
      "indexedDB",
      "localStorage",
      "cacheStorage",
      "serviceWorkers",
    ];
    const report = await controller.cleanupContainer(created.id);
    expect(report?.outcome).toBe("failed");
    expect(adapter.identities.has(created.cookieStoreId)).toBe(true);
    expect((await state()).containers[0]?.status).toBe("failed");
    expect(adapter.alarms.has(`ephemeral:retry:${created.id}`)).toBe(true);
  });

  it("supports multiple simultaneous containers without cross-cleaning", async () => {
    await controller.createContainer("one-time", true);
    await controller.createContainer("reusable", true);
    const [first, second] = (await state()).containers;
    adapter.removeTabsForStore(first!.cookieStoreId);
    await controller.onTabRemoved(99_001);
    const result = await state();
    expect(result.containers.map((item) => item.id)).toEqual([second!.id]);
    expect(adapter.identities.has(second!.cookieStoreId)).toBe(true);
  });
});

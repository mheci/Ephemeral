import { afterEach, describe, expect, it, vi } from "vitest";
import { FirefoxAdapter } from "../../src/background/firefox-adapter";

afterEach(() => vi.unstubAllGlobals());

function stubTabCreate(result: { id?: number }) {
  const create = vi.fn().mockResolvedValue(result);
  vi.stubGlobal("browser", { tabs: { create } });
  return create;
}

describe("FirefoxAdapter.createTab", () => {
  it("omits explicit about:newtab so Firefox can assign the container", async () => {
    const create = stubTabCreate({ id: 7 });
    await expect(
      new FirefoxAdapter().createTab("firefox-container-7", "about:newtab"),
    ).resolves.toBe(7);
    expect(create).toHaveBeenCalledWith({
      active: true,
      cookieStoreId: "firefox-container-7",
    });
  });

  it("keeps supported explicit URLs", async () => {
    const create = stubTabCreate({ id: 8 });
    await new FirefoxAdapter().createTab("firefox-container-8", "about:blank");
    expect(create).toHaveBeenCalledWith({
      active: true,
      cookieStoreId: "firefox-container-8",
      url: "about:blank",
    });
  });

  it("rejects a Firefox tab without an ID", async () => {
    stubTabCreate({});
    await expect(
      new FirefoxAdapter().createTab("firefox-container-9", "https://example.com/"),
    ).rejects.toThrow(/without an ID/);
  });
});

function stubWindowCreate(result: { id?: number; tabs?: Array<{ id: number }> }) {
  const create = vi.fn().mockResolvedValue(result);
  vi.stubGlobal("browser", { windows: { create }, tabs: { create: vi.fn() } });
  return create;
}

describe("FirefoxAdapter.createWindow", () => {
  it("omits explicit about:newtab so Firefox can assign the container", async () => {
    const create = stubWindowCreate({ id: 50, tabs: [{ id: 500 }] });
    await expect(
      new FirefoxAdapter().createWindow("firefox-container-7", "about:newtab"),
    ).resolves.toBe(500);
    expect(create).toHaveBeenCalledWith({
      cookieStoreId: "firefox-container-7",
      focused: true,
    });
  });

  it("keeps supported explicit URLs", async () => {
    const create = stubWindowCreate({ id: 51, tabs: [{ id: 501 }] });
    await new FirefoxAdapter().createWindow("firefox-container-8", "https://a.test/");
    expect(create).toHaveBeenCalledWith({
      cookieStoreId: "firefox-container-8",
      url: "https://a.test/",
      focused: true,
    });
  });

  it("rejects a Firefox window without a tab ID", async () => {
    stubWindowCreate({ id: 52 });
    await expect(
      new FirefoxAdapter().createWindow("firefox-container-9", "https://example.com/"),
    ).rejects.toThrow(/without a tab ID/);
  });
});

function stubBrowsingData(callbacks: {
  onBatch: () => void;
  onSingle: (type: string) => void;
}) {
  const remove = vi.fn().mockImplementation(async (_options, details: object) => {
    const types = Object.keys(details);
    if (types.length > 1) callbacks.onBatch();
    else callbacks.onSingle(types[0]!);
  });
  vi.stubGlobal("browser", { browsingData: { remove } });
  return remove;
}

describe("FirefoxAdapter.removeScopedSiteData", () => {
  it("acknowledges the core trio in one batch and each secondary type", async () => {
    const singleTypes: string[] = [];
    let batchCount = 0;
    stubBrowsingData({
      onBatch: () => {
        batchCount += 1;
      },
      onSingle: (type) => singleTypes.push(type),
    });
    await expect(
      new FirefoxAdapter().removeScopedSiteData("firefox-container-10"),
    ).resolves.toEqual({
      acknowledgedTypes: [
        "cookies",
        "indexedDB",
        "localStorage",
        "cacheStorage",
        "serviceWorkers",
      ],
      failedTypes: [],
    });
    expect(batchCount).toBe(1);
    expect(singleTypes).toEqual(["cacheStorage", "serviceWorkers"]);
  });

  it("falls back per type and reports failures when Firefox rejects", async () => {
    const rejected = new Set(["indexedDB", "cacheStorage"]);
    stubBrowsingData({
      onBatch: () => {
        throw new Error("simulated batch rejection");
      },
      onSingle: (type) => {
        if (rejected.has(type)) throw new Error(`rejected ${type}`);
      },
    });
    await expect(
      new FirefoxAdapter().removeScopedSiteData("firefox-container-11"),
    ).resolves.toEqual({
      acknowledgedTypes: ["cookies", "localStorage", "serviceWorkers"],
      failedTypes: ["indexedDB", "cacheStorage"],
    });
  });
});

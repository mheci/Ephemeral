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

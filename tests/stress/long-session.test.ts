import { describe, expect, it, vi } from "vitest";
import { Controller } from "../../src/background/controller";
import { MockAdapter } from "../helpers/mock-adapter";

describe("long-session stability", () => {
  it("keeps state and alarms bounded across 1,000 disposable sessions", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let now = 1_700_000_000_000;
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => now);
    await controller.initialize();
    const settings = (await controller.getPublicState()).settings;
    await controller.updateSettings({ ...settings, cleanupHistoryLimit: 25 });

    for (let index = 0; index < 1_000; index += 1) {
      await controller.createContainer("one-time", true);
      const record = (await controller.getPublicState()).containers[0]!;
      adapter.removeTabsForStore(record.cookieStoreId);
      await controller.onTabRemoved(index + 10_000);
      now += 1_000;
    }

    const result = await controller.getPublicState();
    expect(result.containers).toHaveLength(0);
    expect(result.cleanupHistory).toHaveLength(25);
    expect(adapter.identities.size).toBe(0);
    expect(
      [...adapter.alarms.keys()].filter((name) => name.includes("inactivity")),
    ).toHaveLength(0);
  }, 30_000);
});

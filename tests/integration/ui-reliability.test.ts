import { describe, expect, it, vi } from "vitest";
import { Controller } from "../../src/background/controller";
import { MockAdapter } from "../helpers/mock-adapter";

const NOW = 1_700_000_000_000;

describe("dashboard-facing reliability", () => {
  it("allows a fresh initialization attempt after a transient storage failure", async () => {
    const adapter = new MockAdapter();
    adapter.loadFailuresRemaining = 1;
    const controller = new Controller(adapter, () => NOW);
    await expect(controller.initialize()).rejects.toThrow(/storage failure/);
    await expect(controller.initialize()).resolves.toBeUndefined();
    await expect(controller.getPublicState()).resolves.toMatchObject({
      health: { level: "healthy", summary: "Ready" },
    });
  });

  it("does not let a toolbar badge failure block dashboard initialization", async () => {
    const adapter = new MockAdapter();
    adapter.failBadge = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    expect((await controller.getPublicState()).health.summary).toBe("Ready");
  });

  it("keeps diagnostic state visible during a transient tab-count failure", async () => {
    const adapter = new MockAdapter();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    await controller.createContainer("reusable", false);
    adapter.failTabQueries = true;
    const state = await controller.getPublicState();
    expect(state.containers).toHaveLength(1);
    expect(state.containers[0]?.tabCount).toBe(0);
    expect(state.health.level).toBe("healthy");
  });
});

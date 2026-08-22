import { describe, expect, it, vi } from "vitest";
import { Controller } from "../../src/background/controller";
import { createInitialState } from "../../src/core/defaults";
import type { PersistedState } from "../../src/core/types";
import { MockAdapter } from "../helpers/mock-adapter";

const NOW = 1_700_000_000_000;

describe("panic wipe with undo grace", () => {
  it("arms a force-cleanup deadline and alarm on every active container", async () => {
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    await controller.createContainer("one-time", false);
    await controller.createContainer("reusable", false);

    const armed = await controller.panicClean();
    expect(armed).toBe(2);

    const state = await controller.getPublicState();
    for (const record of state.containers) {
      expect(record.panicDeadline).toBe(NOW + 10_000);
      expect(adapter.alarms.get(`ephemeral:panic:${record.id}`)).toBe(NOW + 10_000);
    }
  });

  it("skips containers that are not active and no-ops on an empty dashboard", async () => {
    const adapter = new MockAdapter();
    const stored = createInitialState();
    stored.containers["container-busy"] = {
      id: "container-busy",
      operationToken: "AAA111",
      cookieStoreId: "firefox-container-1",
      name: "Ephemeral · AAA111",
      kind: "one-time",
      color: "blue",
      icon: "circle",
      createdAt: NOW,
      lastActivityAt: NOW,
      createdBrowserSessionId: "session-1",
      policy: stored.settings.oneTimePolicy,
      status: "cleaning",
      cleanupAttempts: 1,
    };
    adapter.stored = stored;
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();

    expect(await controller.panicClean()).toBe(0);
    const persisted = adapter.stored as PersistedState;
    expect(persisted.containers["container-busy"]?.panicDeadline).toBeUndefined();
    expect(await new Controller(new MockAdapter(), () => NOW).panicClean()).toBe(0);
  });

  it("force-cleans a container with open tabs when the panic deadline expires", async () => {
    const adapter = new MockAdapter();
    const clock = { value: NOW };
    const controller = new Controller(adapter, () => clock.value);
    await controller.initialize();
    await controller.createContainer("reusable", false);
    const record = (await controller.getPublicState()).containers[0]!;
    adapter.tabs.set(11, { id: 11, cookieStoreId: record.cookieStoreId });
    adapter.tabs.set(12, { id: 12, cookieStoreId: record.cookieStoreId });

    expect(await controller.panicClean()).toBe(1);
    // The panic alarm fires after the grace window; open tabs must not rescue it.
    clock.value += 10_001;
    await controller.onAlarm(`ephemeral:panic:${record.id}`);

    const result = await controller.getPublicState();
    expect(result.containers).toHaveLength(0);
    expect(result.cleanupHistory[0]?.trigger).toBe("panic-expired");
    expect(result.cleanupHistory[0]?.outcome).toBe("completed-with-limitations");
    expect(adapter.identityRemovals).toEqual([record.cookieStoreId]);
    expect(result.lifetimeStats.tabsClosed).toBe(2);
  });

  it("keeps the wipe armed across tab activity – only an explicit cancel undoes it", async () => {
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    await controller.createContainer("reusable", true);

    await controller.panicClean();
    const before = (await controller.getPublicState()).containers[0]!;
    expect(before.panicDeadline).toBeDefined();

    // Tab events touch the container (clearing drains) but never the panic.
    await controller.onTabRemoved(999);
    const after = (await controller.getPublicState()).containers[0]!;
    expect(after.panicDeadline).toBe(before.panicDeadline);
    expect(adapter.alarms.has(`ephemeral:panic:${after.id}`)).toBe(true);

    expect(await controller.cancelPanicClean()).toBe(1);
    const cancelled = (await controller.getPublicState()).containers[0]!;
    expect(cancelled.panicDeadline).toBeUndefined();
    expect(adapter.alarms.has(`ephemeral:panic:${cancelled.id}`)).toBe(false);
    expect((await controller.getPublicState()).cleanupHistory).toHaveLength(0);
  });

  it("cancelling without an armed wipe reports zero", async () => {
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    await controller.createContainer("reusable", false);
    expect(await controller.cancelPanicClean()).toBe(0);
  });

  it("re-arms persisted panic deadlines after event-page suspension", async () => {
    const adapter = new MockAdapter();
    const first = new Controller(adapter, () => NOW);
    await first.initialize();
    await first.createContainer("reusable", false);
    expect(await first.panicClean()).toBe(1);

    // A fresh event page recovers the armed wipe from persisted state.
    const recovered = new Controller(adapter, () => NOW + 1_000);
    await recovered.initialize();
    const record = (await recovered.getPublicState()).containers[0]!;
    expect(record.panicDeadline).toBe(NOW + 10_000);
    expect(adapter.alarms.get(`ephemeral:panic:${record.id}`)).toBe(NOW + 10_000);
  });

  it("settles a panic deadline that expired while suspended", async () => {
    const adapter = new MockAdapter();
    const first = new Controller(adapter, () => NOW);
    await first.initialize();
    await first.createContainer("reusable", false);
    const record = (await first.getPublicState()).containers[0]!;
    adapter.tabs.set(21, { id: 21, cookieStoreId: record.cookieStoreId });
    expect(await first.panicClean()).toBe(1);

    // Suspension outlasts the panic window: recovery finishes the wipe.
    const recovered = new Controller(adapter, () => NOW + 60_000);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await recovered.initialize();

    const result = await recovered.getPublicState();
    expect(result.containers).toHaveLength(0);
    expect(result.cleanupHistory[0]?.trigger).toBe("panic-expired");
    expect(adapter.identityRemovals).toEqual([record.cookieStoreId]);
  });

  it("respects a zero-second panic window by cleaning immediately on expiry", async () => {
    const adapter = new MockAdapter();
    const clock = { value: NOW };
    const controller = new Controller(adapter, () => clock.value);
    await controller.initialize();
    const settings = (await controller.getPublicState()).settings;
    await controller.updateSettings({ ...settings, panicGraceSeconds: 0 });
    await controller.createContainer("reusable", false);
    const record = (await controller.getPublicState()).containers[0]!;

    expect(await controller.panicClean()).toBe(1);
    clock.value += 1_001;
    await controller.onAlarm(`ephemeral:panic:${record.id}`);
    expect((await controller.getPublicState()).containers).toHaveLength(0);
  });
});

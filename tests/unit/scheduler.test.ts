import { describe, expect, it } from "vitest";
import { Scheduler } from "../../src/background/scheduler";
import { createDefaultSettings } from "../../src/core/defaults";
import type { ContainerRecord } from "../../src/core/types";
import { MockAdapter } from "../helpers/mock-adapter";

function record(): ContainerRecord {
  return {
    id: "c1",
    operationToken: "TOKEN1",
    cookieStoreId: "firefox-container-1",
    name: "Ephemeral · TOKEN1",
    kind: "reusable",
    color: "blue",
    icon: "circle",
    createdAt: 0,
    lastActivityAt: 10_000,
    createdBrowserSessionId: "s1",
    policy: {
      destroyOnLastTabClose: false,
      graceSeconds: 0,
      destroyOnBrowserRestart: true,
      inactivity: { enabled: true, minutes: 5 },
    },
    status: "active",
    cleanupAttempts: 0,
  };
}

describe("Scheduler", () => {
  it("uses one event-driven inactivity alarm per container", async () => {
    const adapter = new MockAdapter();
    const scheduler = new Scheduler(adapter, () => 20_000);
    await scheduler.scheduleInactivity(record());
    expect(adapter.alarms.get("ephemeral:inactivity:c1")).toBe(310_000);
    expect(scheduler.parse("ephemeral:inactivity:c1")).toEqual({
      kind: "inactivity",
      containerId: "c1",
    });
  });

  it("cancels inactive policy alarms and bounds retry delay", async () => {
    const adapter = new MockAdapter();
    const scheduler = new Scheduler(adapter, () => 0);
    const value = record();
    value.policy.inactivity.enabled = false;
    await scheduler.scheduleInactivity(value);
    expect(adapter.alarms.size).toBe(0);
    value.cleanupAttempts = 99;
    await scheduler.scheduleRetry(value, createDefaultSettings());
    expect(adapter.alarms.get("ephemeral:retry:c1")).toBe(240 * 60_000);
  });

  it("schedules, parses, and cancels drain-grace alarms", async () => {
    const adapter = new MockAdapter();
    const scheduler = new Scheduler(adapter, () => 20_000);
    await scheduler.scheduleDrain("c1", 100_000);
    expect(adapter.alarms.get("ephemeral:drain:c1")).toBe(100_000);
    expect(scheduler.parse("ephemeral:drain:c1")).toEqual({
      kind: "drain",
      containerId: "c1",
    });
    await scheduler.cancelDrain("c1");
    expect(adapter.alarms.has("ephemeral:drain:c1")).toBe(false);
  });

  it("bounds an early drain alarm to the minimum lead time", async () => {
    const adapter = new MockAdapter();
    const scheduler = new Scheduler(adapter, () => 50_000);
    await scheduler.scheduleDrain("c1", 50_200);
    expect(adapter.alarms.get("ephemeral:drain:c1")).toBe(51_000);
  });

  it("cancels the drain alarm with every container-level teardown", async () => {
    const adapter = new MockAdapter();
    const scheduler = new Scheduler(adapter, () => 0);
    await scheduler.scheduleDrain("c1", 60_000);
    await scheduler.scheduleInactivity(record());
    await scheduler.cancelForContainer("c1");
    expect(adapter.alarms.size).toBe(0);
  });

  it("disarms only the inactivity alarm without touching drain state", async () => {
    const adapter = new MockAdapter();
    const scheduler = new Scheduler(adapter, () => 0);
    await scheduler.scheduleDrain("c1", 60_000);
    await scheduler.scheduleInactivity(record());
    await scheduler.cancelInactivity("c1");
    expect(adapter.alarms.has("ephemeral:inactivity:c1")).toBe(false);
    expect(adapter.alarms.get("ephemeral:drain:c1")).toBe(60_000);
  });
});

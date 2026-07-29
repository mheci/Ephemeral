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
});

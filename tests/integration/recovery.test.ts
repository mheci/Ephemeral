import { describe, expect, it, vi } from "vitest";
import { Controller } from "../../src/background/controller";
import { createInitialState } from "../../src/core/defaults";
import type { BrowserIdentity } from "../../src/background/browser-adapter";
import type { PersistedState } from "../../src/core/types";
import { MockAdapter } from "../helpers/mock-adapter";

const NOW = 1_700_000_000_000;

function identity(name: string): BrowserIdentity {
  return {
    cookieStoreId: "firefox-container-77",
    name,
    color: "blue",
    icon: "fingerprint",
  };
}

describe("recovery and secondary branches", () => {
  it("adopts only an exact creation intent and immediately recovers cleanup", async () => {
    const adapter = new MockAdapter();
    const state = createInitialState();
    state.creationIntents["intent-1"] = {
      id: "intent-1",
      operationToken: "ABC234",
      expectedName: "Ephemeral · ABC234",
      kind: "one-time",
      createdAt: NOW,
      browserSessionId: "session-old",
      policy: state.settings.oneTimePolicy,
    };
    adapter.stored = state;
    adapter.identities.set("firefox-container-77", identity("Ephemeral · ABC234"));
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    const result = await controller.getPublicState();
    expect(result.containers).toHaveLength(0);
    expect(result.cleanupHistory[0]?.trigger).toBe("recovery");
    expect(adapter.identityRemovals).toEqual(["firefox-container-77"]);
  });

  it("expires an old unmatched intent without adopting similarly named identities", async () => {
    const adapter = new MockAdapter();
    const state = createInitialState();
    state.creationIntents["intent-old"] = {
      id: "intent-old",
      operationToken: "ABC234",
      expectedName: "Ephemeral · ABC234",
      kind: "one-time",
      createdAt: 0,
      browserSessionId: "old",
      policy: state.settings.oneTimePolicy,
    };
    adapter.stored = state;
    adapter.identities.set("firefox-container-77", identity("Ephemeral · DIFFERENT"));
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    const persisted = adapter.stored as PersistedState;
    expect(persisted.creationIntents).toEqual({});
    expect(adapter.identities.size).toBe(1);
  });

  it("keeps a container visible when tab opening fails after identity creation", async () => {
    const adapter = new MockAdapter();
    adapter.failTabCreation = true;
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    await expect(controller.createContainer("one-time", true)).rejects.toMatchObject({
      code: "TAB_CREATE_FAILED",
    });
    const result = await controller.getPublicState();
    expect(result.containers).toHaveLength(1);
    expect(result.containers[0]?.lastError).toMatch(/could not open/);
    expect(adapter.identities.size).toBe(1);
  });

  it("reports a configured download cleanup as limited without permission", async () => {
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    const settings = (await controller.getPublicState()).settings;
    await controller.updateSettings({
      ...settings,
      cleanup: { eraseDownloadMetadata: true },
    });
    await controller.createContainer("reusable", false);
    const record = (await controller.getPublicState()).containers[0]!;
    const report = await controller.cleanupContainer(record.id);
    expect(
      report?.steps.find((item) => item.name === "download-metadata")?.outcome,
    ).toBe("limited");
  });

  it("retains identity and retries when identity removal itself fails", async () => {
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    await controller.createContainer("reusable", false);
    const record = (await controller.getPublicState()).containers[0]!;
    adapter.failIdentityRemoval = true;
    const report = await controller.cleanupContainer(record.id);
    expect(report?.outcome).toBe("failed");
    expect(adapter.identities.has(record.cookieStoreId)).toBe(true);
    expect(adapter.siteDataRemovals).toEqual([record.cookieStoreId]);
  });

  it("handles unknown and stale alarms without destructive work", async () => {
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => NOW);
    await controller.initialize();
    await controller.onAlarm("someone-else:alarm");
    await controller.onAlarm("ephemeral:retry:missing");
    expect(adapter.identities.size).toBe(0);
    expect(adapter.alarms.size).toBe(0);
  });

  it("reconciles an identity missing before event-page initialization", async () => {
    const adapter = new MockAdapter();
    const first = new Controller(adapter, () => NOW);
    await first.initialize();
    await first.createContainer("reusable", false);
    const record = (await first.getPublicState()).containers[0]!;
    adapter.identities.delete(record.cookieStoreId);
    const recovered = new Controller(adapter, () => NOW + 1);
    await recovered.initialize();
    const result = await recovered.getPublicState();
    expect(result.containers).toHaveLength(0);
    expect(result.cleanupHistory[0]?.limitations.join(" ")).toMatch(/already absent/);
  });
});

import { describe, expect, it } from "vitest";
import { StateRepository } from "../../src/background/state-repository";
import { createInitialState } from "../../src/core/defaults";
import { MockAdapter } from "../helpers/mock-adapter";

describe("StateRepository", () => {
  it("initializes and persists an empty schema", async () => {
    const adapter = new MockAdapter();
    const repository = new StateRepository(adapter);
    const state = await repository.initialize();
    expect(state.schemaVersion).toBe(1);
    expect(adapter.stored).toEqual(state);
  });

  it("salvages parseable ownership records from an unsupported schema", async () => {
    const adapter = new MockAdapter();
    const validRecord = {
      id: "container-1",
      operationToken: "ABC234",
      cookieStoreId: "firefox-container-1",
      name: "Ephemeral · ABC234",
      kind: "reusable",
      color: "blue",
      icon: "circle",
      createdAt: 1,
      lastActivityAt: 1,
      createdBrowserSessionId: "session-1",
      policy: createInitialState().settings.reusablePolicy,
      status: "active",
      cleanupAttempts: 0,
    };
    adapter.stored = {
      schemaVersion: 999,
      revision: 42,
      settings: { not: "usable" },
      containers: { "container-1": validRecord, broken: { id: "broken" } },
      creationIntents: {},
      cleanupHistory: [{ id: "broken" }],
    };
    const recovered = await new StateRepository(adapter).initialize();
    expect(recovered.schemaVersion).toBe(1);
    expect(recovered.revision).toBe(0);
    expect(recovered.containers["container-1"]?.cookieStoreId).toBe(
      "firefox-container-1",
    );
    expect(recovered.containers["broken"]).toBeUndefined();
    expect(recovered.settings.containerNamePrefix).toBe("Ephemeral");
    expect((adapter.stored as typeof recovered).schemaVersion).toBe(1);
  });

  it("repairs invalid settings while preserving valid managed records", async () => {
    const adapter = new MockAdapter();
    const stored = createInitialState();
    stored.settings = { broken: true } as never;
    stored.containers["container-1"] = {
      id: "container-1",
      operationToken: "ABC234",
      cookieStoreId: "firefox-container-1",
      name: "Ephemeral · ABC234",
      kind: "reusable",
      color: "blue",
      icon: "circle",
      createdAt: 1,
      lastActivityAt: 1,
      createdBrowserSessionId: "session-1",
      policy: createInitialState().settings.reusablePolicy,
      status: "active",
      cleanupAttempts: 0,
    };
    adapter.stored = stored;
    const recovered = await new StateRepository(adapter).initialize();
    expect(recovered.settings.containerNamePrefix).toBe("Ephemeral");
    expect(recovered.containers["container-1"]?.cookieStoreId).toBe(
      "firefox-container-1",
    );
    expect((adapter.stored as typeof recovered).settings.containerNamePrefix).toBe(
      "Ephemeral",
    );
  });

  it("repairs malformed bounded collections and persists the repair", async () => {
    const adapter = new MockAdapter();
    adapter.stored = {
      ...createInitialState(),
      revision: "invalid",
      containers: { broken: { id: "broken" } },
      creationIntents: { broken: { id: "broken" } },
      cleanupHistory: [{ id: "broken" }],
    };
    const repository = new StateRepository(adapter);
    const recovered = await repository.initialize();
    expect(recovered.revision).toBe(0);
    expect(recovered.containers).toEqual({});
    expect(recovered.creationIntents).toEqual({});
    expect(recovered.cleanupHistory).toEqual([]);
    expect(adapter.stored).toEqual(recovered);
  });

  it("preserves valid lifetime stats and resets corrupted ones", async () => {
    const adapter = new MockAdapter();
    adapter.stored = {
      ...createInitialState(),
      lifetimeStats: {
        containersCreated: 7,
        containersCleaned: 5,
        cleanupsFailed: 1,
        dataTypesErased: 25,
        tabsClosed: 9,
      },
    };
    const preserved = await new StateRepository(adapter).initialize();
    expect(preserved.lifetimeStats).toEqual({
      containersCreated: 7,
      containersCleaned: 5,
      cleanupsFailed: 1,
      dataTypesErased: 25,
      tabsClosed: 9,
    });

    adapter.stored = {
      ...createInitialState(),
      lifetimeStats: { containersCreated: -1 },
    };
    const repaired = await new StateRepository(adapter).initialize();
    expect(repaired.lifetimeStats).toEqual(createInitialState().lifetimeStats);
    expect(adapter.stored).toEqual(repaired);
  });

  it("accepts records carrying an active drain deadline", async () => {
    const adapter = new MockAdapter();
    const draining = {
      ...createInitialState().settings.reusablePolicy,
    };
    adapter.stored = {
      ...createInitialState(),
      containers: {
        "container-1": {
          id: "container-1",
          operationToken: "ABC234",
          cookieStoreId: "firefox-container-1",
          name: "Ephemeral · ABC234",
          kind: "reusable",
          color: "blue",
          icon: "circle",
          createdAt: 1,
          lastActivityAt: 1,
          createdBrowserSessionId: "session-1",
          policy: draining,
          status: "active",
          drainDeadline: 99_000,
          cleanupAttempts: 0,
        },
      },
    };
    const recovered = await new StateRepository(adapter).initialize();
    expect(recovered.containers["container-1"]?.drainDeadline).toBe(99_000);

    adapter.stored = {
      ...createInitialState(),
      containers: {
        "container-1": {
          ...recovered.containers["container-1"]!,
          drainDeadline: "soon",
        },
      },
    };
    expect(
      (await new StateRepository(adapter).initialize()).containers["container-1"],
    ).toBeUndefined();
  });

  it("rejects a non-object persisted root", async () => {
    const adapter = new MockAdapter();
    adapter.stored = "corrupt";
    await expect(new StateRepository(adapter).initialize()).rejects.toThrow(
      /state root is not an object/,
    );
  });

  it("serializes concurrent copy-on-write transactions", async () => {
    const adapter = new MockAdapter();
    adapter.stored = createInitialState();
    const repository = new StateRepository(adapter);
    await repository.initialize();
    await Promise.all([
      repository.transaction((draft) => {
        draft.settings.containerNamePrefix = "First";
      }),
      repository.transaction((draft) => {
        draft.settings.startUrl = "about:blank";
      }),
    ]);
    const result = await repository.snapshot();
    expect(result.settings.containerNamePrefix).toBe("First");
    expect(result.settings.startUrl).toBe("about:blank");
    expect(result.revision).toBe(2);
  });

  it("does not commit a failed transaction and keeps the queue usable", async () => {
    const adapter = new MockAdapter();
    const repository = new StateRepository(adapter);
    await repository.initialize();
    await expect(
      repository.transaction(() => {
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    await repository.transaction((draft) => {
      draft.settings.containerNamePrefix = "Recovered";
    });
    expect((await repository.snapshot()).settings.containerNamePrefix).toBe(
      "Recovered",
    );
  });

  it("summarizes badge counts from in-memory state without cloning history", async () => {
    const adapter = new MockAdapter();
    adapter.stored = createInitialState();
    const repository = new StateRepository(adapter);
    await repository.initialize();

    expect(await repository.badgeSummary()).toEqual({
      total: 0,
      failed: false,
      pending: false,
    });

    await repository.transaction((draft) => {
      draft.containers["container-1"] = {
        id: "container-1",
        operationToken: "AAA111",
        cookieStoreId: "firefox-container-1",
        name: "Ephemeral · AAA111",
        kind: "one-time",
        color: "blue",
        icon: "circle",
        createdAt: 1,
        lastActivityAt: 1,
        createdBrowserSessionId: "session-1",
        policy: draft.settings.oneTimePolicy,
        status: "active",
        cleanupAttempts: 0,
      };
      draft.containers["container-2"] = {
        ...draft.containers["container-1"],
        id: "container-2",
        status: "failed",
      };
      draft.cleanupHistory.push({
        id: "cleanup-1",
        containerId: "container-2",
        containerName: "Ephemeral · AAA111",
        trigger: "manual",
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        outcome: "failed",
        attempt: 1,
        steps: [],
        limitations: [],
      });
    });

    expect(await repository.badgeSummary()).toEqual({
      total: 2,
      failed: true,
      pending: false,
    });
    // The summary is primitives only; snapshots stay fully isolated clones.
    const snapshot = await repository.snapshot();
    const cloned = snapshot.containers["container-1"];
    if (cloned) cloned.status = "cleaning";
    expect((await repository.badgeSummary()).pending).toBe(false);
  });

  it("resolves a container id by cookie store without exposing record copies", async () => {
    const adapter = new MockAdapter();
    adapter.stored = createInitialState();
    const repository = new StateRepository(adapter);
    await repository.initialize();
    await repository.transaction((draft) => {
      draft.containers["container-9"] = {
        id: "container-9",
        operationToken: "ZZZ999",
        cookieStoreId: "firefox-container-9",
        name: "Ephemeral · ZZZ999",
        kind: "reusable",
        color: "blue",
        icon: "circle",
        createdAt: 1,
        lastActivityAt: 1,
        createdBrowserSessionId: "session-1",
        policy: draft.settings.reusablePolicy,
        status: "active",
        cleanupAttempts: 0,
      };
    });
    expect(await repository.containerIdForCookieStore("firefox-container-9")).toBe(
      "container-9",
    );
    expect(
      await repository.containerIdForCookieStore("firefox-container-none"),
    ).toBeUndefined();
  });
});

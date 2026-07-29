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

  it("fails closed on an unsupported schema instead of forgetting ownership", async () => {
    const adapter = new MockAdapter();
    adapter.stored = { schemaVersion: 999, containers: { dangerous: {} } };
    const repository = new StateRepository(adapter);
    await expect(repository.initialize()).rejects.toThrow(
      /Unsupported persisted state schema/,
    );
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
});

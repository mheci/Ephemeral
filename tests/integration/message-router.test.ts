import { beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../../src/background/controller";
import { MessageRouter } from "../../src/background/message-router";
import type { PublicState } from "../../src/core/types";
import { MockAdapter } from "../helpers/mock-adapter";

const sender = { id: "ephemeral-test" } as browser.runtime.MessageSender;

beforeEach(() => {
  vi.stubGlobal("browser", { runtime: { id: "ephemeral-test" } });
});

describe("MessageRouter", () => {
  it("rejects foreign, malformed, and unknown messages", async () => {
    const router = new MessageRouter(new Controller(new MockAdapter()));
    await expect(
      router.handle({ type: "GET_STATE" }, { id: "other" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNAUTHORIZED",
    });
    await expect(router.handle(null, sender)).resolves.toMatchObject({
      ok: false,
      code: "BAD_REQUEST",
    });
    await expect(
      router.handle({ type: "NOT_A_MESSAGE" }, sender),
    ).resolves.toMatchObject({
      ok: false,
      code: "BAD_REQUEST",
    });
  });

  it("routes the complete UI command surface", async () => {
    const adapter = new MockAdapter();
    const controller = new Controller(adapter, () => 1_700_000_000_000);
    const router = new MessageRouter(controller);

    expect(
      await router.handle(
        { type: "CREATE_CONTAINER", kind: "reusable", openTab: true },
        sender,
      ),
    ).toEqual({ ok: true });
    let response = await router.handle({ type: "GET_STATE" }, sender);
    expect(response.ok).toBe(true);
    let publicState = response.ok ? (response.data as PublicState) : undefined;
    const record = publicState?.containers[0];
    expect(record).toBeDefined();

    expect(
      await router.handle({ type: "OPEN_TAB", containerId: record!.id }, sender),
    ).toEqual({ ok: true });
    expect(
      await router.handle(
        {
          type: "UPDATE_CONTAINER_POLICY",
          containerId: record!.id,
          policy: {
            destroyOnLastTabClose: true,
            destroyOnBrowserRestart: false,
            inactivity: { enabled: false, minutes: 10 },
          },
        },
        sender,
      ),
    ).toEqual({ ok: true });

    response = await router.handle({ type: "EXPORT_SETTINGS" }, sender);
    const exported = response.ok ? (response.data as string) : "";
    expect(exported).toContain("ephemeral-settings");
    expect(
      await router.handle({ type: "IMPORT_SETTINGS", text: exported }, sender),
    ).toEqual({ ok: true });

    response = await router.handle({ type: "GET_STATE" }, sender);
    publicState = response.ok ? (response.data as PublicState) : undefined;
    expect(
      await router.handle(
        { type: "UPDATE_SETTINGS", settings: publicState?.settings },
        sender,
      ),
    ).toEqual({ ok: true });

    expect(
      await router.handle({ type: "REQUEST_DOWNLOADS_PERMISSION" }, sender),
    ).toEqual({ ok: true, data: true });
    expect(
      await router.handle({ type: "REMOVE_DOWNLOADS_PERMISSION" }, sender),
    ).toEqual({ ok: true, data: true });
    response = await router.handle({ type: "EXPORT_DIAGNOSTICS" }, sender);
    expect(response.ok && String(response.data)).toContain("ephemeral-diagnostics");

    expect(
      await router.handle(
        { type: "CLEANUP_CONTAINER", containerId: record!.id },
        sender,
      ),
    ).toMatchObject({ ok: true });
    expect(await router.handle({ type: "CLEAR_HISTORY" }, sender)).toEqual({
      ok: true,
    });
    await router.handle(
      { type: "CREATE_CONTAINER", kind: "one-time", openTab: false },
      sender,
    );
    expect(await router.handle({ type: "CLEANUP_ALL" }, sender)).toEqual({ ok: true });
  });

  it("converts controller exceptions into bounded error responses", async () => {
    const router = new MessageRouter(new Controller(new MockAdapter()));
    await expect(
      router.handle({ type: "OPEN_TAB", containerId: "missing" }, sender),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

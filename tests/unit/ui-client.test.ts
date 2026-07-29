import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestMessage } from "../../src/core/types";
import { UiRequestError, send } from "../../src/ui/client";

const request: RequestMessage = { type: "GET_STATE" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubRuntime(response: unknown): void {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  vi.stubGlobal("browser", {
    runtime: { sendMessage: vi.fn().mockResolvedValue(response) },
  });
}

describe("UI request client", () => {
  it("returns typed response data", async () => {
    stubRuntime({ ok: true, data: { ready: true } });
    await expect(send<{ ready: boolean }>(request)).resolves.toEqual({ ready: true });
  });

  it("rejects invalid and explicit error responses", async () => {
    stubRuntime({ unexpected: true });
    await expect(send(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    stubRuntime({ ok: false, code: "TEST", error: "failed" });
    await expect(send(request)).rejects.toMatchObject({
      code: "TEST",
      message: "failed",
    });
  });

  it("times out instead of leaving the dashboard loading forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("browser", {
      runtime: { sendMessage: vi.fn(() => new Promise(() => undefined)) },
    });
    const pending = send(request, 25).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await vi.advanceTimersByTimeAsync(25);
    const error: unknown = await pending;
    expect(error).toBeInstanceOf(UiRequestError);
    expect(error).toMatchObject({ code: "REQUEST_TIMEOUT" });
  });
});

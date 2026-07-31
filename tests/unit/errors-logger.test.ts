import { describe, expect, it, vi } from "vitest";
import { EphemeralError, errorMessage, isNotFoundError } from "../../src/core/errors";
import { Logger } from "../../src/background/logger";

describe("errors and local logger", () => {
  it("caps unknown errors and recognizes Firefox-style absence", () => {
    expect(errorMessage(new Error("x".repeat(800)))).toHaveLength(500);
    expect(errorMessage(42)).toBe("42");
    expect(isNotFoundError(new Error("Contextual identity not found"))).toBe(true);
    expect(isNotFoundError(new Error("network"))).toBe(false);
    expect(new EphemeralError("message", "CODE").code).toBe("CODE");
  });

  it("uses only the local console surface and stays invisible for debug/info", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = new Logger("test");
    logger.debug("debug");
    logger.info("info", { count: 1 });
    logger.warn("warn");
    logger.error("error", new Error("safe"));
    // Debug/info are no-ops for invisibility and resource efficiency
    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("[test]", "error", { error: "safe" });
  });
});

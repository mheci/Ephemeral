import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../../src/core/defaults";

describe("production defaults", () => {
  it("uses a reliable, low-retention baseline", () => {
    const settings = createDefaultSettings();
    expect(settings.startUrl).toBe("about:blank");
    expect(settings.reusablePolicy.inactivity).toEqual({
      enabled: true,
      minutes: 30,
    });
    expect(settings.cleanupHistoryLimit).toBe(50);
    expect(settings.retry).toEqual({
      maxAttempts: 5,
      delaysMinutes: [1, 5, 15, 60, 240],
    });
  });
});

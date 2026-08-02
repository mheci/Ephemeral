import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../../src/core/defaults";
import {
  ValidationError,
  createSettingsExport,
  parseSettingsExport,
  validateSettings,
} from "../../src/core/validation";

describe("settings validation", () => {
  it("accepts defaults and normalizes an HTTP URL", () => {
    const settings = createDefaultSettings();
    settings.startUrl = "https://example.com";
    expect(validateSettings(settings).startUrl).toBe("https://example.com/");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/a",
    "https://u:p@example.com",
  ])("rejects unsafe start URL %s", (url) => {
    const settings = createDefaultSettings();
    settings.startUrl = url;
    expect(() => validateSettings(settings)).toThrow(ValidationError);
  });

  it("rejects unknown fields instead of silently accepting them", () => {
    const settings = { ...createDefaultSettings(), telemetry: true };
    expect(() => validateSettings(settings)).toThrow(/unknown field/);
  });

  it("round-trips a versioned settings-only export", () => {
    const settings = createDefaultSettings();
    const exported = createSettingsExport(settings, 0);
    expect(parseSettingsExport(JSON.stringify(exported))).toEqual(settings);
    expect(exported).not.toHaveProperty("containers");
  });

  it("rejects oversized and prototype-like imports", () => {
    expect(() => parseSettingsExport("x".repeat(70_000))).toThrow(/64 KiB/);
    const value = createSettingsExport(createDefaultSettings());
    expect(() =>
      parseSettingsExport(JSON.stringify({ ...value, __unexpected: "value" })),
    ).toThrow(/unknown field/);
  });

  it("enforces bounded history and retry settings", () => {
    const settings = createDefaultSettings();
    settings.cleanupHistoryLimit = 501;
    expect(() => validateSettings(settings)).toThrow(/0 to 500/);
    settings.cleanupHistoryLimit = 100;
    settings.retry.maxAttempts = 6;
    expect(() => validateSettings(settings)).toThrow(/maxAttempts/);
  });

  it("defaults a missing grace period to zero and bounds its range", () => {
    const settings = createDefaultSettings();
    const legacy = { ...settings.oneTimePolicy };
    delete (legacy as { graceSeconds?: number }).graceSeconds;
    expect(
      validateSettings({ ...settings, oneTimePolicy: legacy }).oneTimePolicy,
    ).toMatchObject({
      destroyOnLastTabClose: true,
      graceSeconds: 0,
    });

    const overRange = createDefaultSettings();
    overRange.reusablePolicy.graceSeconds = 601;
    expect(() => validateSettings(overRange)).toThrow(/0 to 600/);

    const fractional = createDefaultSettings();
    fractional.reusablePolicy.graceSeconds = 1.5;
    expect(() => validateSettings(fractional)).toThrow(/integer/);
  });

  it("round-trips an explicit grace period", () => {
    const settings = createDefaultSettings();
    settings.oneTimePolicy.graceSeconds = 30;
    const exported = createSettingsExport(settings, 0);
    expect(
      parseSettingsExport(JSON.stringify(exported)).oneTimePolicy.graceSeconds,
    ).toBe(30);
  });

  it("defaults a missing history sweep to off and rejects non-boolean values", () => {
    const settings = createDefaultSettings();
    const legacy = {
      ...settings.cleanup,
    } as Partial<typeof settings.cleanup>;
    delete legacy.sweepGlobalHistory;
    expect(
      validateSettings({ ...settings, cleanup: legacy }).cleanup.sweepGlobalHistory,
    ).toBe(false);

    const explicit = createDefaultSettings();
    explicit.cleanup.sweepGlobalHistory = true;
    expect(validateSettings(explicit).cleanup.sweepGlobalHistory).toBe(true);

    const invalid = createDefaultSettings();
    (invalid.cleanup as unknown as { sweepGlobalHistory: unknown }).sweepGlobalHistory =
      "yes";
    expect(() => validateSettings(invalid)).toThrow(/sweepGlobalHistory/);
  });

  it.each([
    null,
    {},
    { ...createDefaultSettings(), schemaVersion: 2 },
    { ...createDefaultSettings(), containerNamePrefix: "\u0000" },
    { ...createDefaultSettings(), startUrl: "not a url" },
    { ...createDefaultSettings(), cleanup: null },
    { ...createDefaultSettings(), retry: null },
    { ...createDefaultSettings(), retry: { maxAttempts: 2, delaysMinutes: "1,5" } },
    { ...createDefaultSettings(), retry: { maxAttempts: 2, delaysMinutes: [1] } },
  ])("rejects structurally invalid settings %#", (value) => {
    expect(() => validateSettings(value)).toThrow(ValidationError);
  });

  it.each([
    "not json",
    "[]",
    JSON.stringify({
      format: "wrong",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {},
    }),
    JSON.stringify({
      format: "ephemeral-settings",
      version: 1,
      exportedAt: "never",
      settings: {},
    }),
  ])("rejects malformed import envelope %#", (text) => {
    expect(() => parseSettingsExport(text)).toThrow(ValidationError);
  });
});
